// src/app/parents/logout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // 1) Déconnexion Supabase (compte parent éventuellement connecté)
    try {
      const supa = await getSupabaseServerClient();
      await supa.auth.signOut();
    } catch {
      // on ignore: on redirigera quand même
    }

    // 2) Redirection vers le login parents + purge du cookie device
    const res = NextResponse.redirect(new URL("/parents/login", req.url), { status: 302 });
    res.cookies.set("parent_device", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0, // supprime le cookie
    });
    return res;
  } catch {
    // Fallback ultra-sûr
    return NextResponse.redirect(new URL("/parents/login", req.url), { status: 302 });
  }
}
