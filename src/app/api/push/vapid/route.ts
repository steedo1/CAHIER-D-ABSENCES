//src/app/api/push/vapid/route.ts
import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({ key: process.env.VAPID_PUBLIC_KEY || "" });
}


