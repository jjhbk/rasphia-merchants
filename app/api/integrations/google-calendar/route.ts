import { createHmac, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentSession } from "../../../../lib/auth";

const STATE_COOKIE = "rasphia_calendar_oauth_state";
function signature(state: string) { const secret = process.env.AUTH_SECRET; if (!secret || secret.length < 32) throw new Error("AUTH_SECRET must be configured."); return createHmac("sha256", secret).update(state).digest("hex"); }

export async function GET(request: Request) {
  const session = await getCurrentSession(); if (!session) return NextResponse.redirect(new URL("/login", request.url));
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.INTEGRATION_ENCRYPTION_KEY) return NextResponse.redirect(new URL("/dashboard?error=Google+Calendar+is+not+configured.", request.url));
  const state = randomBytes(32).toString("hex"); (await cookies()).set(STATE_COOKIE, `${state}.${signature(state)}.${session.workspaceId}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth"); url.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: `${new URL(request.url).origin}/api/integrations/google-calendar/callback`, response_type: "code", scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy", access_type: "offline", prompt: "consent", state }).toString();
  return NextResponse.redirect(url);
}
