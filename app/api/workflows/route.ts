import { NextResponse } from "next/server";
import postgres from "postgres";
import { getCurrentSession } from "../../../lib/auth";
import { isWorkflowSlug, type WorkflowStatus } from "../../../lib/workflows";

export async function POST(request: Request) {
  const session = await getCurrentSession(); if (!session) return NextResponse.json({ error: "Sign in to manage workflows." }, { status: 401 });
  let body: { serviceSlug?: unknown; status?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid workflow update." }, { status: 400 }); }
  const serviceSlug = typeof body.serviceSlug === "string" ? body.serviceSlug : ""; const status = ["draft", "test", "active", "paused"].includes(String(body.status)) ? body.status as WorkflowStatus : null;
  if (!isWorkflowSlug(serviceSlug) || !status) return NextResponse.json({ error: "Choose a valid workflow and status." }, { status: 422 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try { await sql`insert into workspace_workflows (workspace_id, service_slug, status, activated_at, activated_by) values (${session.workspaceId}, ${serviceSlug}, ${status}, ${status === 'active' ? new Date() : null}, ${status === 'active' ? session.userId : null}) on conflict (workspace_id, service_slug) do update set status = excluded.status, activated_at = case when excluded.status = 'active' then now() else workspace_workflows.activated_at end, activated_by = case when excluded.status = 'active' then excluded.activated_by else workspace_workflows.activated_by end, updated_at = now()`; const preferenceStatus = status === "test" ? "draft" : status; await sql`insert into workspace_service_preferences (workspace_id, service_slug, status) values (${session.workspaceId}, ${serviceSlug}, ${preferenceStatus}) on conflict (workspace_id, service_slug) do update set status = excluded.status, updated_at = now()`; return NextResponse.json({ ok: true, status }); } finally { await sql.end(); }
}
