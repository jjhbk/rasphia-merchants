import { NextResponse } from "next/server";
import postgres from "postgres";
import { sendBookingEmails } from "../../../../lib/booking-email";
import { createCalendarBooking } from "../../../../lib/google-calendar";
import { sendWhatsAppTemplate, sendWhatsAppText, whatsappConfigured } from "../../../../lib/whatsapp";
import { queueActiveWorkflowUpdate } from "../../../../lib/workflow-runner";
import { normalizeTimezone } from "../../../../lib/timezones";

type TemplateReference = { name: string; language: string };
type TemplateConfig = { booking?: TemplateReference };

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
  if (!slug || !serviceId || !startsAt || Number.isNaN(startsAt.valueOf()) || !name || !/^\S+@\S+\.\S+$/.test(email) || !phone) return NextResponse.json({ error: "Choose a service and time, then add your name, email, and phone number." }, { status: 422 });
  if (body.emailConsent !== true || body.whatsappConsent !== true) return NextResponse.json({ error: "Please agree to email and WhatsApp booking updates before submitting." }, { status: 422 });
  if (startsAt.getTime() < Date.now() + 5 * 60_000 || startsAt.getTime() > Date.now() + 366 * 24 * 60 * 60_000) return NextResponse.json({ error: "Choose an appointment time within the next year." }, { status: 422 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Bookings are not configured yet." }, { status: 503 });
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: "Booking email delivery is not configured for this business yet." }, { status: 503 });
  if (!whatsappConfigured()) return NextResponse.json({ error: "WhatsApp booking updates are not configured for this business yet." }, { status: 503 });
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try {
    const result = await sql.begin(async (tx) => {
      const workspaces = await tx<{ id: string; name: string; timezone: string; business_email: string | null; settings: { mobile?: string } }[]>`select w.id, w.name, w.timezone, ws.business_email, ws.settings from workspaces w join workspace_settings ws on ws.workspace_id = w.id where w.slug = ${slug} and w.onboarding_status = 'complete' limit 1`;
      const workspace = workspaces[0]; if (!workspace || !workspace.business_email) throw new Error("This booking page is unavailable."); workspace.timezone = normalizeTimezone(workspace.timezone);
      const calendars = await tx`select 1 from google_calendar_connections where workspace_id = ${workspace.id} and selected_calendar_id is not null limit 1`;
      if (!calendars.length) throw new Error("This business is not accepting online bookings right now.");
      const whatsapp = await tx<{ template_config: TemplateConfig }[]>`select template_config from whatsapp_settings where workspace_id = ${workspace.id} and enabled = true limit 1`;
      const bookingTemplate = whatsapp[0]?.template_config?.booking;
      const services = await tx<{ id: string; name: string; duration_minutes: number }[]>`select id, name, duration_minutes from booking_services where id = ${serviceId} and workspace_id = ${workspace.id} and active = true limit 1`;
      const service = services[0]; if (!service) throw new Error("That service is unavailable.");
      const existingCustomers = await tx<{ id: string }[]>`select id from customers where workspace_id = ${workspace.id} and (lower(email) = lower(${email}) or phone = ${phone}) order by case when lower(email) = lower(${email}) then 0 else 1 end limit 1`;
      const customers = existingCustomers.length ? await tx<{ id: string }[]>`update customers set email = ${email}, phone = ${phone}, first_name = ${name}, updated_at = now() where id = ${existingCustomers[0].id} returning id` : await tx<{ id: string }[]>`insert into customers (workspace_id, email, phone, first_name, source) values (${workspace.id}, ${email}, ${phone}, ${name}, 'native_booking') returning id`;
      const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60_000);
      const bookings = await tx<{ id: string; public_id: string; status: "requested" }[]>`insert into bookings (workspace_id, customer_id, service_id, starts_at, ends_at, timezone, customer_note) values (${workspace.id}, ${customers[0].id}, ${service.id}, ${startsAt.toISOString()}, ${endsAt.toISOString()}, ${workspace.timezone}, ${note || null}) returning id, public_id, status`;
      if (body.emailConsent === true) await tx`insert into customer_consents (workspace_id, customer_id, channel, status, source, consent_text_version) values (${workspace.id}, ${customers[0].id}, 'email', 'opted_in', 'native_booking_v1', 'v1')`;
      if (body.whatsappConsent === true && phone) await tx`insert into customer_consents (workspace_id, customer_id, channel, status, source, consent_text_version) values (${workspace.id}, ${customers[0].id}, 'whatsapp', 'opted_in', 'native_booking_v1', 'v1')`;
      await tx`insert into customer_events (workspace_id, customer_id, event_type, source, payload) values (${workspace.id}, ${customers[0].id}, 'booking_requested', 'native_booking', ${tx.json({ bookingId: bookings[0].id, serviceId: service.id })})`;
      return { workspace, service, customerId: customers[0].id, bookingTemplate, booking: bookings[0] };
    });
    const calendarEventId = await createCalendarBooking({ workspaceId: result.workspace.id, businessName: result.workspace.name, serviceName: result.service.name, customerName: name, customerEmail: email, startsAt, endsAt: new Date(startsAt.getTime() + result.service.duration_minutes * 60_000), timezone: result.workspace.timezone });
    const bookingStatus = calendarEventId ? "confirmed" : "requested";
    if (calendarEventId) await sql`update bookings set status = 'confirmed', calendar_event_id = ${calendarEventId}, updated_at = now() where id = ${result.booking.id}`;
    const delivery = await sendBookingEmails({ businessName: result.workspace.name, senderSlug: slug, merchantEmail: result.workspace.business_email!, customerEmail: email, customerName: name, serviceName: result.service.name, startsAt, timezone: result.workspace.timezone, status: bookingStatus });
    if (delivery.customerId || delivery.merchantId) await sql`insert into outbound_messages (workspace_id, booking_id, channel, recipient, subject, template_key, provider_message_id, status, sent_at) values (${result.workspace.id}, ${result.booking.id}, 'email', ${email}, 'Booking request', 'booking_request_customer', ${delivery.customerId}, ${delivery.customerId ? 'sent' : 'queued'}, ${delivery.customerId ? new Date() : null}), (${result.workspace.id}, ${result.booking.id}, 'email', ${result.workspace.business_email!}, 'New booking request', 'booking_request_merchant', ${delivery.merchantId}, ${delivery.merchantId ? 'sent' : 'queued'}, ${delivery.merchantId ? new Date() : null})`;
    let whatsappMessageId: string | null = null; let merchantWhatsappMessageId: string | null = null;
    let whatsappError: string | null = null;
    try {
      const date = new Intl.DateTimeFormat("en", { dateStyle: "full", timeStyle: "short", timeZone: result.workspace.timezone }).format(startsAt);
      const customerMessage = bookingStatus === "confirmed"
        ? `Your appointment with ${result.workspace.name} is confirmed. Service: ${result.service.name}. Date and time: ${date}. Please arrive a few minutes early. Reply here if you need to request a change.`
        : `Your booking request for ${result.service.name} with ${result.workspace.name} was received for ${date}. The business will confirm the time shortly. Reply here if you have questions.`;
      const usableBookingTemplate = result.bookingTemplate && result.bookingTemplate.name !== "hello_world" ? result.bookingTemplate : null;
      whatsappMessageId = usableBookingTemplate
        ? await sendWhatsAppTemplate({ to: phone, template: usableBookingTemplate.name, language: usableBookingTemplate.language, components: [{ type: "body", parameters: [{ type: "text", parameter_name: "customer_name", text: name }, { type: "text", parameter_name: "business_name", text: result.workspace.name }, { type: "text", parameter_name: "update_message", text: customerMessage }] }] })
        : await sendWhatsAppText({ to: phone, body: customerMessage });
      if (result.workspace.settings?.mobile && result.workspace.settings.mobile.replace(/\D/g, "") !== phone.replace(/\D/g, "")) {
        const merchantMessage = `New booking request from ${name}. Service: ${result.service.name}. Requested time: ${date}. Customer email: ${email}. ${bookingStatus === "confirmed" ? "The appointment is on your calendar." : "Please review and confirm the request."}`;
        merchantWhatsappMessageId = usableBookingTemplate
          ? await sendWhatsAppTemplate({ to: result.workspace.settings.mobile, template: usableBookingTemplate.name, language: usableBookingTemplate.language, components: [{ type: "body", parameters: [{ type: "text", parameter_name: "customer_name", text: name }, { type: "text", parameter_name: "business_name", text: result.workspace.name }, { type: "text", parameter_name: "update_message", text: merchantMessage }] }] })
          : await sendWhatsAppText({ to: result.workspace.settings.mobile, body: merchantMessage });
      }
    } catch (error) { whatsappError = error instanceof Error ? error.message : "WhatsApp booking update could not be sent."; }
    await sql`insert into outbound_messages (workspace_id, customer_id, booking_id, channel, recipient, template_key, provider_message_id, status, metadata, sent_at) values (${result.workspace.id}, ${result.customerId}, ${result.booking.id}, 'whatsapp', ${phone}, 'booking_update', ${whatsappMessageId}, ${whatsappMessageId ? 'sent' : 'failed'}, ${sql.json({ error: whatsappError })}, ${whatsappMessageId ? new Date() : null})`;
    if (merchantWhatsappMessageId && result.workspace.settings?.mobile) await sql`insert into outbound_messages (workspace_id, booking_id, channel, recipient, template_key, provider_message_id, status, metadata, sent_at) values (${result.workspace.id}, ${result.booking.id}, 'whatsapp', ${result.workspace.settings.mobile}, 'booking_update_merchant', ${merchantWhatsappMessageId}, 'sent', ${sql.json({ bookingId: result.booking.id })}, now())`;
    const reminderAt = new Date(startsAt.getTime() - 24 * 60 * 60_000);
    await queueActiveWorkflowUpdate({ workspaceId: result.workspace.id, customerId: result.customerId, workflowSlug: "booking-no-show", triggerType: "booking_created", body: `Reminder: you have ${result.service.name} with ${result.workspace.name} tomorrow. Please reply if you need to change your booking.`, scheduledFor: reminderAt, channels: ["email", "whatsapp"] }).catch(() => undefined);
    return NextResponse.json({ bookingId: result.booking.public_id, status: bookingStatus });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "We couldn’t create this booking." }, { status: 422 }); }
  finally { await sql.end(); }
}
