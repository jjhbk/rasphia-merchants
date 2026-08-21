import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentSession } from "../../../lib/auth";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return <main className="auth-page"><nav><div className="wrap nav-inner"><Link className="wordmark" href="/">rasph<em>ia</em></Link><form action="/api/auth/signout" method="post"><button className="nav-utility" type="submit">Sign out</button></form></div></nav><section className="auth-card-wrap"><div className="auth-card onboarding-card"><p className="section-label">Welcome to Rasphia</p><h1>Set up your first customer journey.</h1><p>Start with the essentials. You can connect Google Calendar, payments, WhatsApp, and Drive only when you are ready to use them.</p><OnboardingForm email={session.email} timezone={Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"} /></div></section></main>;
}
