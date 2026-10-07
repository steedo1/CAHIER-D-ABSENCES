import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_STORAGE_KEY, sessionCookies, isSessionCookie } from "./session-cookies";

/** Refresh transport only. getSession is NOT an authorization check. Every
 * protected handler still verifies getUser and its role/institution scope. */
export async function updateServerSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  if (["/api/auth/login", "/api/auth/sync", "/api/auth/signout"].includes(path) || path === "/login" || path === "/recover") return response;
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) return response;
  if (!sessionCookies(request.cookies.getAll(), url).some((cookie) => isSessionCookie(cookie.name))) return response;
  const supabase = createServerClient(url, key, {
    auth: { storageKey: SESSION_STORAGE_KEY },
    cookies: {
      getAll: () => sessionCookies(request.cookies.getAll(), url),
      setAll(values) {
        for (const { name, value } of values) request.cookies.set(name, value);
        const previous = response.cookies.getAll();
        response = NextResponse.next({ request });
        for (const cookie of previous) response.cookies.set(cookie);
        for (const { name, value, options } of values) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getSession();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
