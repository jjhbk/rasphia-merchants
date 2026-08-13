import { NextResponse } from "next/server";
import postgres from "postgres";

export const runtime = "nodejs";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(_: Request, { params }: { params: Promise<{ jobId: string }> }) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "AI Readiness Score is not configured yet." }, { status: 503 });
  const { jobId } = await params; const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try { const rows = await sql`select id, url, status, scores, created_at from ai_readiness_audits where id = ${jobId}`; return rows[0] ? NextResponse.json({ jobId: rows[0].id, url: rows[0].url, status: rows[0].status, results: rows[0].scores, createdAt: rows[0].created_at }) : NextResponse.json({ error: "Audit not found." }, { status: 404 }); }
  catch (error) { console.error("Could not read AI readiness audit", error); return NextResponse.json({ error: "The audit database is temporarily unavailable. Please try again shortly." }, { status: 503 }); }
  finally { await sql.end(); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  let body: { email?: string }; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body.email || !emailPattern.test(body.email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 422 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "AI Readiness Score is not configured yet." }, { status: 503 });
  const { jobId } = await params; const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try { await sql`update ai_readiness_audits set email = ${body.email.toLowerCase()} where id = ${jobId}`; return NextResponse.json({ ok: true }); }
  catch (error) { console.error("Could not save AI readiness email", error); return NextResponse.json({ error: "The audit database is temporarily unavailable. Please try again shortly." }, { status: 503 }); }
  finally { await sql.end(); }
}
