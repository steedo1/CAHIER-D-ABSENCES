import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = new Set(["/login", "/recover", "/redirect"]);
const PROTECTED_PREFIXES = ["/attendance", "/admin", "/super", "/parent", "/profile", "/(protected)"];

export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const { pathname } = url;

  // Laisser passer les routes publiques
  if (PUBLIC.has(pathname)) return NextResponse.next();

  // ProtÃ©ger uniquement les prÃ©fixes dÃ©clarÃ©s
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  if (!isProtected) return NextResponse.next();

  // DÃ©tection des cookies Supabase
  const c = req.cookies;
  const hasSbAccess = !!c.get("sb-access-token");
  const hasSbRefresh = !!c.get("sb-refresh-token");

  // Optionnel : cookie sb-<projectRef>-auth-token
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

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"], // on laisse passer les assets
};
