import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { put } from "@vercel/blob";
import { questionsFor, researchBusiness, strategyFor, type Research, type Strategy } from "../../../lib/business-diagnosis";
import { sendDiagnosisEmail } from "../../../lib/diagnosis-email";

export const runtime = "nodejs";
export const maxDuration = 60;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isPreparedResearch = (value: unknown): value is Research => !!value && typeof value === "object" && typeof (value as Research).name === "string" && Array.isArray((value as Research).sources);
const isPreparedStrategy = (value: unknown): value is Strategy => !!value && typeof value === "object" && typeof (value as Strategy).summary === "string" && Array.isArray((value as Strategy).firstWeek);

export async function POST(request: Request) {
  let body: { input?: unknown; email?: unknown; answers?: unknown; action?: unknown; diagnosisId?: unknown; preparedResearch?: unknown; preparedReport?: unknown; questions?: unknown; preparedBlobUrl?: unknown }; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const input = typeof body.input === "string" ? body.input.trim().slice(0, 500) : "";
  if (!input) return NextResponse.json({ error: "Enter a business name, website, Google Maps link, Instagram handle, or Facebook page." }, { status: 422 });
  try {
    const isPreparation = body.action === "prepare"; const isCompletion = body.action === "complete"; const preparedResearch = isPreparedResearch(body.preparedResearch) ? body.preparedResearch : null; const preparedReport = isPreparedStrategy(body.preparedReport) ? body.preparedReport : null; const canReuseResearch = (isPreparation || isCompletion) && !!preparedResearch; const canReusePrepared = isCompletion && canReuseResearch && !!preparedReport;
    const research: Research = canReuseResearch && preparedResearch ? preparedResearch : await researchBusiness(input); const questions = canReuseResearch && Array.isArray(body.questions) ? body.questions : questionsFor(research);
    if (body.action !== "prepare" && body.action !== "complete") return NextResponse.json({ research, questions });
    const answers = body.answers && typeof body.answers === "object" ? body.answers as Record<string, string | string[]> : {};
    // The complete strategy is created and archived immediately after the
    // questionnaire — before we ask for (or receive) an email address.
    const report: Strategy = canReusePrepared && preparedReport ? preparedReport : await strategyFor(research, answers); const suppliedId = typeof body.diagnosisId === "string" ? body.diagnosisId : ""; const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedId) ? suppliedId : randomUUID(); let blobUrl: string | null = canReusePrepared && typeof body.preparedBlobUrl === "string" ? body.preparedBlobUrl : null;
    if (!canReusePrepared) { try { if (process.env.BLOB_READ_WRITE_TOKEN) { const blob = await put(`diagnoses/${id}/prepared-report.json`, JSON.stringify({ id, status: "prepared", research, answers, report, preparedAt: new Date().toISOString() }, null, 2), { access: "public", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true }); blobUrl = blob.url; } } catch (error) { console.error("Could not archive prepared diagnosis in Vercel Blob", error); } }
    if (body.action === "prepare") return NextResponse.json({ id, research, report, blobUrl });
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email && !emailPattern.test(email)) return NextResponse.json({ error: "Enter a valid email address, or leave it blank." }, { status: 422 });
    let emailDelivered = false;
    if (email) { try { emailDelivered = await sendDiagnosisEmail({ to: email, businessName: research.name, report, reportUrl: blobUrl }); } catch (error) { console.error("Could not email business diagnosis", error); } }
    if (!process.env.DATABASE_URL) return NextResponse.json({ id, research, report, blobUrl, emailDelivered, persistenceWarning: "The report is ready, but shareable report storage is not configured." });
    const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 3 });
    try {
      // Blob is an optional archive. The relational record is deliberately the
      // last write because it is what enables the in-app share link.
      await sql`insert into business_diagnoses (id, input_value, input_kind, status, research, questions, answers, report, email, blob_url, completed_at) values (${id}, ${input}, ${research.inputKind}, 'complete', ${sql.json(research)}, ${sql.json(questions)}, ${sql.json(answers)}, ${sql.json(report)}, ${email || null}, ${blobUrl}, now())`;
      return NextResponse.json({ id, research, report, shareUrl: `/diagnosis/${id}`, blobUrl, emailDelivered });
    } catch (error) {
      console.error("Could not save completed business diagnosis", error);
      return NextResponse.json({ id, research, report, blobUrl, emailDelivered, persistenceWarning: "The report is ready, but its shareable link could not be saved. Please try again shortly." });
    } finally { await sql.end(); }
  } catch (error) { console.error("Business diagnosis research failed", error); return NextResponse.json({ error: error instanceof Error ? error.message : "We couldn’t research this business. Please try another source." }, { status: 502 }); }
}
