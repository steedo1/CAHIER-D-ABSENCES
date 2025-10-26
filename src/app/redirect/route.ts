// src/app/redirect/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { routeForUser } from "@/lib/auth/routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();

  const access  = jar.get("sb-access-token")?.value || null;
  const refresh = jar.get("sb-refresh-token")?.value || null;

  if (!access || !refresh) {
    return NextResponse.redirect(new URL("/login", url));
  }

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      get: (name) => jar.get(name)?.value,
      set() {},
      remove() {},
    },
  });

  try {
    await supabase.auth.setSession({ access_token: access, refresh_token: refresh });
  } catch {}

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url));

  // ROLE_PRIORITY (teacher > parent) déjÃ  gérée par routeForUser
  const dest = await routeForUser(user.id, supabase);
  return NextResponse.redirect(new URL(dest || "/profile", url));
}


