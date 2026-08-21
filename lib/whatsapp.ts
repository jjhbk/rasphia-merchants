import { randomUUID } from "crypto";

export function whatsappConfigured() { return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_PHONE_NUMBER && process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_APP_SECRET); }
export function intakeLink(keyword: string) { return `https://wa.me/${process.env.WHATSAPP_PHONE_NUMBER || ""}?text=${encodeURIComponent(`Rasphia ${keyword}`)}`; }

export async function sendWhatsAppText(input: { to: string; body: string }) {
  if (!whatsappConfigured()) throw new Error("WhatsApp is not configured.");
  const response = await fetch(`https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, { method: "POST", headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: input.to.replace(/\D/g, ""), type: "text", text: { preview_url: false, body: input.body.slice(0, 4096) } }), cache: "no-store" });
  if (!response.ok) throw new Error("WhatsApp could not send the direct reply."); const data = await response.json() as { messages?: Array<{ id?: string }> }; return data.messages?.[0]?.id || randomUUID();
}

export async function sendWhatsAppTemplate(input: { to: string; template: string; language?: string; components?: unknown[] }) {
  if (!whatsappConfigured()) throw new Error("WhatsApp is not configured.");
  const response = await fetch(`https://graph.facebook.com/v22.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, { method: "POST", headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: input.to.replace(/\D/g, ""), type: "template", template: { name: input.template, language: { code: input.language || "en" }, components: input.components || [] } }), cache: "no-store" });
  if (!response.ok) throw new Error("WhatsApp could not send the approved template."); const data = await response.json() as { messages?: Array<{ id?: string }> }; return data.messages?.[0]?.id || randomUUID();
}
