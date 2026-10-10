// src/app/redirect/route.ts
import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { routeForUser, type Book } from "@/lib/auth/routing";
import { resolveClassDeviceClassIds } from "@/lib/class-device-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
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


  const rawBook = url.searchParams.get("book");
  const book: Book | undefined =
    rawBook === "grades" ? "grades" : rawBook === "attendance" ? "attendance" : undefined;

  const supabase = await getSupabaseServerClient();

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
        // À la connexion normale, le téléphone de classe doit d'abord choisir
        // son cahier. Un cahier explicite conserve son routage direct.
        if (!book) {
          return withNoStore(
            NextResponse.redirect(new URL("/choose-book", url)),
          );
        }

        const dest =
          book === "grades" ? "/grades/class-device" : "/class";
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
