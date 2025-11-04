// src/app/api/push/vapid/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const key = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || "").trim();
  if (!key) return NextResponse.json({ error: "missing VAPID public key" }, { status: 500 });
  return NextResponse.json({ key });
}
