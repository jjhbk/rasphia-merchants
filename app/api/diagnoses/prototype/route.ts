import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { bookingPrototypeHtml } from "../../../../lib/business-prototype";
import type { Research, Strategy } from "../../../../lib/business-diagnosis";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { id?: unknown; businessName?: unknown; report?: unknown; research?: unknown }; try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const businessName = typeof body.businessName === "string" ? body.businessName.trim().slice(0, 160) : "";
  if (!businessName || !body.report || typeof body.report !== "object") return NextResponse.json({ error: "A completed diagnosis is required to create a preview." }, { status: 422 });
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: "Website previews are not configured yet." }, { status: 503 });
  const suppliedId = typeof body.id === "string" ? body.id : ""; const id = /^[0-9a-f-]{36}$/i.test(suppliedId) ? suppliedId : randomUUID();
  try {
    const html = await bookingPrototypeHtml(businessName, body.report as Strategy, body.research as Research | undefined);
    await put(`diagnoses/${id}/booking-preview.html`, html, { access: "public", contentType: "text/html", addRandomSuffix: false, allowOverwrite: true });
    return NextResponse.json({ url: `/api/diagnoses/prototype/${id}` });
  } catch (error) { console.error("Could not create booking prototype", error); return NextResponse.json({ error: "We couldn’t create the preview. Please try again." }, { status: 502 }); }
}
