import { get } from "@vercel/blob";

export const runtime = "nodejs";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const result = await get("diagnoses/" + id + "/strategy-report.html", { access: "public" });
  if (!result || result.statusCode !== 200 || !result.stream) return new Response("Report not found", { status: 404 });
  return new Response(result.stream, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": "inline", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
}
