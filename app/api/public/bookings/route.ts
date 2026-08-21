import { NextResponse } from "next/server";
import postgres from "postgres";
import { sendBookingEmails } from "../../../../lib/booking-email";
import { createCalendarBooking } from "../../../../lib/google-calendar";

export async function POST(request: Request) {
  let body: { slug?: unknown; serviceId?: unknown; startsAt?: unknown; name?: unknown; email?: unknown; phone?: unknown; note?: unknown; emailConsent?: unknown; whatsappConsent?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid booking request." }, { status: 400 }); }
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const serviceId = typeof body.serviceId === "string" ? body.serviceId : "";
  const startsAt = typeof body.startsAt === "string" ? new Date(body.startsAt) : null;
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
  const phone = typeof body.phone === "string" ? body.phone.trim().slice(0, 40) : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  if (!slug || !serviceId || !startsAt || Number.isNaN(startsAt.valueOf()) || !name || !/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Choose a service and time, then add your name and email." }, { status: 422 });
  if (startsAt.getTime() < Date.now() + 5 * 60_000 || startsAt.getTime() > Date.now() + 366 * 24 * 60 * 60_000) return NextResponse.json({ error: "Choose an appointment time within the next year." }, { status: 422 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Bookings are not configured yet." }, { status: 503 });
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try {
    const result = await sql.begin(async (tx) => {
      const workspaces = await tx<{ id: string; name: string; timezone: string; business_email: string | null }[]>`select w.id, w.name, w.timezone, ws.business_email from workspaces w join workspace_settings ws on ws.workspace_id = w.id where w.slug = ${slug} and w.onboarding_status = 'complete' limit 1`;
      const workspace = workspaces[0]; if (!workspace || !workspace.business_email) throw new Error("This booking page is unavailable.");
      const services = await tx<{ id: string; name: string; duration_minutes: number }[]>`select id, name, duration_minutes from booking_services where id = ${serviceId} and workspace_id = ${workspace.id} and active = true limit 1`;
      const service = services[0]; if (!service) throw new Error("That service is unavailable.");
      const customers = await tx<{ id: string }[]>`insert into customers (workspace_id, email, phone, first_name, source) values (${workspace.id}, ${email}, ${phone || null}, ${name}, 'native_booking') on conflict (workspace_id, lower(email)) where email is not null do update set phone = coalesce(excluded.phone, customers.phone), first_name = excluded.first_name, updated_at = now() returning id`;
      const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60_000);
      const bookings = await tx<{ id: string; public_id: string; status: "requested" }[]>`insert into bookings (workspace_id, customer_id, service_id, starts_at, ends_at, timezone, customer_note) values (${workspace.id}, ${customers[0].id}, ${service.id}, ${startsAt.toISOString()}, ${endsAt.toISOString()}, ${workspace.timezone}, ${note || null}) returning id, public_id, status`;
      if (body.emailConsent === true) await tx`insert into customer_consents (workspace_id, customer_id, channel, status, source, consent_text_version) values (${workspace.id}, ${customers[0].id}, 'email', 'opted_in', 'native_booking_v1', 'v1')`;
      if (body.whatsappConsent === true && phone) await tx`insert into customer_consents (workspace_id, customer_id, channel, status, source, consent_text_version) values (${workspace.id}, ${customers[0].id}, 'whatsapp', 'opted_in', 'native_booking_v1', 'v1')`;
      await tx`insert into customer_events (workspace_id, customer_id, event_type, source, payload) values (${workspace.id}, ${customers[0].id}, 'booking_requested', 'native_booking', ${tx.json({ bookingId: bookings[0].id, serviceId: service.id })})`;
      return { workspace, service, booking: bookings[0] };
    });
    const calendarEventId = await createCalendarBooking({ workspaceId: result.workspace.id, businessName: result.workspace.name, serviceName: result.service.name, customerName: name, customerEmail: email, startsAt, endsAt: new Date(startsAt.getTime() + result.service.duration_minutes * 60_000), timezone: result.workspace.timezone });
    const bookingStatus = calendarEventId ? "confirmed" : "requested";
    if (calendarEventId) await sql`update bookings set status = 'confirmed', calendar_event_id = ${calendarEventId}, updated_at = now() where id = ${result.booking.id}`;
    const delivery = await sendBookingEmails({ businessName: result.workspace.name, senderSlug: slug, merchantEmail: result.workspace.business_email!, customerEmail: email, customerName: name, serviceName: result.service.name, startsAt, timezone: result.workspace.timezone, status: bookingStatus });
    if (delivery.customerId || delivery.merchantId) await sql`insert into outbound_messages (workspace_id, booking_id, channel, recipient, subject, template_key, provider_message_id, status, sent_at) values (${result.workspace.id}, ${result.booking.id}, 'email', ${email}, 'Booking request', 'booking_request_customer', ${delivery.customerId}, ${delivery.customerId ? 'sent' : 'queued'}, ${delivery.customerId ? new Date() : null}), (${result.workspace.id}, ${result.booking.id}, 'email', ${result.workspace.business_email!}, 'New booking request', 'booking_request_merchant', ${delivery.merchantId}, ${delivery.merchantId ? 'sent' : 'queued'}, ${delivery.merchantId ? new Date() : null})`;
    return NextResponse.json({ bookingId: result.booking.public_id, status: bookingStatus });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "We couldn’t create this booking." }, { status: 422 }); }
  finally { await sql.end(); }
}
