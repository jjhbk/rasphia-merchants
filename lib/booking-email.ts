import { Resend } from "resend";

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);

export async function sendBookingEmails(input: { businessName: string; senderSlug: string; merchantEmail: string; customerEmail: string; customerName: string; serviceName: string; startsAt: Date; timezone: string; status: "requested" | "confirmed" }) {
  if (!process.env.RESEND_API_KEY) return { customerId: null, merchantId: null };
  const date = new Intl.DateTimeFormat("en", { dateStyle: "full", timeStyle: "short", timeZone: input.timezone }).format(input.startsAt);
  const from = `${input.businessName} via Rasphia <${input.senderSlug}@rasphia.com>`;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const heading = input.status === "confirmed" ? "Your booking is confirmed" : "We received your booking request";
  const [customer, merchant] = await Promise.allSettled([
    resend.emails.send({ from, to: input.customerEmail, subject: `${heading} with ${input.businessName}`, html: `<main style="max-width:620px;margin:0 auto;padding:28px;background:#f5f3ed;color:#132e32;font:16px/1.5 Arial,sans-serif"><p style="margin:0;color:#55706c;font-size:12px;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(input.businessName)}</p><h1 style="margin:8px 0 14px;font:36px/1.05 Georgia,serif">${heading}</h1><p>Hi ${escapeHtml(input.customerName)},</p><p>${input.status === "confirmed" ? "Your time is reserved." : "The business has been notified and will confirm your time shortly."}</p><section style="padding:18px;background:#fff;border:1px solid #d6ddd8;border-radius:10px"><b>${escapeHtml(input.serviceName)}</b><br/>${escapeHtml(date)}</section></main>` }),
    resend.emails.send({ from, to: input.merchantEmail, subject: `New booking ${input.status === "confirmed" ? "confirmed" : "request"}: ${input.serviceName}`, html: `<main style="max-width:620px;margin:0 auto;padding:28px;background:#f5f3ed;color:#132e32;font:16px/1.5 Arial,sans-serif"><p style="margin:0;color:#55706c;font-size:12px;letter-spacing:.08em;text-transform:uppercase">Rasphia booking</p><h1 style="margin:8px 0 14px;font:36px/1.05 Georgia,serif">New ${input.status === "confirmed" ? "confirmed booking" : "booking request"}</h1><p><b>${escapeHtml(input.customerName)}</b> requested ${escapeHtml(input.serviceName)}.</p><section style="padding:18px;background:#fff;border:1px solid #d6ddd8;border-radius:10px"><b>${escapeHtml(input.serviceName)}</b><br/>${escapeHtml(date)}<br/>${escapeHtml(input.customerEmail)}</section></main>` }),
  ]);
  return { customerId: customer.status === "fulfilled" ? customer.value.data?.id || null : null, merchantId: merchant.status === "fulfilled" ? merchant.value.data?.id || null : null };
}
