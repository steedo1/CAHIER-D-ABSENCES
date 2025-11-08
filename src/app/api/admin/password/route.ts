// src/app/api/admin/password/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type CookieJar = {
  get: (name: string) => { value?: string } | undefined;
};

// Extrait access/refresh depuis sb-access-token / sb-refresh-token
// et, si besoin, depuis le cookie JSON du SDK navigateur: sb-<projectRef>-auth-token
function extractTokensFromJar(jar: CookieJar) {
  let access: string | null = jar.get("sb-access-token")?.value ?? null;
  let refresh: string | null = jar.get("sb-refresh-token")?.value ?? null;

  try {
    if (!access || !refresh) {
      const projectRef =
        process.env.NEXT_PUBLIC_SUPABASE_URL?.match(
          /^https:\/\/([^.]+)\.supabase\.co/i
        )?.[1];
      const authCookieName = projectRef ? `sb-${projectRef}-auth-token` : null;
      const raw = authCookieName ? jar.get(authCookieName)?.value : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        access = access || parsed?.currentSession?.access_token || null;
        refresh = refresh || parsed?.currentSession?.refresh_token || null;
      }
    }
  } catch {
    /* noop */
  }
  return { access, refresh };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const new_password = String(body?.new_password || "").trim();
    if (!new_password || new_password.length < 6) {
      return NextResponse.json(
        { error: "Mot de passe trop court (6+)." },
        { status: 400 }
      );
    }

    // ✅ Compatible avec setups où cookies() est (ou semble) async
    const jar = (await cookies()) as unknown as CookieJar;

    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
      cookies: {
        get: (name: string) => jar.get(name)?.value,
        set() {},
        remove() {},
      },
    });

    // Hydrate la session si des tokens sont disponibles
    const { access, refresh } = extractTokensFromJar(jar);
    if (access && refresh) {
      try {
        await supabase.auth.setSession({
          access_token: access,
          refresh_token: refresh,
        });
      } catch {
        /* noop */
      }
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Non authentifie." }, { status: 401 });
    }

    const { error } = await supabase.auth.updateUser({
      password: new_password,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Erreur serveur." },
      { status: 500 }
    );
  }
}
