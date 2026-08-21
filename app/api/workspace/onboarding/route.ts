import { NextResponse } from "next/server";
import postgres from "postgres";
import { getCurrentSession } from "../../../../lib/auth";

const channels = new Set(["email", "whatsapp"]);

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Sign in to update your workspace." }, { status: 401 });
  let body: { businessName?: unknown; businessType?: unknown; timezone?: unknown; businessEmail?: unknown; channels?: unknown; firstServiceName?: unknown; firstServiceDuration?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid setup details." }, { status: 400 }); }
  const businessName = typeof body.businessName === "string" ? body.businessName.trim().slice(0, 160) : "";
  const businessType = typeof body.businessType === "string" ? body.businessType.trim().slice(0, 100) : "";
  const timezone = typeof body.timezone === "string" ? body.timezone.trim().slice(0, 80) : "";
  const businessEmail = typeof body.businessEmail === "string" ? body.businessEmail.trim().toLowerCase().slice(0, 254) : "";
  const selectedChannels = Array.isArray(body.channels) ? body.channels.filter((channel): channel is string => typeof channel === "string" && channels.has(channel)) : ["email"];
  const firstServiceName = typeof body.firstServiceName === "string" ? body.firstServiceName.trim().slice(0, 160) : "";
  const firstServiceDuration = typeof body.firstServiceDuration === "number" ? body.firstServiceDuration : 30;
  if (!businessName || !businessType || !timezone || !businessEmail) return NextResponse.json({ error: "Add your business name, type, timezone, and notification email." }, { status: 422 });
  if (!/^\S+@\S+\.\S+$/.test(businessEmail)) return NextResponse.json({ error: "Enter a valid notification email." }, { status: 422 });
  if (firstServiceName && (!Number.isInteger(firstServiceDuration) || firstServiceDuration < 5 || firstServiceDuration > 480)) return NextResponse.json({ error: "Service duration must be between 5 and 480 minutes." }, { status: 422 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try {
    await sql.begin(async (tx) => {
      await tx`update workspaces set name = ${businessName}, timezone = ${timezone}, onboarding_status = 'complete', updated_at = now() where id = ${session.workspaceId}`;
      await tx`update workspace_settings set business_email = ${businessEmail}, business_type = ${businessType}, preferred_channels = ${selectedChannels.length ? selectedChannels : ["email"]}, updated_at = now() where workspace_id = ${session.workspaceId}`;
      if (firstServiceName) await tx`insert into booking_services (workspace_id, name, duration_minutes, sort_order) select ${session.workspaceId}, ${firstServiceName}, ${firstServiceDuration}, 0 where not exists (select 1 from booking_services where workspace_id = ${session.workspaceId})`;
    });
    return NextResponse.json({ ok: true });
  } finally { await sql.end(); }
}
