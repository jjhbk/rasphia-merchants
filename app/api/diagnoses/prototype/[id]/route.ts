import { get } from "@vercel/blob";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return new Response("Not found", { status: 404 });
  try {
    const result = await get(`diagnoses/${id}/booking-preview.html`, { access: "public" });
    if (!result || result.statusCode !== 200 || !result.stream) return new Response("Preview not found", { status: 404 });
    return new Response(result.stream, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `inline; filename="${id}-website-concept.html"`, "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { console.error("Could not serve website concept", error); return new Response("Preview unavailable", { status: 502 }); }
}
