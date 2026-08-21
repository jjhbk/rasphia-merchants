import { NextResponse } from "next/server";
import postgres from "postgres";
import { getCurrentSession } from "../../../../lib/auth";

export async function POST(request: Request) {
  const session = await getCurrentSession(); if (!session) return NextResponse.json({ error: "Sign in to create an offering." }, { status: 401 });
  let body: { name?: unknown; description?: unknown; paymentType?: unknown; amount?: unknown; currency?: unknown; billingInterval?: unknown; intervalCount?: unknown; totalCycles?: unknown; trialDays?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid payment offering." }, { status: 400 }); }
  const paymentType = ["one_time", "deposit", "package", "recurring"].includes(String(body.paymentType)) ? String(body.paymentType) : ""; const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : ""; const amount = typeof body.amount === "number" ? body.amount : 0; const currency = typeof body.currency === "string" && /^[a-z]{3}$/i.test(body.currency) ? body.currency.toUpperCase() : ""; const interval = paymentType === "recurring" && ["day", "week", "month", "year"].includes(String(body.billingInterval)) ? String(body.billingInterval) : null; const intervalCount = paymentType === "recurring" && typeof body.intervalCount === "number" ? body.intervalCount : null;
  if (!name || !paymentType || !Number.isInteger(amount) || amount < 1 || !currency || (paymentType === "recurring" && (!interval || !intervalCount || intervalCount < 1))) return NextResponse.json({ error: "Add a name, amount, currency, and recurring interval where required." }, { status: 422 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try { const connections = await sql<{ id: string }[]>`select id from payment_connections where workspace_id = ${session.workspaceId} and status = 'active' order by updated_at desc limit 1`; const rows = await sql<{ id: string }[]>`insert into payment_offerings (workspace_id, payment_connection_id, name, description, payment_type, amount, currency, billing_interval, interval_count, total_cycles, trial_days) values (${session.workspaceId}, ${connections[0]?.id || null}, ${name}, ${typeof body.description === "string" ? body.description.trim().slice(0, 1000) : null}, ${paymentType}, ${amount}, ${currency}, ${interval}, ${intervalCount}, ${typeof body.totalCycles === "number" && body.totalCycles > 0 ? body.totalCycles : null}, ${typeof body.trialDays === "number" && body.trialDays >= 0 ? body.trialDays : null}) returning id`; return NextResponse.json({ id: rows[0].id }); } finally { await sql.end(); }
}
