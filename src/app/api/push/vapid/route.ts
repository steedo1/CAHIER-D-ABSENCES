import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ key: process.env.VAPID_PUBLIC_KEY || "" });
}
