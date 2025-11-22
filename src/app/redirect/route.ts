// src/app/redirect/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js"; // ✅ service client
import { routeForUser, type Book } from "@/lib/auth/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || ""; // ✅ si absent, on saute la détection "compte-classe"

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies(); // ✅ dans ton setup, cookies() est async → on attend

  const access  = jar.get("sb-access-token")?.value ?? null;
  const refresh = jar.get("sb-refresh-token")?.value ?? null;

  // Normalise le choix du cahier (attendance | grades | undefined)
  const rawBook = url.searchParams.get("book");
  const book: Book | undefined =
    rawBook === "grades" ? "grades" :
    rawBook === "attendance" ? "attendance" :
    undefined;

  if (!access || !refresh) {
    // Non connecté → propage le choix du cahier vers /login
    const loginUrl = new URL("/login", url);
    if (book) loginUrl.searchParams.set("book", book);
    return NextResponse.redirect(loginUrl);
  }

  // Client lié aux cookies (RLS) pour identifier l'utilisateur
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      get: (n) => jar.get(n)?.value,
      set() {}, // noop
      remove() {}, // noop
    },
  });

  try {
    await supabase.auth.setSession({ access_token: access, refresh_token: refresh });
  } catch {
    // tolérant
  }

  const { data: { user } = { user: null } } = await supabase.auth.getUser();
  if (!user) {
    const loginUrl = new URL("/login", url);
    if (book) loginUrl.searchParams.set("book", book);
    return NextResponse.redirect(loginUrl);
  }

  // ─────────────────────────────────────────────
  // 1) Cas spécial : "compte de classe" (login via téléphone de classe)
  //    Lecture phone E.164 depuis auth.users via SERVICE KEY,
  //    puis recherche d'une classe qui possède ce numéro.
  // ─────────────────────────────────────────────
  if (SERVICE_KEY) {
    try {
      const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // Récupère le téléphone exact en E.164 (si exposé)
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
          // ✅ Compte-classe détecté → tableau de bord de la classe
          return NextResponse.redirect(new URL(`/class/${cls.id}`, url));
        }
      }
    } catch {
      // En cas d'erreur service, on continue sur le routage standard
    }
  }

  // ─────────────────────────────────────────────
  // 2) Routage standard par rôle, sensible à "book" (Absences / Notes)
  // ─────────────────────────────────────────────
  const dest = await routeForUser(user.id, supabase, book);
  return NextResponse.redirect(new URL(dest || "/profile", url));
}
