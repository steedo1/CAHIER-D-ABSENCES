// src/app/parents/logout/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { COOKIE_NAME } from "@/lib/parent-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Déconnecter aussi un éventuel compte Supabase, sans empêcher la purge
  // des cookies parents si le service d'authentification ne répond pas.
  try {
    const supa = await getSupabaseServerClient();
    await supa.auth.signOut();
  } catch {
    // La déconnexion locale doit toujours réussir.
  }

  // Canonical public URL: relative Location was resolved against Render's
  // internal origin (0.0.0.0:10000) for parent logout in production.
  const res = new NextResponse(null, {
    status: 303,
    headers: {
      Location: "https://www.mon-cahier.com/parents/login",
      "Cache-Control": "private, no-store",
    },
  });

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
