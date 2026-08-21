import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentSession } from "../../lib/auth";

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.onboardingStatus !== "complete") redirect("/dashboard/onboarding");
  return <main className="dashboard-page"><DashboardNav name={session.workspaceName} slug={session.workspaceSlug} /><section className="dashboard-content"><p className="section-label">Overview</p><h1>Good to see you, {session.name?.split(" ")[0] || "there"}.</h1><p className="dashboard-intro">Your workspace is ready. As you connect channels and activate services, bookings, customer moments, and workflow outcomes will appear here.</p><div className="dashboard-metrics"><article><span>New leads</span><b>—</b><small>Connect a lead source to start tracking</small></article><article><span>Bookings</span><b>—</b><small>Publish your booking page</small></article><article><span>Follow-ups sent</span><b>—</b><small>Activate a customer workflow</small></article><article><span>Payments collected</span><b>—</b><small>Connect Stripe or Razorpay</small></article></div><section className="dashboard-next"><p className="section-label">Next best move</p><h2>Connect the calendar that runs your day.</h2><p>Once connected, Rasphia confirms native bookings on Google Calendar and sends confirmation emails to both you and your customer.</p><div className="dashboard-next-actions"><a className="button button-gold" href="/api/integrations/google-calendar">Connect Google Calendar</a><Link className="dashboard-link" href={`/book/${session.workspaceSlug}`}>View booking page ↗</Link></div></section></section></main>;
}

function DashboardNav({ name, slug }: { name: string; slug: string }) { return <aside className="dashboard-nav"><Link className="wordmark" href="/">rasph<em>ia</em></Link><p>{name}</p><nav><Link href="/dashboard">Overview</Link><Link href={`/book/${slug}`}>Booking page</Link><Link href="/dashboard/conversations">Conversations</Link><span>Customers</span><span>Workflows</span><Link href="/dashboard/payments">Payments</Link><span>Knowledge base</span><span>Settings</span></nav><form action="/api/auth/signout" method="post"><button type="submit">Sign out</button></form></aside>; }
