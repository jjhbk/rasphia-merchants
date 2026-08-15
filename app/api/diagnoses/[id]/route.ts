import { NextResponse } from "next/server";
import postgres from "postgres";
import { put } from "@vercel/blob";
import { strategyFor, type Research } from "../../../../lib/business-diagnosis";

export const runtime = "nodejs";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Business Diagnosis is not configured yet." }, { status: 503 });
  const { id } = await params; const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try { const rows = await sql`select id, status, research, questions, answers, report, email, blob_url, created_at, completed_at from business_diagnoses where id = ${id}`; return rows[0] ? NextResponse.json(rows[0]) : NextResponse.json({ error: "Diagnosis not found." }, { status: 404 }); }
  finally { await sql.end(); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let body: { email?: unknown; answers?: unknown }; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!emailPattern.test(email)) return NextResponse.json({ error: "Enter a valid email address to unlock the complete diagnosis." }, { status: 422 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Business Diagnosis is not configured yet." }, { status: 503 });
  const answers = body.answers && typeof body.answers === "object" ? body.answers as Record<string, string | string[]> : {};
  const { id } = await params; const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const rows = await sql`select research from business_diagnoses where id = ${id}`; if (!rows[0]) return NextResponse.json({ error: "Diagnosis not found." }, { status: 404 });
    const report = await strategyFor(rows[0].research as Research, answers); let blobUrl: string | null = null;
    if (process.env.BLOB_READ_WRITE_TOKEN) { try { const blob = await put(`diagnoses/${id}.json`, JSON.stringify({ id, email, research: rows[0].research, answers, report }, null, 2), { access: "public", contentType: "application/json", addRandomSuffix: false }); blobUrl = blob.url; } catch (error) { console.error("Could not archive diagnosis in Vercel Blob", error); } }
    await sql`update business_diagnoses set status = 'complete', answers = ${sql.json(answers)}, report = ${sql.json(report)}, email = ${email}, blob_url = ${blobUrl}, completed_at = now() where id = ${id}`;
    return NextResponse.json({ id, report, shareUrl: `/diagnosis/${id}`, blobUrl });
  } catch (error) { console.error("Could not complete business diagnosis", error); return NextResponse.json({ error: "We couldn’t unlock this diagnosis. Please try again." }, { status: 502 }); }
  finally { await sql.end(); }
}
