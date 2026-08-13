import { ImageResponse } from "next/og";
import postgres from "postgres";
export const runtime = "nodejs";
export const alt = "AI Readiness Score by Rasphia";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export default async function Image({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params; let score: number | null = null;
  if (process.env.DATABASE_URL) { const sql = postgres(process.env.DATABASE_URL, { max: 1 }); try { const rows = await sql`select scores from ai_readiness_audits where id = ${jobId}`; score = typeof rows[0]?.scores?.overall === "number" ? rows[0].scores.overall : null; } catch { /* An unavailable database should not break link previews. */ } finally { await sql.end(); } }
  return new ImageResponse(<div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 70, background: "#142a33", color: "#f4f6f2" }}><div style={{ fontSize: 30, color: "#f0a32f" }}>RASPHIA · AI READINESS SCORE</div><div style={{ fontSize: 80, marginTop: 28, fontFamily: "serif" }}>{score === null ? "AI commerce readiness" : `This store scored ${score}/100`}</div><div style={{ fontSize: 34, marginTop: 20, color: "#b9c6c4" }}>Discoverable · Bookable · Payable</div></div>, size);
}
