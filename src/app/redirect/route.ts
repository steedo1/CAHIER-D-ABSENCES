// src/app/redirect/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { routeForUser, type Book } from "@/lib/auth/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function attachLastDest(res: NextResponse, dest: string, book?: Book) {
  // Cookie lisible côté client (pas httpOnly) pour fallback offline
  const encoded = encodeURIComponent(dest);
  const base = {
    path: "/",
    sameSite: "lax" as const,
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 30, // 30 jours
  };

  res.cookies.set("mc_last_dest", encoded, base);
  if (book) res.cookies.set(`mc_last_dest_${book}`, encoded, base);

  return res;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();

  const access = jar.get("sb-access-token")?.value ?? null;
  const refresh = jar.get("sb-refresh-token")?.value ?? null;

  const rawBook = url.searchParams.get("book");
  const book: Book | undefined =
    rawBook === "grades" ? "grades" : rawBook === "attendance" ? "attendance" : undefined;

  if (!access || !refresh) {
    const loginUrl = new URL("/login", url);
    if (book) loginUrl.searchParams.set("book", book);
    return NextResponse.redirect(loginUrl);
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      get: (n) => jar.get(n)?.value,
      set() {},
      remove() {},
    },
  });

  try {
    await supabase.auth.setSession({ access_token: access, refresh_token: refresh });
  } catch {
    // tolérant
  }

  const {
    data: { user } = { user: null },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/login", url);
    if (book) loginUrl.searchParams.set("book", book);
    return NextResponse.redirect(loginUrl);
  }

  // 1) Cas spécial : compte-classe
  if (SERVICE_KEY) {
    try {
      const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

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
          const dest =
            book === "grades" ? "/grades/class-device" : `/class/${cls.id}`;

          const res = NextResponse.redirect(new URL(dest, url));
          return attachLastDest(res, dest, book);
        }
      }
    } catch {
      // on continue sur le routage standard
    }
  }

  // 2) Routage standard par rôle, sensible à "book"
  const dest = (await routeForUser(user.id, supabase, book)) || "/profile";
  const res = NextResponse.redirect(new URL(dest, url));
  return attachLastDest(res, dest, book);
}
