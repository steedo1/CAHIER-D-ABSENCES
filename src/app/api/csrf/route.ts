// src/app/api/csrf/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";

export async function GET() {
  const token = crypto.randomBytes(24).toString("hex");
  const res = NextResponse.json({ token });
  const SECURE = process.env.NODE_ENV === "production";
  res.cookies.set("csrf_token", token, { httpOnly: true, sameSite: "lax", path: "/", secure: SECURE });
  return res;
}
