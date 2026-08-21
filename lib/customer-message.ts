import { Resend } from "resend";

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);

export async function sendCustomerEmail(input: { businessName: string; senderSlug: string; to: string; customerName: string | null; body: string }) {
  if (!process.env.RESEND_API_KEY) throw new Error("Email delivery is not configured.");
  const from = `${input.businessName} via Rasphia <${input.senderSlug}@rasphia.com>`;
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send({ from, to: input.to, subject: `Update from ${input.businessName}`, html: `<main style="max-width:620px;margin:0 auto;padding:28px;background:#f5f3ed;color:#132e32;font:16px/1.5 Arial,sans-serif"><p style="margin:0;color:#55706c;font-size:12px;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(input.businessName)}</p><h1 style="margin:8px 0 14px;font:32px/1.05 Georgia,serif">An update for you</h1><p>Hi ${escapeHtml(input.customerName || "there")},</p><p style="white-space:pre-wrap">${escapeHtml(input.body)}</p></main>` });
  if (result.error) throw new Error(result.error.message || "Email could not be sent.");
  return result.data?.id || null;
}
