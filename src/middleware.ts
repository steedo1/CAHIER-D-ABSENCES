import { updateServerSession } from "@/lib/auth/session-middleware";
import { isSessionCookie } from "@/lib/auth/session-cookies";
import { NextResponse, type NextRequest } from "next/server";
import {
  OFFLINE_ACCESS_COOKIE,
  OFFLINE_DEVICE_COOKIE,
  verifyOfflineAccessGrant,
} from "@/lib/offline-auth-contract";

const PUBLIC = new Set(["/login", "/recover", "/redirect"]);

const PROTECTED_PREFIXES = [
  "/attendance",
  "/class",
  "/admin",
  "/super",
  "/founder",
  "/parent",
  "/profile",
  "/(protected)",
];

export async function middleware(req: NextRequest) {
  const sessionResponse = await updateServerSession(req);
  const guarded = await guardPage(req);
  if (guarded.headers.has("location")) {
    for (const cookie of sessionResponse.cookies.getAll()) guarded.cookies.set(cookie);
    guarded.headers.set("Cache-Control", "private, no-store");
    return guarded;
  }
  for (const [name, value] of guarded.headers) {
    if (name !== "x-middleware-next") sessionResponse.headers.set(name, value);
  }
  return sessionResponse;
}

async function guardPage(req: NextRequest) {
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

  const hasSessionCookie = c.getAll().some((cookie) => isSessionCookie(cookie.name)) || hasSbAccess || hasSbRefresh || hasAuthToken;

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

// Les API passent aussi par la persistance de session ; exclure les assets.
export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"],
};
