import { NextResponse } from "next/server";
import postgres from "postgres";
import { paymentConnection, verifyWebhook, type PaymentProvider } from "../../../../../lib/payments";
import { sendCustomerEmail } from "../../../../../lib/customer-message";
import { sendWhatsAppTemplate, sendWhatsAppText } from "../../../../../lib/whatsapp";

type ProviderObject = { id?: string; payment_intent?: string; subscription?: string; status?: string; current_period_start?: number; current_period_end?: number; current_start?: number; current_end?: number; cancel_at_period_end?: boolean; cancel_at_cycle_end?: boolean };

export async function POST(request: Request, { params }: { params: Promise<{ provider: string; workspaceId: string }> }) {
  const { provider: rawProvider, workspaceId } = await params; const provider = rawProvider === "stripe" || rawProvider === "razorpay" ? rawProvider as PaymentProvider : null;
  if (!provider || !process.env.DATABASE_URL) return new NextResponse("Not found", { status: 404 });
  const raw = await request.text(); const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try {
    const connection = await paymentConnection(sql, workspaceId, provider);
    const signatureHeader = request.headers.get(provider === "stripe" ? "stripe-signature" : "x-razorpay-signature");
    if (!connection) {
      console.error("Payment webhook rejected: no active connection", { provider, workspaceId });
      return new NextResponse("No active payment connection for this workspace", { status: 400 });
    }
    if (!verifyWebhook(provider, raw, signatureHeader, connection.webhook_secret_encrypted)) {
      console.error("Payment webhook rejected: invalid signature", { provider, workspaceId, signaturePresent: Boolean(signatureHeader), bodyBytes: Buffer.byteLength(raw) });
      return new NextResponse("Invalid webhook signature", { status: 400 });
    }
    const event = JSON.parse(raw) as { id?: string; type?: string; event?: string; data?: { object?: ProviderObject }; payload?: { payment_link?: { entity?: { id?: string; payment_id?: string } }; payment?: { entity?: { id?: string } }; subscription?: { entity?: ProviderObject } } };
    const subscriptionObject: ProviderObject | undefined = provider === "stripe" ? event.data?.object : event.payload?.subscription?.entity; const subscriptionId = provider === "stripe" && eventTypeIsSubscription(event.type) ? subscriptionObject?.id : provider === "razorpay" && String(event.event || "").startsWith("subscription.") ? subscriptionObject?.id : provider === "stripe" ? event.data?.object?.subscription : null;
    const eventId = provider === "stripe" ? event.id || "unknown" : `${event.event || "event"}:${subscriptionId || event.payload?.payment_link?.entity?.id || event.id || "unknown"}:${event.payload?.payment_link?.entity?.payment_id || ""}`; const eventType = provider === "stripe" ? event.type || "unknown" : event.event || "unknown"; const providerLinkId = provider === "stripe" ? event.data?.object?.id : event.payload?.payment_link?.entity?.id; const paymentLinkStatus = paymentLinkEventStatus(provider, eventType);
    const inserted = await sql`insert into payment_events (workspace_id, provider, provider_event_id, event_type, payload, processed_at) values (${workspaceId}, ${provider}, ${eventId}, ${eventType}, ${sql.json(event)}, now()) on conflict (provider, provider_event_id) do nothing returning id`;
    const providerPaymentId = provider === "stripe" ? event.data?.object?.payment_intent || null : event.payload?.payment_link?.entity?.payment_id || event.payload?.payment?.entity?.id || null;
    console.info("Payment webhook event received", { provider, workspaceId, eventType, providerLinkId: providerLinkId || null, paymentLinkStatus, inserted: Boolean(inserted.length) });
    if (inserted.length && providerLinkId && paymentLinkStatus) {
      const paidLinks = await sql<{ customer_id: string; description: string }[]>`update payment_links set status = ${paymentLinkStatus}, provider_payment_id = coalesce(${providerPaymentId}, provider_payment_id), paid_at = case when ${paymentLinkStatus === 'paid'} then now() else paid_at end, updated_at = now() where workspace_id = ${workspaceId} and provider = ${provider} and provider_link_id = ${providerLinkId} returning customer_id, description`;
      console.info("Payment link ledger update", { provider, workspaceId, providerLinkId, status: paymentLinkStatus, matchedLinks: paidLinks.length });
      if (paymentLinkStatus === "paid" && paidLinks[0]?.customer_id) {
        const details = await sql<{ customer_name: string | null; customer_email: string | null; customer_phone: string | null; business_name: string; business_email: string | null; business_phone: string | null; workspace_slug: string; payment_template: { name: string; language: string } | null }[]>`select c.first_name as customer_name, c.email as customer_email, c.phone as customer_phone, w.name as business_name, coalesce(ws.business_email, owner.email) as business_email, nullif(ws.settings->>'mobile', '') as business_phone, w.slug as workspace_slug, (wh.template_config->'payment')::jsonb as payment_template from workspaces w join workspace_settings ws on ws.workspace_id = w.id left join workspace_members wm on wm.workspace_id = w.id and wm.role = 'owner' left join users owner on owner.id = wm.user_id left join customers c on c.id = ${paidLinks[0].customer_id} and c.workspace_id = ${workspaceId} left join whatsapp_settings wh on wh.workspace_id = w.id and wh.enabled = true where w.id = ${workspaceId} limit 1`;
        const detail = details[0]; const message = `Payment received for ${paidLinks[0].description}. Thank you.`;
        if (detail) {
          const emailJobs = [detail.customer_email ? sendCustomerEmail({ businessName: detail.business_name, senderSlug: detail.workspace_slug, to: detail.customer_email, customerName: detail.customer_name, body: message }) : Promise.resolve(null), detail.business_email ? sendCustomerEmail({ businessName: detail.business_name, senderSlug: detail.workspace_slug, to: detail.business_email, customerName: "team", body: `${detail.customer_name || "A customer"} has paid for ${paidLinks[0].description}.` }) : Promise.resolve(null)];
          const emailResults = await Promise.allSettled(emailJobs);
          emailResults.forEach((result) => { if (result.status === "rejected") console.error("Payment email notification failed", result.reason); });
          if (detail.customer_email || detail.business_email) console.info("Payment email notifications processed", { workspaceId, customerEmailPresent: Boolean(detail.customer_email), businessEmailPresent: Boolean(detail.business_email) });
          const usablePaymentTemplate = detail.payment_template?.name === "hello_world" ? null : detail.payment_template;
          if (usablePaymentTemplate || detail.customer_phone || detail.business_phone) {
            const recipients = [detail.customer_phone, detail.business_phone].filter((recipient, index, list): recipient is string => Boolean(recipient) && list.indexOf(recipient) === index);
            const whatsappResults = await Promise.allSettled(recipients.map((recipient) => usablePaymentTemplate
              ? sendWhatsAppTemplate({ to: recipient, template: usablePaymentTemplate.name, language: usablePaymentTemplate.language, components: [{ type: "body", parameters: [{ type: "text", parameter_name: "customer_name", text: recipient === detail.business_phone ? detail.customer_name || "Customer" : detail.customer_name || "there" }, { type: "text", parameter_name: "business_name", text: detail.business_name }, { type: "text", parameter_name: "update_message", text: recipient === detail.business_phone ? `${detail.customer_name || "A customer"} completed payment for ${paidLinks[0].description}.` : message }] }] })
              : sendWhatsAppText({ to: recipient, body: recipient === detail.business_phone ? `${detail.customer_name || "A customer"} completed payment for ${paidLinks[0].description}.` : message })));
            whatsappResults.forEach((result) => { if (result.status === "rejected") console.error("Payment WhatsApp notification failed", result.reason); });
            console.info("Payment WhatsApp notifications processed", { workspaceId, recipientCount: recipients.length, templateUsed: Boolean(usablePaymentTemplate) });
          }
        }
      }
    }
    if (inserted.length && subscriptionId) {
      const status = subscriptionStatus(provider, subscriptionObject?.status); const start = subscriptionObject?.current_period_start || subscriptionObject?.current_start; const end = subscriptionObject?.current_period_end || subscriptionObject?.current_end; const cancelAtPeriodEnd = provider === "stripe" ? Boolean(subscriptionObject?.cancel_at_period_end) : Boolean(subscriptionObject?.cancel_at_cycle_end);
      if (provider === "stripe" && eventType === "checkout.session.completed" && providerLinkId) {
        const links: { customer_id: string; payment_offering_id: string; payment_connection_id: string }[] = await sql`select customer_id, payment_offering_id, payment_connection_id from payment_links where workspace_id = ${workspaceId} and provider = 'stripe' and provider_link_id = ${providerLinkId} limit 1`;
        if (links[0]?.customer_id && links[0].payment_offering_id) await sql`insert into customer_subscriptions (workspace_id, customer_id, payment_offering_id, payment_connection_id, provider, provider_subscription_id, status, current_period_start, current_period_end, cancel_at_period_end) values (${workspaceId}, ${links[0].customer_id}, ${links[0].payment_offering_id}, ${links[0].payment_connection_id}, 'stripe', ${subscriptionId}, ${status}, ${start ? new Date(start * 1000) : null}, ${end ? new Date(end * 1000) : null}, ${cancelAtPeriodEnd}) on conflict (provider, provider_subscription_id) do update set status = excluded.status, current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end, updated_at = now()`;
      } else await sql`update customer_subscriptions set status = ${status}, current_period_start = ${start ? new Date(start * 1000) : null}, current_period_end = ${end ? new Date(end * 1000) : null}, cancel_at_period_end = ${cancelAtPeriodEnd}, updated_at = now() where workspace_id = ${workspaceId} and provider = ${provider} and provider_subscription_id = ${subscriptionId}`;
    }
    return NextResponse.json({ received: true });
  } catch { return new NextResponse("Webhook processing failed", { status: 500 }); } finally { await sql.end(); }
}

function eventTypeIsSubscription(type?: string) { return Boolean(type?.startsWith("customer.subscription.")); }
function subscriptionStatus(provider: PaymentProvider, status?: string) { if (provider === "stripe") return status === "active" || status === "trialing" ? "active" : status === "past_due" || status === "unpaid" ? "past_due" : status === "canceled" || status === "incomplete_expired" ? "cancelled" : "pending"; return status === "active" ? "active" : status === "paused" || status === "halted" ? "paused" : status === "cancelled" || status === "completed" || status === "expired" ? status === "completed" ? "completed" : "cancelled" : "pending"; }
function paymentLinkEventStatus(provider: PaymentProvider, type: string) { if (provider === "stripe") return type === "checkout.session.completed" ? "paid" : type === "checkout.session.expired" ? "expired" : null; return type === "payment_link.paid" ? "paid" : type === "payment_link.expired" ? "expired" : type === "payment_link.cancelled" ? "cancelled" : null; }
