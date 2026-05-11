// src/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { normalizePhone, canonicalPrefix, sanitize } from "@/lib/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECURE = process.env.NODE_ENV === "production";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Génère des candidats de connexion à partir d'un numéro saisi :
 * - n1 : normalisation standard.
 * - n2 : préfixe pays + numéro tel que saisi, utile quand le 0 local doit être conservé.
 */
function phoneCandidates(raw: string, country?: string): string[] {
  const candidates: string[] = [];

  const norm =
    country && typeof country === "string" && country.trim()
      ? normalizePhone(raw, { defaultCountryAlpha2: country.trim().toUpperCase() })
      : normalizePhone(raw);
  if (norm) candidates.push(norm);

  const pref = canonicalPrefix(undefined); // lit ENV, défaut +225
  const digitsOnly = sanitize(raw).replace(/^\+/, "");
  if (digitsOnly) {
    const keep0 = pref + digitsOnly;
    const len = keep0.replace(/^\+/, "").length;
    if (len >= 6 && len <= 15 && !candidates.includes(keep0)) {
      candidates.push(keep0);
    }
  }

  return candidates;
}

function projectRefFromUrl(url?: string | null) {
  const m = url?.match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return m?.[1] ?? null;
}

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

  // Cookies simples lus explicitement par /redirect.
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

  // Compat avec les clients Supabase SSR existants du projet.
  const projectRef = projectRefFromUrl(SUPABASE_URL);
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

function jsonError(error: string, status: number) {
  return withNoStore(NextResponse.json({ ok: false, error }, { status }));
}

async function signInWithEmail(email: string, password: string) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
}

async function signInWithPhone(phone: string, password: string, country?: string) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const tries = phoneCandidates(phone, country);
  if (tries.length === 0) {
    return { data: null, error: { message: "PHONE_INVALID" } as any };
  }

  let lastErr: any = null;
  for (const candidate of tries) {
    const resp = await supabase.auth.signInWithPassword({
      phone: candidate,
      password,
    });
    if (!resp.error) return resp;
    lastErr = resp.error;
  }

  return { data: null, error: lastErr };
}

export async function POST(req: NextRequest) {
  try {
    const { email, phone, password, country } = await req.json();

    if (!password) return jsonError("PASSWORD_REQUIRED", 400);

    const hasEmail = typeof email === "string" && email.trim().length > 0;
    const hasPhone = typeof phone === "string" && phone.trim().length > 0;

    if (!hasEmail && !hasPhone) return jsonError("EMAIL_OR_PHONE_REQUIRED", 400);

    const resp = hasEmail
      ? await signInWithEmail(String(email), String(password))
      : await signInWithPhone(
          String(phone),
          String(password),
          typeof country === "string" ? country : undefined
        );

    if (resp.error) {
      return jsonError(resp.error.message || "INVALID_LOGIN", 401);
    }

    const session = resp.data?.session;
    const user = resp.data?.user;

    if (!session?.access_token || !session?.refresh_token || !user?.id) {
      return jsonError("SESSION_NOT_CREATED", 401);
    }

    const res = NextResponse.json(
      {
        ok: true,
        user: {
          id: user.id,
          email: user.email ?? null,
          phone: (user as any).phone ?? null,
        },
        // Le front l’utilise pour synchroniser le SDK navigateur immédiatement.
        session: {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_at: session.expires_at ?? null,
          token_type: session.token_type ?? "bearer",
        },
      },
      { status: 200 }
    );

    setAuthCookies(res, session.access_token, session.refresh_token);
    return withNoStore(res);
  } catch (e: any) {
    return jsonError(e?.message ?? "UNKNOWN_ERROR", 500);
  }
}
