import { NextResponse } from "next/server";
import postgres from "postgres";
import { getCurrentSession } from "../../../../lib/auth";
import { isSupportedTimezone } from "../../../../lib/timezones";

export async function POST(request: Request) {
  const session = await getCurrentSession(); if (!session) return NextResponse.json({ error: "Sign in to update settings." }, { status: 401 });
  let body: { businessName?: unknown; businessType?: unknown; timezone?: unknown; businessEmail?: unknown; description?: unknown; mobile?: unknown; address?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid settings." }, { status: 400 }); }
  const name = typeof body.businessName === "string" ? body.businessName.trim().slice(0, 160) : ""; const type = typeof body.businessType === "string" ? body.businessType.trim().slice(0, 100) : ""; const timezone = typeof body.timezone === "string" ? body.timezone : ""; const email = typeof body.businessEmail === "string" ? body.businessEmail.trim().toLowerCase().slice(0, 254) : ""; const description = typeof body.description === "string" ? body.description.trim().slice(0, 1000) : ""; const mobile = typeof body.mobile === "string" ? body.mobile.trim().slice(0, 40) : ""; const address = typeof body.address === "string" ? body.address.trim().slice(0, 500) : "";
  if (!name || !type || !email || !/^\S+@\S+\.\S+$/.test(email) || !isSupportedTimezone(timezone)) return NextResponse.json({ error: "Add valid business details and choose a supported timezone." }, { status: 422 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Database is not configured." }, { status: 503 }); const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try { await sql`update workspaces set name = ${name}, timezone = ${timezone}, updated_at = now() where id = ${session.workspaceId}`; await sql`update workspace_settings set business_type = ${type}, business_email = ${email}, address = ${address || null}, settings = settings || ${sql.json({ description, mobile })}, updated_at = now() where workspace_id = ${session.workspaceId}`; return NextResponse.json({ ok: true }); } finally { await sql.end(); }
}
