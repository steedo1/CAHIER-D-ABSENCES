// src/lib/supabaseServer.ts
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PROJECT_REF   = SUPABASE_URL.match(/^https:\/\/([^.]+)\.supabase\.co/i)?.[1] ?? null;

/**
 * Client Supabase cÃ´tÃ© serveur.
 * - Par dÃ©faut: lecture seule (aucune Ã©criture de cookie) -> pour Server Components / pages.
 * - En contexte Route Handler / Server Action: utiliser getSupabaseActionClient() pour permettre l'Ã©criture.
 */
export async function getSupabaseServerClient(opts: { writable?: boolean } = {}) {
  const writable = !!opts.writable;           // â¬…ï¸ false par dÃ©faut
  const jar = await cookies();

  // Ã‰critures sÃ»res (no-op hors contextes autorisÃ©s)
  const safeSet = (name: string, value: string, options: CookieOptions) => {
    if (!writable) return;
    try { (jar as any).set({ name, value, ...options }); } catch { /* ignore en RSC */ }
  };
  const safeRemove = (name: string, options: CookieOptions) => {
    if (!writable) return;
    try { (jar as any).set({ name, value: "", ...options, maxAge: 0 }); } catch { /* ignore */ }
  };

  const client = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      get(name: string) {
        return jar.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        safeSet(name, value, options);
      },
      remove(name: string, options: CookieOptions) {
        safeRemove(name, options);
      },
    },
  });

  // 1) Cookies "plats" posÃ©s par /api/auth/sync
  let access  = jar.get("sb-access-token")?.value || null;
  let refresh = jar.get("sb-refresh-token")?.value || null;

  // 2) Fall-back: cookie JSON du SDK (sb-<project>-auth-token)
  if ((!access || !refresh) && PROJECT_REF) {
    const raw = jar.get(`sb-${PROJECT_REF}-auth-token`)?.value;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        access  = parsed?.currentSession?.access_token  || access;
        refresh = parsed?.currentSession?.refresh_token || refresh;
      } catch {}
    }
  }

  // 3) Hydrate la session (Ã©vite les 401 en SSR)
  if (access && refresh) {
    try { await client.auth.setSession({ access_token: access, refresh_token: refresh }); } catch {}
  }

  return client;
}

/** Alias Ã  utiliser UNIQUEMENT en Route Handler / Server Action (Ã©critures autorisÃ©es) */
export async function getSupabaseActionClient() {
  return getSupabaseServerClient({ writable: true });
}
