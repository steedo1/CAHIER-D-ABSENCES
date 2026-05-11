// src/app/api/auth/signout/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECURE = process.env.NODE_ENV === "production";

function projectRefFromUrl(url?: string | null) {
  const m = url?.match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return m?.[1] ?? null;
}

function withNoStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function clearCookie(res: NextResponse, name: string, httpOnly = true) {
  res.cookies.set({
    name,
    value: "",
    httpOnly,
    sameSite: "lax",
    secure: SECURE,
    path: "/",
    maxAge: 0,
  });
}

function clearAuthCookies(res: NextResponse) {
  clearCookie(res, "sb-access-token");
  clearCookie(res, "sb-refresh-token");

  const projectRef = projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (projectRef) clearCookie(res, `sb-${projectRef}-auth-token`);

  clearCookie(res, "mc_last_dest", false);
  clearCookie(res, "mc_last_dest_attendance", false);
  clearCookie(res, "mc_last_dest_grades", false);
}

export async function POST() {
  try {
    const supabase = await getSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // Tolérant : l'objectif principal est de nettoyer les cookies côté navigateur.
  }

  const res = NextResponse.json({ ok: true }, { status: 200 });
  clearAuthCookies(res);
  return withNoStore(res);
}
