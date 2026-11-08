// src/app/api/parent/logout/route.ts
import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/parent-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearParentCookies(res: NextResponse) {
  const clear = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  };
  res.cookies.set("parent_device", "", clear);
  res.cookies.set(COOKIE_NAME, "", clear);
  return res;
}

/** Appelée depuis un fetch(). Aucune redirection serveur à suivre. */
export async function POST() {
  return clearParentCookies(new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "private, no-store" },
  }));
}

/** Compatible avec la navigation directe : ne jamais renvoyer l'adresse Render interne. */
export async function GET() {
  return clearParentCookies(new NextResponse(null, {
    status: 303,
    headers: {
      Location: "https://www.mon-cahier.com/parents/login",
      "Cache-Control": "private, no-store",
    },
  }));
}
