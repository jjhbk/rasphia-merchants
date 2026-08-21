import { randomUUID } from "crypto";

export function whatsappConfigured() { return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_PHONE_NUMBER); }
export function intakeLink(keyword: string) { return `https://wa.me/${process.env.WHATSAPP_PHONE_NUMBER || ""}?text=${encodeURIComponent(`Rasphia ${keyword}`)}`; }

export type WhatsAppTemplate = { name: string; language: string; category: string; components: unknown[] };
export async function approvedWhatsAppTemplates() {
  if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_BUSINESS_ACCOUNT_ID) throw new Error("WhatsApp Business Account is not configured.");
  const url = new URL(`https://graph.facebook.com/v22.0/${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`); url.searchParams.set("fields", "name,language,status,category,components"); url.searchParams.set("limit", "250");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }, cache: "no-store" });
  if (!response.ok) throw new Error("WhatsApp could not load approved templates."); const data = await response.json() as { data?: Array<{ name?: string; language?: string; status?: string; category?: string; components?: unknown[] }> };
  return (data.data || []).filter((template) => template.status === "APPROVED" && template.name && template.language).map((template) => ({ name: template.name!, language: template.language!, category: template.category || "UTILITY", components: template.components || [] })) as WhatsAppTemplate[];
}

export async function sendWhatsAppText(input: { to: string; body: string }) {
  if (!whatsappConfigured()) throw new Error("WhatsApp is not configured.");
  const response = await fetch(`https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, { method: "POST", headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: input.to.replace(/\D/g, ""), type: "text", text: { preview_url: false, body: input.body.slice(0, 4096) } }), cache: "no-store" });
  if (!response.ok) { const details = await response.text().catch(() => ""); console.error("WhatsApp direct message failed", response.status, details.slice(0, 1000)); throw new Error("WhatsApp could not send the direct reply."); } const data = await response.json() as { messages?: Array<{ id?: string }> }; return data.messages?.[0]?.id || randomUUID();
}

export async function sendWhatsAppTemplate(input: { to: string; template: string; language?: string; components?: unknown[] }) {
  if (!whatsappConfigured()) throw new Error("WhatsApp is not configured.");
  const response = await fetch(`https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, { method: "POST", headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: input.to.replace(/\D/g, ""), type: "template", template: { name: input.template, language: { code: input.language || "en" }, components: input.components || [] } }), cache: "no-store" });
  if (!response.ok) { const details = await response.text().catch(() => ""); console.error("WhatsApp template message failed", response.status, details.slice(0, 1000)); throw new Error("WhatsApp could not send the approved template."); } const data = await response.json() as { messages?: Array<{ id?: string }> }; return data.messages?.[0]?.id || randomUUID();
}
