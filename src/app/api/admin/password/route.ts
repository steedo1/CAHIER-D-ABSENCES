// src/app/api/admin/password/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function extractTokensFromJar(jar: ReturnType<typeof cookies> extends Promise<infer T> ? T : any) {
  let access: string | null = jar.get("sb-access-token")?.value || null;
  let refresh: string | null = jar.get("sb-refresh-token")?.value || null;

  // Essaye aussi le cookie sb-<projectRef>-auth-token (SDK navigateur)
  try {
    if (!access || !refresh) {
      const projectRef =
        process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/^https:\/\/([^.]+)\.supabase\.co/i)?.[1];
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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const new_password = String(body?.new_password || "").trim();
    if (!new_password || new_password.length < 6) {
      return NextResponse.json({ error: "Mot de passe trop court (6+)." }, { status: 400 });
    }

    const jar = await cookies();
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
      cookies: {
        get: (name) => jar.get(name)?.value,
        set() {},
        remove() {},
      },
    });

    // Hydrate la session depuis les cookies disponibles
    const { access, refresh } = extractTokensFromJar(jar);
    if (access && refresh) {
      try {
        await supabase.auth.setSession({ access_token: access, refresh_token: refresh });
      } catch {}
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });

    const { error } = await supabase.auth.updateUser({ password: new_password });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erreur serveur." }, { status: 500 });
  }
}


