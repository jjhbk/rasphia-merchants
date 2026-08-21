import { NextResponse } from "next/server";
import postgres from "postgres";
import { getCurrentSession } from "../../../../lib/auth";
import { isSupportedTimezone } from "../../../../lib/timezones";

export async function POST(request: Request) {
  const session = await getCurrentSession(); if (!session) return NextResponse.json({ error: "Sign in to update booking settings." }, { status: 401 });
  let body: { businessName?: unknown; businessType?: unknown; timezone?: unknown; businessEmail?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid booking settings." }, { status: 400 }); }
  const name = typeof body.businessName === "string" ? body.businessName.trim().slice(0, 160) : ""; const type = typeof body.businessType === "string" ? body.businessType.trim().slice(0, 100) : ""; const timezone = typeof body.timezone === "string" ? body.timezone : ""; const email = typeof body.businessEmail === "string" ? body.businessEmail.trim().toLowerCase().slice(0, 254) : "";
  if (!name || !type || !/^\S+@\S+\.\S+$/.test(email) || !isSupportedTimezone(timezone)) return NextResponse.json({ error: "Add valid booking details and choose a supported timezone." }, { status: 422 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try { await sql.begin(async (tx) => { await tx`update workspaces set name = ${name}, timezone = ${timezone}, updated_at = now() where id = ${session.workspaceId}`; await tx`update workspace_settings set business_type = ${type}, business_email = ${email}, updated_at = now() where workspace_id = ${session.workspaceId}`; }); return NextResponse.json({ ok: true }); } finally { await sql.end(); }
}
