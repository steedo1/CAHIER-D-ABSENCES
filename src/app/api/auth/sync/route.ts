import { NextResponse } from "next/server";

const SECURE = process.env.NODE_ENV === "production";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function projectRefFromUrl(url?: string | null) {
  const m = url?.match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return m?.[1] ?? null;
}

type Body = { access_token?: string; refresh_token?: string };

export async function POST(req: Request) {
  let payload: Body | null = null;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "BAD_JSON" }, { status: 400 });
  }

  const { access_token, refresh_token } = payload ?? {};
  if (!access_token || !refresh_token) {
    return NextResponse.json({ ok: false, error: "TOKENS_REQUIRED" }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });

  res.cookies.set({
    name: "sb-access-token",
    value: access_token,
    httpOnly: true, sameSite: "lax", secure: SECURE, path: "/", maxAge: 60 * 60,
  });
  res.cookies.set({
    name: "sb-refresh-token",
    value: refresh_token,
    httpOnly: true, sameSite: "lax", secure: SECURE, path: "/", maxAge: 60 * 60 * 24 * 30,
  });

  const projectRef = projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (projectRef) {
    // httpOnly autorisé (on lit côté middleware). Si tu veux que le SDK web y accède, retire httpOnly.
    res.cookies.set({
      name: `sb-${projectRef}-auth-token`,
      value: JSON.stringify({ currentSession: { access_token, refresh_token }, currentUser: null }),
      httpOnly: true, sameSite: "lax", secure: SECURE, path: "/", maxAge: 60 * 60,
    });
  }

  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  for (const name of ["sb-access-token", "sb-refresh-token"]) {
    res.cookies.set({ name, value: "", httpOnly: true, sameSite: "lax", secure: SECURE, path: "/", maxAge: 0 });
  }
  const projectRef = projectRefFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (projectRef) {
    res.cookies.set({ name: `sb-${projectRef}-auth-token`, value: "", httpOnly: true, sameSite: "lax", secure: SECURE, path: "/", maxAge: 0 });
  }
  return res;
}
