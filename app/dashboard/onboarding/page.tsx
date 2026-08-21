import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentSession } from "../../../lib/auth";

export default async function OnboardingPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return <main className="auth-page"><nav><div className="wrap nav-inner"><Link className="wordmark" href="/">rasph<em>ia</em></Link><form action="/api/auth/signout" method="post"><button className="nav-utility" type="submit">Sign out</button></form></div></nav><section className="auth-card-wrap"><div className="auth-card onboarding-card"><p className="section-label">Welcome to Rasphia</p><h1>Your workspace is ready.</h1><p>Next we’ll collect your business profile, recommend the right fixed services, and connect only the tools needed to run them.</p><ol><li>Tell us about your business and goals</li><li>Connect Google Calendar when you are ready to accept bookings</li><li>Review and activate your first workflow</li></ol><p className="setup-note">Business profile setup is the next build step. Your workspace <strong>{session.workspaceName}</strong> and private customer database have already been created.</p></div></section></main>;
}
