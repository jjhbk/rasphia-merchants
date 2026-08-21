import { NextResponse } from "next/server";
import postgres from "postgres";
import { getCurrentSession } from "../../../../lib/auth";
import { encryptIntegrationSecret } from "../../../../lib/integration-crypto";

export async function POST(request: Request) {
  const session = await getCurrentSession(); if (!session) return NextResponse.json({ error: "Sign in to connect payments." }, { status: 401 });
  let body: { provider?: unknown; stripeSecretKey?: unknown; razorpayKeyId?: unknown; razorpayKeySecret?: unknown; webhookSecret?: unknown; currency?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid payment setup." }, { status: 400 }); }
  const provider = body.provider === "stripe" || body.provider === "razorpay" ? body.provider : null; const webhookSecret = typeof body.webhookSecret === "string" ? body.webhookSecret.trim() : ""; const currency = typeof body.currency === "string" && /^[A-Za-z]{3}$/.test(body.currency) ? body.currency.toUpperCase() : "USD";
  const stripeSecretKey = typeof body.stripeSecretKey === "string" ? body.stripeSecretKey.trim() : ""; const razorpayKeyId = typeof body.razorpayKeyId === "string" ? body.razorpayKeyId.trim() : ""; const razorpayKeySecret = typeof body.razorpayKeySecret === "string" ? body.razorpayKeySecret.trim() : "";
  if (!provider || !webhookSecret || (provider === "stripe" && !stripeSecretKey) || (provider === "razorpay" && (!razorpayKeyId || !razorpayKeySecret))) return NextResponse.json({ error: "Add the required provider credentials and webhook secret." }, { status: 422 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  try {
    const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
    try { await sql`insert into payment_connections (workspace_id, provider, api_key_id_encrypted, api_secret_encrypted, webhook_secret_encrypted, currency) values (${session.workspaceId}, ${provider}, ${provider === "razorpay" ? encryptIntegrationSecret(razorpayKeyId) : null}, ${encryptIntegrationSecret(provider === "stripe" ? stripeSecretKey : razorpayKeySecret)}, ${encryptIntegrationSecret(webhookSecret)}, ${currency}) on conflict (workspace_id, provider) do update set api_key_id_encrypted = excluded.api_key_id_encrypted, api_secret_encrypted = excluded.api_secret_encrypted, webhook_secret_encrypted = excluded.webhook_secret_encrypted, currency = excluded.currency, status = 'active', updated_at = now()`; } finally { await sql.end(); }
    return NextResponse.json({ ok: true, provider, currency });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "We couldn’t securely save this payment connection." }, { status: 422 }); }
}
