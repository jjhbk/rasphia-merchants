import Link from "next/link";
import { redirect } from "next/navigation";
import postgres from "postgres";
import { getCurrentSession } from "../../../lib/auth";
import { BookingPageForm } from "./booking-page-form";
import { normalizeTimezone } from "../../../lib/timezones";

export default async function BookingPageSettings() {
  const session = await getCurrentSession(); if (!session) redirect("/login");
  let services: { id: string; name: string; description: string | null; duration: number }[] = [];
  let profile = { name: session.workspaceName, type: "", timezone: "UTC", email: session.email };
  if (process.env.DATABASE_URL) { const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 }); try { const [rows, workspace] = await Promise.all([sql<typeof services>`select id, name, description, duration_minutes as duration from booking_services where workspace_id = ${session.workspaceId} and active = true order by sort_order, created_at`, sql<{ name: string; timezone: string; business_type: string | null; business_email: string | null }[]>`select w.name, w.timezone, ws.business_type, ws.business_email from workspaces w join workspace_settings ws on ws.workspace_id = w.id where w.id = ${session.workspaceId} limit 1`]); services = rows; if (workspace[0]) profile = { name: workspace[0].name, type: workspace[0].business_type || "", timezone: normalizeTimezone(workspace[0].timezone), email: workspace[0].business_email || session.email }; } finally { await sql.end(); } }
  const publicUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://www.rasphia.com"}/book/${session.workspaceSlug}`;
  return <main className="dashboard-page"><aside className="dashboard-nav"><Link className="wordmark" href="/">rasph<em>ia</em></Link><p>{session.workspaceName}</p><nav><Link href="/dashboard">Overview</Link><Link className="active" href="/dashboard/booking">Booking page</Link><Link href="/dashboard/conversations">Conversations</Link><Link href="/dashboard/customers">Customers</Link><Link href="/dashboard/payments">Payments</Link><Link href="/dashboard/settings">Settings</Link></nav></aside><section className="dashboard-content"><p className="section-label">Booking page editor</p><h1>Shape the experience customers see.</h1><p className="dashboard-intro">Edit the booking details and services customers see at your public URL.</p><BookingPageForm services={services} publicUrl={publicUrl} profile={profile} /></section></main>;
}
