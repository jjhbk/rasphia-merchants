import { NextResponse } from "next/server";
import postgres from "postgres";

export const runtime = "nodejs";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const value = (field: string, maxLength: number) => typeof body[field] === "string" ? body[field].trim().slice(0, maxLength) : "";
  const name = value("name", 120);
  const businessName = value("businessName", 160);
  const email = value("email", 254).toLowerCase();
  const phone = value("phone", 40);
  const businessType = value("businessType", 100);
  const message = value("message", 2000);
  if (!name || !businessName || !emailPattern.test(email)) return NextResponse.json({ error: "Please provide your name, business name, and a valid email." }, { status: 422 });

  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Interest registration is not configured yet." }, { status: 503 });
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    await sql`insert into merchant_interests (name, business_name, email, phone, business_type, message) values (${name}, ${businessName}, ${email}, ${phone || null}, ${businessType || null}, ${message || null})`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Could not save merchant interest", error);
    return NextResponse.json({ error: "We couldn't save your details. Please try again." }, { status: 502 });
  } finally { await sql.end(); }
}
