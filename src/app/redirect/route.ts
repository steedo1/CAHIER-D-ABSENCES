// src/app/redirect/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { routeForUser, type Book } from "@/lib/auth/routing";
import { resolveClassDeviceClassIds } from "@/lib/class-device-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function withNoStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function attachLastDest(res: NextResponse, dest: string, book?: Book) {
  // Cookie lisible côté client pour fallback offline.
  const base = {
    path: "/",
    sameSite: "lax" as const,
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 30, // 30 jours
  };

  res.cookies.set("mc_last_dest", dest, base);
  if (book) res.cookies.set(`mc_last_dest_${book}`, dest, base);

  return withNoStore(res);
}

function loginRedirect(url: URL, book?: Book) {
  const loginUrl = new URL("/login", url);
  if (book) loginUrl.searchParams.set("book", book);
  return withNoStore(NextResponse.redirect(loginUrl));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();

  const rawBook = url.searchParams.get("book");
  const book: Book | undefined =
    rawBook === "grades" ? "grades" : rawBook === "attendance" ? "attendance" : undefined;

  const access = jar.get("sb-access-token")?.value ?? null;
  const refresh = jar.get("sb-refresh-token")?.value ?? null;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      get: (n) => jar.get(n)?.value,
      set() {},
      remove() {},
    },
  });

  // Cas principal : nos cookies simples existent, donc on force la session côté serveur.
  if (access && refresh) {
    try {
      await supabase.auth.setSession({ access_token: access, refresh_token: refresh });
    } catch {
      // Tolérant : getUser ci-dessous décidera.
    }
  }

  // Cas tolérant : même si nos cookies simples manquent, le cookie Supabase standard peut exister.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return loginRedirect(url, book);

  // 1) Cas spécial : compte-classe.
  if (SERVICE_KEY) {
    try {
      const svc = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const classIds = await resolveClassDeviceClassIds({
        service: svc,
        userId: user.id,
        userPhone: user.phone,
      });
      if (classIds.length > 0) {
        const dest = book === "grades" ? "/grades/class-device" : "/class";
        const res = NextResponse.redirect(new URL(dest, url));
        return attachLastDest(res, dest, book);
      }
    } catch {
      // On continue sur le routage standard.
    }
  }

  // 2) Routage standard par rôle, sensible à "book".
  const dest = (await routeForUser(user.id, supabase, book)) || "/profile";
  const res = NextResponse.redirect(new URL(dest, url));
  return attachLastDest(res, dest, book);
}
