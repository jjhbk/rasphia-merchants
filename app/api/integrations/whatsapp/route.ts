import { NextResponse } from "next/server";
import postgres from "postgres";
import { getCurrentSession } from "../../../../lib/auth";

export async function POST(request: Request) {
  const session = await getCurrentSession(); if (!session) return NextResponse.json({ error: "Sign in to configure WhatsApp." }, { status: 401 });
  let body: { intakeKeyword?: unknown; enabled?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid WhatsApp settings." }, { status: 400 }); }
  const intakeKeyword = typeof body.intakeKeyword === "string" ? body.intakeKeyword.toLowerCase().trim().replace(/[^a-z0-9-]/g, "").slice(0, 64) : "";
  if (intakeKeyword.length < 2) return NextResponse.json({ error: "Use a routing keyword with at least two letters or numbers." }, { status: 422 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try { await sql`insert into whatsapp_settings (workspace_id, enabled, intake_keyword) values (${session.workspaceId}, ${body.enabled !== false}, ${intakeKeyword}) on conflict (workspace_id) do update set enabled = excluded.enabled, intake_keyword = excluded.intake_keyword, updated_at = now()`; return NextResponse.json({ ok: true, intakeKeyword }); } catch { return NextResponse.json({ error: "That routing keyword is already being used. Choose another." }, { status: 422 }); } finally { await sql.end(); }
}
