import { NextResponse } from "next/server";
import { signOut } from "../../../../lib/auth";

export async function POST(request: Request) { await signOut(); return NextResponse.redirect(new URL("/", request.url), { status: 303 }); }
