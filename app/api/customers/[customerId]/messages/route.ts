import { NextResponse } from "next/server";
import postgres from "postgres";
import { getCurrentSession } from "../../../../../lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ customerId: string }> }) {
  const session = await getCurrentSession(); if (!session) return NextResponse.json({ error: "Sign in to schedule customer updates." }, { status: 401 });
  const { customerId } = await params;
  let body: { channel?: unknown; purpose?: unknown; message?: unknown; paymentLinkId?: unknown; scheduledFor?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid scheduled update." }, { status: 400 }); }
  const channel = body.channel === "email" || body.channel === "whatsapp" ? body.channel : null;
  const purpose = body.purpose === "payment_link" ? "payment_link" : "update";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 3000) : "";
  const paymentLinkId = typeof body.paymentLinkId === "string" && body.paymentLinkId ? body.paymentLinkId : null;
  const scheduledFor = typeof body.scheduledFor === "string" ? new Date(body.scheduledFor) : null;
  if (!channel || !message || !scheduledFor || Number.isNaN(scheduledFor.valueOf()) || scheduledFor.getTime() < Date.now() - 60_000) return NextResponse.json({ error: "Choose a channel, write an update, and select a future time." }, { status: 422 });
  if (purpose === "payment_link" && !paymentLinkId) return NextResponse.json({ error: "Choose an existing payment link." }, { status: 422 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try {
    const customers = await sql`select id from customers where id = ${customerId} and workspace_id = ${session.workspaceId} limit 1`; if (!customers.length) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
    if (paymentLinkId) { const links = await sql`select id from payment_links where id = ${paymentLinkId} and workspace_id = ${session.workspaceId} and customer_id = ${customerId} and status = 'issued' limit 1`; if (!links.length) return NextResponse.json({ error: "Choose an unpaid payment link for this customer." }, { status: 422 }); }
    const rows = await sql<{ id: string }[]>`insert into scheduled_customer_messages (workspace_id, customer_id, channel, purpose, body, payment_link_id, scheduled_for) values (${session.workspaceId}, ${customerId}, ${channel}, ${purpose}, ${message}, ${paymentLinkId}, ${scheduledFor}) returning id`;
    return NextResponse.json({ id: rows[0].id, scheduledFor });
  } finally { await sql.end(); }
}
