import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import postgres from "postgres";
import { getCurrentSession } from "../../../../lib/auth";
import { createProviderPaymentLink, createProviderSubscriptionLink, paymentConnection } from "../../../../lib/payments";

type Offering = { id: string; name: string; description: string | null; payment_type: "one_time" | "deposit" | "package" | "recurring"; amount: number; currency: string; billing_interval: "day" | "week" | "month" | "year" | null; interval_count: number | null; total_cycles: number | null; trial_days: number | null; provider_plan_id: string | null };

export async function POST(request: Request) {
  const session = await getCurrentSession(); if (!session) return NextResponse.json({ error: "Sign in to create a customer payment link." }, { status: 401 });
  let body: { offeringId?: unknown; customerName?: unknown; customerEmail?: unknown; customerPhone?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid payment link request." }, { status: 400 }); }
  const offeringId = typeof body.offeringId === "string" ? body.offeringId : ""; const customerName = typeof body.customerName === "string" ? body.customerName.trim().slice(0, 160) : ""; const customerEmail = typeof body.customerEmail === "string" ? body.customerEmail.trim().toLowerCase().slice(0, 254) : ""; const customerPhone = typeof body.customerPhone === "string" ? body.customerPhone.trim().slice(0, 40) : "";
  if (!offeringId || !customerName || !/^\S+@\S+\.\S+$/.test(customerEmail)) return NextResponse.json({ error: "Choose an offer and add the customer’s name and email." }, { status: 422 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try {
    const offers = await sql<Offering[]>`select id, name, description, payment_type, amount, currency, billing_interval, interval_count, total_cycles, trial_days, provider_plan_id from payment_offerings where id = ${offeringId} and workspace_id = ${session.workspaceId} and active = true limit 1`;
    const offering = offers[0]; if (!offering) return NextResponse.json({ error: "That payment offer is unavailable." }, { status: 404 });
    const connection = await paymentConnection(sql, session.workspaceId); if (!connection) return NextResponse.json({ error: "Connect Stripe or Razorpay before creating a payment link." }, { status: 422 });
    const customers = await sql<{ id: string }[]>`insert into customers (workspace_id, email, phone, first_name, source) values (${session.workspaceId}, ${customerEmail}, ${customerPhone || null}, ${customerName}, 'dashboard_payment') on conflict (workspace_id, lower(email)) where email is not null do update set phone = coalesce(excluded.phone, customers.phone), first_name = excluded.first_name, updated_at = now() returning id`;
    const referenceId = randomUUID(); const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin; const successUrl = `${origin}/dashboard/payments?payment=success`; const cancelUrl = `${origin}/dashboard/payments?payment=cancelled`;
    const link = offering.payment_type === "recurring"
      ? await createProviderSubscriptionLink(connection, { amount: offering.amount, currency: offering.currency, description: offering.description || offering.name, customerEmail, referenceId, interval: offering.billing_interval!, intervalCount: offering.interval_count!, totalCycles: offering.total_cycles, trialDays: offering.trial_days, providerPlanId: offering.provider_plan_id, successUrl, cancelUrl })
      : await createProviderPaymentLink(connection, { amount: offering.amount, currency: offering.currency, description: offering.description || offering.name, customerEmail, customerName, customerPhone, referenceId, successUrl, cancelUrl });
    if (link.providerPlanId && !offering.provider_plan_id) await sql`update payment_offerings set provider_plan_id = ${link.providerPlanId}, payment_connection_id = ${connection.id}, updated_at = now() where id = ${offering.id}`;
    await sql`insert into payment_links (workspace_id, customer_id, payment_offering_id, payment_connection_id, provider, provider_link_id, url, amount, currency, description, expires_at) values (${session.workspaceId}, ${customers[0].id}, ${offering.id}, ${connection.id}, ${connection.provider}, ${link.providerLinkId}, ${link.url}, ${offering.amount}, ${offering.currency}, ${offering.name}, ${link.expiresAt})`;
    if (link.providerSubscriptionId) await sql`insert into customer_subscriptions (workspace_id, customer_id, payment_offering_id, payment_connection_id, provider, provider_subscription_id) values (${session.workspaceId}, ${customers[0].id}, ${offering.id}, ${connection.id}, ${connection.provider}, ${link.providerSubscriptionId}) on conflict (provider, provider_subscription_id) do nothing`;
    return NextResponse.json({ url: link.url, recurring: offering.payment_type === "recurring" });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "We couldn’t create that payment link." }, { status: 422 }); }
  finally { await sql.end(); }
}
