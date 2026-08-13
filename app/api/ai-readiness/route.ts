import { NextResponse } from "next/server";
import postgres from "postgres";
import { auditSite } from "../../../lib/ai-readiness";
import { allowAiReadinessCheck } from "../../../lib/ai-readiness-rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

function validUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
  try { const url = new URL(normalized); return ["http:", "https:"].includes(url.protocol) && url.hostname.includes(".") ? url : null; } catch { return null; }
}

async function persistAudit(url: URL, ip: string, results: Awaited<ReturnType<typeof auditSite>>) {
  if (!process.env.DATABASE_URL) return null;
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    // Persistence is intentionally after the audit. A transient database outage
    // must never prevent a visitor from receiving their completed report.
    const rows = await sql`insert into ai_readiness_audits (url, domain, status, scores, completed_at) values (${url.toString()}, ${url.hostname.toLowerCase()}, 'complete', ${sql.json(results)}, now()) returning id`;
    await sql`insert into ai_readiness_rate_limits (ip, day, checks) values (${ip}, current_date, 1) on conflict (ip, day) do update set checks = ai_readiness_rate_limits.checks + 1`;
    return rows[0].id as string;
  } catch (error) { console.error("Could not persist AI readiness audit; returning report without storage.", error); return null; }
  finally { await sql.end(); }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const url = validUrl(body.url);
  if (!url) return NextResponse.json({ error: "Enter a valid website URL." }, { status: 422 });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  if (!allowAiReadinessCheck(ip)) return NextResponse.json({ error: "You’ve reached today’s three free checks. Try again tomorrow." }, { status: 429 });
  try {
    const results = await auditSite(url.toString());
    const jobId = await persistAudit(url, ip, results);
    return NextResponse.json({ jobId, url: url.toString(), status: "complete", results });
  } catch (error) { console.error("AI readiness audit failed", error); return NextResponse.json({ error: "We couldn't complete this website check. Please try again." }, { status: 502 }); }
}
