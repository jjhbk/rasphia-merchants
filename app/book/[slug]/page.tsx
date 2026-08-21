import { notFound } from "next/navigation";
import postgres from "postgres";
import { BookingForm } from "./booking-form";

export default async function PublicBookingPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!process.env.DATABASE_URL) notFound();
  const { slug } = await params; const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try {
    const workspaces = await sql<{ id: string; name: string; timezone: string; business_type: string | null }[]>`select w.id, w.name, w.timezone, ws.business_type from workspaces w join workspace_settings ws on ws.workspace_id = w.id where w.slug = ${slug.toLowerCase()} and w.onboarding_status = 'complete' limit 1`;
    const workspace = workspaces[0]; if (!workspace) notFound();
    const services = await sql<{ id: string; name: string; description: string | null; duration: number }[]>`select id, name, description, duration_minutes as duration from booking_services where workspace_id = ${workspace.id} and active = true order by sort_order, created_at`;
    return <main className="public-booking-page"><header><div className="booking-brand">rasph<em>ia</em></div><span>Booking with {workspace.name}</span></header><section className="public-booking-hero"><p className="section-label">Book an appointment</p><h1>{workspace.name}</h1><p>{workspace.business_type ? `${workspace.business_type} · ` : ""}{workspace.timezone}</p></section><section className="public-booking-wrap"><div className="booking-copy"><p className="section-label">Choose your time</p><h2>Make your next visit easy.</h2><p>Send a request for a time that works. You’ll receive the details by email, and the business will confirm it shortly.</p></div><BookingForm slug={slug} services={services} /></section></main>;
  } finally { await sql.end(); }
}
