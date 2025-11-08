import { NextRequest, NextResponse } from "next/server";
import { clearParentSessionCookie } from "@/lib/parent-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Appelée depuis un <form method="post"> ou un fetch() */
export async function POST() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Set-Cookie": clearParentSessionCookie(),
      "Cache-Control": "no-store",
    },
  });
}

/** Pratique si on visite l’URL depuis la barre d’adresse */
export async function GET(req: NextRequest) {
  const url = new URL("/parents/login", req.url);
  return NextResponse.redirect(url, {
    headers: { "Set-Cookie": clearParentSessionCookie() },
  });
}
