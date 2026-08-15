import { Resend } from "resend";
import type { Strategy } from "./business-diagnosis";

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
const items = (values: string[]) => values.map((value) => `<li style="margin:0 0 8px">${escapeHtml(value)}</li>`).join("");
export async function sendDiagnosisEmail({ to, businessName, report, previewUrl, reportUrl }: { to: string; businessName: string; report: Strategy; previewUrl?: string | null; reportUrl?: string | null }) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return false;
  const preview = previewUrl ? `<p><a href="${previewUrl}" style="display:inline-block;padding:12px 18px;background:#cda752;color:#132e32;text-decoration:none;border-radius:6px;font-weight:700">See your website concept</a></p>` : "";
  const archive = reportUrl ? `<p style="font-size:13px;color:#5a6f6c">Your complete report archive: <a href="${reportUrl}">view online</a>.</p>` : "";
  await new Resend(process.env.RESEND_API_KEY).emails.send({ from: process.env.RESEND_FROM_EMAIL, to, subject: `${businessName}: your Rasphia growth strategy`, html: `<main style="max-width:680px;margin:0 auto;padding:28px;background:#f5f3ed;color:#132e32;font:16px/1.5 Arial,sans-serif"><p style="margin:0;color:#55706c;font-size:12px;letter-spacing:.08em;text-transform:uppercase">Rasphia business diagnosis</p><h1 style="margin:8px 0 14px;font:42px/1.05 Georgia,serif">Your next best moves for ${escapeHtml(businessName)}</h1><p style="color:#55706c">${escapeHtml(report.summary)}</p>${preview}<section style="margin-top:24px;padding:22px;background:#fff;border:1px solid #d6ddd8;border-radius:10px"><h2 style="margin:0 0 12px;font:27px Georgia,serif">Your first week</h2><ol style="padding-left:20px;color:#405a56">${items(report.firstWeek)}</ol></section><section style="margin-top:18px;padding:22px;background:#e8efeb;border-radius:10px"><h2 style="margin:0 0 8px;font:27px Georgia,serif">What to skip</h2><p style="margin:0">${escapeHtml(report.whatToSkip || report.watchouts[0] || "Avoid adding new spend before the core path is working.")}</p></section>${archive}</main>` });
  return true;
}
