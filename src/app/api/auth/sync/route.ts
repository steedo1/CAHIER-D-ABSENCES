// src/app/api/auth/sync/route.ts
import { NextRequest, NextResponse } from "next/server";

const SECURE = process.env.NODE_ENV === "production";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function projectRefFromUrl(url?: string | null) {
  const m = url?.match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return m?.[1] ?? null;
}

type Body = { access_token?: string; refresh_token?: string };

function withNoStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function setAuthCookies(res: NextResponse, accessToken: string, refreshToken: string) {
  const common = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: SECURE,
    path: "/",
  };

  res.cookies.set({
    name: "sb-access-token",
    value: accessToken,
    ...common,
    maxAge: 60 * 60,
  });
  res.cookies.set({
    name: "sb-refresh-token",
    value: refreshToken,
    ...common,
    maxAge: 60 * 60 * 24 * 30,
  });

  const projectRef = projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (projectRef) {
    res.cookies.set({
      name: `sb-${projectRef}-auth-token`,
      value: JSON.stringify({
        currentSession: {
          access_token: accessToken,
          refresh_token: refreshToken,
        },
        currentUser: null,
      }),
      ...common,
      maxAge: 60 * 60,
    });
  }
}

function clearCookie(res: NextResponse, name: string) {
  res.cookies.set({
    name,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE,
    path: "/",
    maxAge: 0,
  });
}

function clearReadableCookie(res: NextResponse, name: string) {
  res.cookies.set({
    name,
    value: "",
    httpOnly: false,
    sameSite: "lax",
    secure: SECURE,
    path: "/",
    maxAge: 0,
  });
}

export async function POST(req: NextRequest) {
  let payload: Body | null = null;
  try {
    payload = await req.json();
  } catch {
    return withNoStore(
      NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 })
    );
  }

  const { access_token, refresh_token } = payload ?? {};
  if (!access_token || !refresh_token) {
    return withNoStore(
      NextResponse.json({ ok: false, error: "TOKENS_REQUIRED" }, { status: 400 })
    );
  }

  const res = NextResponse.json({ ok: true }, { status: 200 });
  setAuthCookies(res, access_token, refresh_token);
  return withNoStore(res);
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true }, { status: 200 });

  clearCookie(res, "sb-access-token");
  clearCookie(res, "sb-refresh-token");

  const projectRef = projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (projectRef) clearCookie(res, `sb-${projectRef}-auth-token`);

  // Évite qu'une ancienne destination lisible côté client perturbe une reconnexion.
  clearReadableCookie(res, "mc_last_dest");
  clearReadableCookie(res, "mc_last_dest_attendance");
  clearReadableCookie(res, "mc_last_dest_grades");

  return withNoStore(res);
}
