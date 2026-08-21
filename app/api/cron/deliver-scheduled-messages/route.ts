import { NextResponse } from "next/server";
import postgres from "postgres";
import { sendCustomerEmail } from "../../../../lib/customer-message";
import { sendWhatsAppTemplate } from "../../../../lib/whatsapp";

type QueueItem = { id: string; workspace_id: string; customer_id: string; channel: "email" | "whatsapp"; purpose: "update" | "payment_link"; body: string; payment_link_id: string | null; name: string; email: string | null; phone: string | null; workspace_name: string; workspace_slug: string; template_config: { payment?: { name: string; language: string }; followUp?: { name: string; language: string } } | null; payment_url: string | null };

export async function GET(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) return new NextResponse("Unauthorized", { status: 401 });
  if (!process.env.DATABASE_URL) return new NextResponse("Database unavailable", { status: 503 });
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try {
    const queued = await sql.begin(async (tx) => tx<QueueItem[]>`with due as (select id from scheduled_customer_messages where status = 'scheduled' and scheduled_for <= now() order by scheduled_for asc limit 50 for update skip locked) update scheduled_customer_messages message set status = 'sending', updated_at = now() from due join customers customer on customer.id = message.customer_id join workspaces workspace on workspace.id = message.workspace_id left join whatsapp_settings whatsapp on whatsapp.workspace_id = message.workspace_id left join payment_links payment on payment.id = message.payment_link_id where message.id = due.id returning message.id, message.workspace_id, message.customer_id, message.channel, message.purpose, message.body, message.payment_link_id, customer.first_name as name, customer.email, customer.phone, workspace.name as workspace_name, workspace.slug as workspace_slug, whatsapp.template_config, payment.url as payment_url`);
    for (const item of queued) {
      try {
        const body = item.payment_url ? `${item.body}\n\nPay securely: ${item.payment_url}` : item.body;
        let providerId: string | null;
        if (item.channel === "email") { if (!item.email) throw new Error("This customer has no email address."); providerId = await sendCustomerEmail({ businessName: item.workspace_name, senderSlug: item.workspace_slug, to: item.email, customerName: item.name, body }); }
        else { if (!item.phone) throw new Error("This customer has no WhatsApp phone number."); const template = item.purpose === "payment_link" ? item.template_config?.payment : item.template_config?.followUp; if (!template) throw new Error("No approved WhatsApp template is selected for this update."); providerId = await sendWhatsAppTemplate({ to: item.phone, template: template.name, language: template.language, components: [{ type: "body", parameters: [{ type: "text", parameter_name: "customer_name", text: item.name || "there" }, { type: "text", parameter_name: "business_name", text: item.workspace_name }, { type: "text", parameter_name: "update_message", text: body }] }] }); }
        await sql`update scheduled_customer_messages set status = 'sent', provider_message_id = ${providerId}, sent_at = now(), updated_at = now() where id = ${item.id}`;
        await sql`insert into outbound_messages (workspace_id, customer_id, channel, recipient, template_key, provider_message_id, status, metadata, sent_at) values (${item.workspace_id}, ${item.customer_id}, ${item.channel}, ${item.channel === 'email' ? item.email! : item.phone!}, ${item.purpose}, ${providerId}, 'sent', ${sql.json({ scheduledMessageId: item.id })}, now())`;
        const actions = await sql<{ workflow_run_id: string }[]>`update workflow_actions set status = 'sent', executed_at = now() where payload->>'scheduledMessageId' = ${item.id} returning workflow_run_id`;
        for (const action of actions) await sql`update workflow_runs run set status = 'completed', completed_at = now(), outcome = ${sql.json({ delivered: true })} where run.id = ${action.workflow_run_id} and not exists (select 1 from workflow_actions action where action.workflow_run_id = run.id and action.status = 'queued')`;
      } catch (error) { const message = error instanceof Error ? error.message : 'Delivery failed.'; await sql`update scheduled_customer_messages set status = 'failed', error = ${message}, updated_at = now() where id = ${item.id}`; const actions = await sql<{ workflow_run_id: string }[]>`update workflow_actions set status = 'failed', executed_at = now() where payload->>'scheduledMessageId' = ${item.id} returning workflow_run_id`; for (const action of actions) await sql`update workflow_runs set status = 'failed', completed_at = now(), outcome = ${sql.json({ error: message })} where id = ${action.workflow_run_id}`; }
    }
    return NextResponse.json({ delivered: queued.length });
  } finally { await sql.end(); }
}
