// src/lib/supabase-server.ts
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { AuthError, SupabaseClient, User } from "@supabase/supabase-js";

const verifiedUserByClient = new WeakMap<SupabaseClient, { data: { user: User | null }; error: AuthError | null }>();

/** setSession() valide déjà le token auprès de Supabase Auth ; on réutilise
 * cette validation pendant la même requête au lieu d'appeler /auth/v1/user
 * immédiatement une seconde fois. Le cache est lié au client de la requête. */
export function getVerifiedServerUser(client: SupabaseClient) {
  return verifiedUserByClient.get(client)
    ? Promise.resolve(verifiedUserByClient.get(client)!)
    : client.auth.getUser();
}

const SUPABASE_URL  = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const SUPABASE_ANON = (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
const PROJECT_REF   = (SUPABASE_URL || "").match(/^https:\/\/([^.]+)\.supabase\.co/i)?.[1] ?? null;

export async function getSupabaseServerClient(opts: { writable?: boolean } = {}) {
  if (!SUPABASE_URL || !SUPABASE_ANON) throw new Error("Config Supabase serveur manquante.");
  const writable = !!opts.writable;
  const jar = await cookies(); // dans ta base de code, c'est typé async

  const safeSet = (name: string, value: string, options: CookieOptions) => {
    if (!writable) return; try { (jar as any).set({ name, value, ...options }); } catch {}
  };
  const safeRemove = (name: string, options: CookieOptions) => {
    if (!writable) return; try { (jar as any).set({ name, value: "", ...options, maxAge: 0 }); } catch {}
  };

  const client = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      get(name) { return jar.get(name)?.value; },
      set(name, value, options) { safeSet(name, value, options); },
      remove(name, options) { safeRemove(name, options); },
    },
  });

  let access  = jar.get("sb-access-token")?.value || null;
  let refresh = jar.get("sb-refresh-token")?.value || null;

  if ((!access || !refresh) && PROJECT_REF) {
    const raw = jar.get(`sb-${PROJECT_REF}-auth-token`)?.value;
    if (raw) { try {
      const parsed = JSON.parse(raw);
      access  = parsed?.currentSession?.access_token  || access;
      refresh = parsed?.currentSession?.refresh_token || refresh;
    } catch {} }
  }

  if (access && refresh) {
    try {
      const verified = await client.auth.setSession({ access_token: access, refresh_token: refresh });
      if (!verified.error && verified.data.user) {
        verifiedUserByClient.set(client, { data: { user: verified.data.user }, error: null });
      }
    } catch {}
  }

  return client;
}

export async function getSupabaseActionClient() {
  return getSupabaseServerClient({ writable: true });
}

