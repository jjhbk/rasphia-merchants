import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentSession } from "../../lib/auth";

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.onboardingStatus !== "complete") redirect("/dashboard/onboarding");
  return <main className="dashboard-page"><DashboardNav name={session.workspaceName} /><section className="dashboard-content"><p className="section-label">Overview</p><h1>Good to see you, {session.name?.split(" ")[0] || "there"}.</h1><p className="dashboard-intro">Your workspace is ready. As you connect channels and activate services, bookings, customer moments, and workflow outcomes will appear here.</p><div className="dashboard-metrics"><article><span>New leads</span><b>—</b><small>Connect a lead source to start tracking</small></article><article><span>Bookings</span><b>—</b><small>Set up your booking page</small></article><article><span>Follow-ups sent</span><b>—</b><small>Activate a customer workflow</small></article><article><span>Payments collected</span><b>—</b><small>Connect Stripe or Razorpay</small></article></div><section className="dashboard-next"><p className="section-label">Next best move</p><h2>Set up your first workflow.</h2><p>Start with your business profile, then connect only the tools needed for the service you want to launch first.</p><Link className="button button-gold" href="/dashboard/onboarding">Continue setup</Link></section></section></main>;
}

function DashboardNav({ name }: { name: string }) { return <aside className="dashboard-nav"><Link className="wordmark" href="/">rasph<em>ia</em></Link><p>{name}</p><nav><Link href="/dashboard">Overview</Link><span>Bookings</span><span>Conversations</span><span>Customers</span><span>Workflows</span><span>Payments</span><span>Knowledge base</span><span>Settings</span></nav><form action="/api/auth/signout" method="post"><button type="submit">Sign out</button></form></aside>; }
