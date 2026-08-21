import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import postgres from "postgres";
import { sendWhatsAppText, whatsappConfigured } from "../../../../lib/whatsapp";

type IncomingMessage = { id?: string; from?: string; type?: string; text?: { body?: string } };
type IncomingValue = { contacts?: Array<{ profile?: { name?: string } }>; messages?: IncomingMessage[] };

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("hub.mode") === "subscribe" && searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) return new NextResponse(searchParams.get("hub.challenge") || "", { status: 200 });
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  if (!process.env.DATABASE_URL || !process.env.WHATSAPP_APP_SECRET) return new NextResponse("Not configured", { status: 503 });
  let payload: { entry?: Array<{ changes?: Array<{ value?: IncomingValue }> }> };
  const raw = await request.text(); const signature = request.headers.get("x-hub-signature-256"); const expected = `sha256=${createHmac("sha256", process.env.WHATSAPP_APP_SECRET).update(raw).digest("hex")}`;
  if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return new NextResponse("Invalid signature", { status: 401 });
  try { payload = JSON.parse(raw); } catch { return new NextResponse("Invalid payload", { status: 400 }); }
  const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 5 });
  try {
    for (const entry of payload.entry || []) for (const change of entry.changes || []) {
      const value = change.value; for (const message of value?.messages || []) await recordInbound(sql, message, value?.contacts?.[0]?.profile?.name || null);
    }
    return NextResponse.json({ received: true });
  } catch { return new NextResponse("Webhook processing failed", { status: 500 }); }
  finally { await sql.end(); }
}

async function recordInbound(sql: postgres.Sql, message: IncomingMessage, customerName: string | null) {
  const phone = message.from?.replace(/\D/g, "") || ""; if (!phone || !message.id) return;
  const body = message.text?.body?.trim().slice(0, 4000) || "";
  const existing = await sql<{ workspace_id: string }[]>`select workspace_id from customer_conversations where channel = 'whatsapp' and external_key = ${phone} order by last_message_at desc limit 1`;
  let workspaceId = existing[0]?.workspace_id;
  if (!workspaceId) {
    const keyword = /^rasphia\s+([a-z0-9-]{2,64})\b/i.exec(body)?.[1]?.toLowerCase();
    if (keyword) { const settings = await sql<{ workspace_id: string }[]>`select workspace_id from whatsapp_settings where intake_keyword = ${keyword} and enabled = true limit 1`; workspaceId = settings[0]?.workspace_id; }
  }
  if (!workspaceId) return;
  const customers = await sql<{ id: string }[]>`insert into customers (workspace_id, phone, first_name, source) values (${workspaceId}, ${phone}, ${customerName}, 'whatsapp') on conflict (workspace_id, phone) where phone is not null do update set first_name = coalesce(excluded.first_name, customers.first_name), updated_at = now() returning id`;
  const conversations = await sql<{ id: string }[]>`insert into customer_conversations (workspace_id, customer_id, channel, external_key, last_message_at) values (${workspaceId}, ${customers[0].id}, 'whatsapp', ${phone}, now()) on conflict (workspace_id, channel, external_key) do update set customer_id = excluded.customer_id, status = 'open', last_message_at = now(), updated_at = now() returning id`;
  const inserted = await sql`insert into conversation_messages (workspace_id, conversation_id, customer_id, channel, direction, provider_message_id, message_type, body, metadata) values (${workspaceId}, ${conversations[0].id}, ${customers[0].id}, 'whatsapp', 'inbound', ${message.id}, ${message.type || 'text'}, ${body || null}, ${sql.json(message)}) on conflict (channel, provider_message_id) do nothing returning id`;
  if (!inserted.length) return;
  await sql`insert into customer_events (workspace_id, customer_id, event_type, source, payload) values (${workspaceId}, ${customers[0].id}, 'whatsapp_message_received', 'whatsapp', ${sql.json({ conversationId: conversations[0].id, messageId: message.id })})`;
  if (existing.length || !whatsappConfigured()) return;
  const businesses = await sql<{ name: string; booking_slug: string | null }[]>`select w.name, ws.booking_slug from workspaces w join workspace_settings ws on ws.workspace_id = w.id where w.id = ${workspaceId} limit 1`;
  const business = businesses[0]; if (!business) return;
  const origin = process.env.NEXT_PUBLIC_APP_URL || "https://www.rasphia.com"; const reply = `Hi${customerName ? ` ${customerName.split(" ")[0]}` : ""}, thanks for contacting ${business.name}. A team member will be with you shortly.${business.booking_slug ? ` To request an appointment now, use ${origin}/book/${business.booking_slug}.` : ""}`;
  try {
    const providerMessageId = await sendWhatsAppText({ to: phone, body: reply });
    await sql`insert into conversation_messages (workspace_id, conversation_id, customer_id, channel, direction, provider_message_id, message_type, body, status, metadata) values (${workspaceId}, ${conversations[0].id}, ${customers[0].id}, 'whatsapp', 'outbound', ${providerMessageId}, 'text', ${reply}, 'sent', ${sql.json({ workflow: 'inbound_acknowledgement' })})`;
    await sql`insert into outbound_messages (workspace_id, customer_id, channel, recipient, template_key, provider_message_id, status, metadata, sent_at) values (${workspaceId}, ${customers[0].id}, 'whatsapp', ${phone}, 'inbound_acknowledgement', ${providerMessageId}, 'sent', ${sql.json({ conversationId: conversations[0].id })}, now())`;
  } catch {
    await sql`update customer_conversations set status = 'needs_human', updated_at = now() where id = ${conversations[0].id}`;
  }
}
