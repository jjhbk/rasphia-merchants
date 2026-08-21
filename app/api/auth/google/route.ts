import { NextResponse } from "next/server";
import { beginGoogleOAuth } from "../../../../lib/auth";

export async function GET(request: Request) {
  try { return NextResponse.redirect(await beginGoogleOAuth(new URL(request.url).origin)); }
  catch (error) { const message = error instanceof Error ? error.message : "Google sign-in is unavailable."; return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, request.url)); }
}
