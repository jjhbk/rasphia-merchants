import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import postgres from "postgres";
import { getCurrentSession } from "../../../../../lib/auth";
import { encryptIntegrationSecret } from "../../../../../lib/integration-crypto";

const STATE_COOKIE = "rasphia_calendar_oauth_state";
function signature(state: string) { return createHmac("sha256", process.env.AUTH_SECRET || "").update(state).digest("hex"); }
function failure(url: URL, message: string) { return NextResponse.redirect(new URL(`/dashboard?error=${encodeURIComponent(message)}`, url)); }

export async function GET(request: Request) {
  const url = new URL(request.url); const session = await getCurrentSession(); const code = url.searchParams.get("code"), state = url.searchParams.get("state"); const stored = (await cookies()).get(STATE_COOKIE)?.value; (await cookies()).delete(STATE_COOKIE);
  if (!session || !code || !state || !stored || !process.env.DATABASE_URL) return NextResponse.redirect(new URL("/dashboard?error=Google+Calendar+connection+could+not+be+verified.", url));
  const [storedState, storedSignature, workspaceId] = stored.split("."); const expected = signature(state); const signatureMatches = storedSignature && storedSignature.length === expected.length && timingSafeEqual(Buffer.from(storedSignature), Buffer.from(expected));
  if (!signatureMatches || storedState !== state || workspaceId !== session.workspaceId) return NextResponse.redirect(new URL("/dashboard?error=Google+Calendar+connection+could+not+be+verified.", url));
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", redirect_uri: `${url.origin}/api/integrations/google-calendar/callback`, grant_type: "authorization_code" }), cache: "no-store" });
    if (!tokenResponse.ok) throw new Error("Google could not exchange the authorization code. Check the localhost redirect URI and try again."); const token = await tokenResponse.json() as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
    const calendarsResponse = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", { headers: { Authorization: `Bearer ${token.access_token}` }, cache: "no-store" });
    if (!calendarsResponse.ok) {
      const details = await calendarsResponse.json().catch(() => null) as { error?: { status?: string; message?: string } } | null;
      const reason = details?.error?.status || details?.error?.message || `HTTP ${calendarsResponse.status}`;
      throw new Error(`Google Calendar could not be read (${reason}). Reconnect and confirm the Calendar API and calendar-list permission are enabled.`);
    }
    const calendars = await calendarsResponse.json() as { items?: { id: string; summary?: string; primary?: boolean }[] }; const calendar = calendars.items?.find((item) => item.primary) || calendars.items?.[0]; if (!calendar) throw new Error("No Google Calendar was available on this account.");
    const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
    try { await sql`insert into google_calendar_connections (workspace_id, access_token_encrypted, refresh_token_encrypted, token_expires_at, granted_scopes, selected_calendar_id, selected_calendar_name) values (${session.workspaceId}, ${encryptIntegrationSecret(token.access_token)}, ${token.refresh_token ? encryptIntegrationSecret(token.refresh_token) : null}, ${new Date(Date.now() + (token.expires_in || 3600) * 1000)}, ${token.scope?.split(" ") || []}, ${calendar.id}, ${calendar.summary || "Primary calendar"}) on conflict (workspace_id) do update set access_token_encrypted = excluded.access_token_encrypted, refresh_token_encrypted = coalesce(excluded.refresh_token_encrypted, google_calendar_connections.refresh_token_encrypted), token_expires_at = excluded.token_expires_at, granted_scopes = excluded.granted_scopes, selected_calendar_id = excluded.selected_calendar_id, selected_calendar_name = excluded.selected_calendar_name, updated_at = now()`; } finally { await sql.end(); }
    return NextResponse.redirect(new URL("/dashboard?calendar=connected", url));
  } catch (error) { console.error("Google Calendar connection failed", error); return failure(url, error instanceof Error ? error.message : "Google Calendar could not be connected."); }
}
