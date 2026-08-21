import { NextResponse } from "next/server";
import postgres from "postgres";
import { getCurrentSession } from "../../../../../lib/auth";
import { approvedWhatsAppTemplates } from "../../../../../lib/whatsapp";

type TemplateReference = { name: string; language: string };
type TemplateConfig = { booking?: TemplateReference; payment?: TemplateReference; followUp?: TemplateReference };

function reference(value: unknown): TemplateReference | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.name !== "string" || typeof item.language !== "string") return null;
  return { name: item.name.trim(), language: item.language.trim() };
}

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Sign in to view WhatsApp templates." }, { status: 401 });
  try {
    return NextResponse.json({ templates: await approvedWhatsAppTemplates() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "WhatsApp templates could not be loaded." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Sign in to save WhatsApp templates." }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid template settings." }, { status: 400 }); }
  const config: TemplateConfig = {};
  for (const key of ["booking", "payment", "followUp"] as const) {
    if (body[key] === null || body[key] === undefined) continue;
    const item = reference(body[key]);
    if (!item) return NextResponse.json({ error: "Choose a valid approved template." }, { status: 422 });
    config[key] = item;
  }
  try {
    const approved = await approvedWhatsAppTemplates();
    const allowed = new Set(approved.map((item) => `${item.name}:${item.language}`));
    if (Object.values(config).some((item) => !allowed.has(`${item.name}:${item.language}`))) return NextResponse.json({ error: "One or more selected templates are no longer approved in WhatsApp." }, { status: 422 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "WhatsApp templates could not be verified." }, { status: 503 });
  }
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try {
    const updated = await sql`update whatsapp_settings set template_config = ${sql.json(config)}, updated_at = now() where workspace_id = ${session.workspaceId} returning workspace_id`;
    if (!updated.length) return NextResponse.json({ error: "Enable WhatsApp routing before selecting templates." }, { status: 409 });
    return NextResponse.json({ ok: true, templateConfig: config });
  } finally { await sql.end(); }
}
