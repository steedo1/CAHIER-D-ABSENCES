import { NextResponse, type NextRequest } from "next/server";
import {
  OFFLINE_ACCESS_COOKIE,
  OFFLINE_DEVICE_COOKIE,
  verifyOfflineAccessGrant,
} from "./src/lib/offline-auth-contract";

const PUBLIC = new Set(["/login", "/recover", "/redirect"]);
const PROTECTED_PREFIXES = ["/attendance", "/class", "/admin", "/super", "/founder", "/parent", "/profile", "/(protected)"];

export async function middleware(req: NextRequest) {
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
    const offlineToken = c.get(OFFLINE_ACCESS_COOKIE)?.value || "";
    const offlineDeviceId = c.get(OFFLINE_DEVICE_COOKIE)?.value || "";
    const offlineSecret =
      process.env.MON_CAHIER_OFFLINE_AUTH_SECRET ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "";
    if (offlineToken && offlineDeviceId && offlineSecret.length >= 32) {
      const grant = await verifyOfflineAccessGrant({
        token: offlineToken,
        secret: offlineSecret,
        pathname,
        deviceId: offlineDeviceId,
      });
      if (grant) {
        const response = NextResponse.next();
        response.headers.set("X-Mon-Cahier-Offline-Access", "1");
        return response;
      }
    }
    url.pathname = "/login";
    url.searchParams.set("offline", "required");
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Exclure _next, assets statiques ET /api
export const config = {
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
