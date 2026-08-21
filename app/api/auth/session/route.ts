import { NextResponse } from "next/server";
import { getCurrentSession } from "../../../../lib/auth";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ signedIn: false });
  return NextResponse.json({ signedIn: true, dashboardUrl: session.onboardingStatus === "complete" ? "/dashboard" : "/dashboard/onboarding" });
}
