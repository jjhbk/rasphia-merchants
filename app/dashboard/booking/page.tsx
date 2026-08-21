import Link from "next/link";
import { redirect } from "next/navigation";
import postgres from "postgres";
import { getCurrentSession } from "../../../lib/auth";
import { BookingPageForm } from "./booking-page-form";

export default async function BookingPageSettings() {
  const session = await getCurrentSession(); if (!session) redirect("/login");
  let services: { id: string; name: string; description: string | null; duration: number }[] = [];
  if (process.env.DATABASE_URL) { const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 }); try { services = await sql<typeof services>`select id, name, description, duration_minutes as duration from booking_services where workspace_id = ${session.workspaceId} and active = true order by sort_order, created_at`; } finally { await sql.end(); } }
  const publicUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://www.rasphia.com"}/book/${session.workspaceSlug}`;
  return <main className="dashboard-page"><aside className="dashboard-nav"><Link className="wordmark" href="/">rasph<em>ia</em></Link><p>{session.workspaceName}</p><nav><Link href="/dashboard">Overview</Link><Link className="active" href="/dashboard/booking">Booking page</Link><Link href="/dashboard/conversations">Conversations</Link><Link href="/dashboard/customers">Customers</Link><Link href="/dashboard/payments">Payments</Link><Link href="/dashboard/settings">Settings</Link></nav></aside><section className="dashboard-content"><p className="section-label">Booking page editor</p><h1>Shape the experience customers see.</h1><p className="dashboard-intro">Add the services, descriptions, and durations customers can choose from your public booking page.</p><BookingPageForm services={services} publicUrl={publicUrl} /></section></main>;
}
