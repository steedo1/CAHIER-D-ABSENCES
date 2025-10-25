import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = new Set(["/login", "/recover", "/redirect"]);
const PROTECTED_PREFIXES = ["/attendance", "/admin", "/super", "/parent", "/profile", "/(protected)"];

export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const { pathname } = url;

  // Public
  if (PUBLIC.has(pathname)) return NextResponse.next();

  // Ne protéger que certains préfixes
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  if (!isProtected) return NextResponse.next();

  // Cookies Supabase
  const c = req.cookies;
  const hasSbAccess = !!c.get("sb-access-token");
  const hasSbRefresh = !!c.get("sb-refresh-token");

  const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL
    ?.match(/^https:\/\/([^.]+)\.supabase\.co/i)?.[1];
  const authTokenName = projectRef ? `sb-${projectRef}-auth-token` : null;
  const hasAuthToken = authTokenName ? !!c.get(authTokenName) : false;

  const hasSessionCookie = hasSbAccess || hasSbRefresh || hasAuthToken;

  if (!hasSessionCookie) {
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Exclure _next, assets statiques ET /api
export const config = {
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
