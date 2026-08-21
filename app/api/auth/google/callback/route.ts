import { NextResponse } from "next/server";
import { completeGoogleOAuth } from "../../../../../lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return NextResponse.redirect(new URL("/login?error=Google+sign-in+was+cancelled.", url));
  const code = url.searchParams.get("code"), state = url.searchParams.get("state");
  if (!code || !state) return NextResponse.redirect(new URL("/login?error=Google+did+not+return+a+complete+sign-in+response.", url));
  try {
    const result = await completeGoogleOAuth(url.origin, code, state, request.headers.get("user-agent"));
    return NextResponse.redirect(new URL(result.isNew ? "/dashboard/onboarding" : "/dashboard", url));
  } catch (error) { const message = error instanceof Error ? error.message : "Google sign-in failed."; return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, url)); }
}
