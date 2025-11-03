// src/app/redirect/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js"; // ✅ service client
import { routeForUser } from "@/lib/auth/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!; // ✅ indispensable ici

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();

  const access  = jar.get("sb-access-token")?.value || null;
  const refresh = jar.get("sb-refresh-token")?.value || null;

  if (!access || !refresh) {
    return NextResponse.redirect(new URL("/login", url));
  }

  // Client lié aux cookies (RLS) pour identifier l'utilisateur
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: { get: (n) => jar.get(n)?.value, set() {}, remove() {} },
  });

  try {
    await supabase.auth.setSession({ access_token: access, refresh_token: refresh });
  } catch {}

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url));

  // ─────────────────────────────────────────────
  // 1) Cas spécial : "compte de classe" (login via téléphone de classe)
  //    On lit le téléphone depuis auth.users via le SERVICE KEY (source de vérité),
  //    puis on cherche une classe ayant ce numéro.
  // ─────────────────────────────────────────────
  try {
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Récupérer le téléphone exact en E.164
    const { data: au } = await svc
      .from("auth.users")
      .select("id, phone")
      .eq("id", user.id)
      .maybeSingle();

    const phone = (au?.phone || "").trim();
    if (phone) {
      const { data: cls } = await svc
        .from("classes")
        .select("id")
        .eq("class_phone_e164", phone)
        .maybeSingle();

      if (cls?.id) {
        // ✅ Compte-classe détecté → envoyer vers le dashboard de la classe
        return NextResponse.redirect(new URL(`/class/${cls.id}`, url));
      }
    }
  } catch {
    // en cas d’erreur admin, on retombe simplement sur le routage normal
  }

  // ─────────────────────────────────────────────
  // 2) Routage standard par rôle (teacher/admin/parent…)
  // ─────────────────────────────────────────────
  const dest = await routeForUser(user.id, supabase);
  return NextResponse.redirect(new URL(dest || "/profile", url));
}
