import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PRODUCTION_ROLE } from "../production-nexa";
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
  const { data: { session } } = await supabase.auth.getSession();
  // This check only denies access. Route handlers independently verify getUser
  // and current account permissions before using any production data.
  // getSession()'s user object is mutable in browser storage. Read the role
  // claim, which cannot be altered while preserving a valid Supabase JWT.
  let role: string | undefined;
  try {
    const encoded = session?.access_token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (encoded) role = JSON.parse(atob(encoded)).role;
  } catch { /* The destination still verifies its session. */ }
  const ownPaths = ["/", "/redirect", "/logout", "/production-nexa", "/api/production-nexa", "/api/auth/role"];
  if (role === PRODUCTION_ROLE && !ownPaths.some(prefix => path === prefix || (prefix !== "/" && path.startsWith(prefix + "/")))) {
    const denied = path.startsWith("/api/")
      ? NextResponse.json({ error: "acces_reserve_a_production_nexa" }, { status: 403 })
      : NextResponse.redirect(new URL("/production-nexa", request.nextUrl));
    for (const cookie of response.cookies.getAll()) denied.cookies.set(cookie);
    denied.headers.set("Cache-Control", "private, no-store");
    return denied;
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
