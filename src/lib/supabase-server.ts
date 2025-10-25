// src/lib/supabase-server.ts
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PROJECT_REF   = (SUPABASE_URL ?? "").match(/^https:\/\/([^.]+)\.supabase\.co/i)?.[1] ?? null;

export async function getSupabaseServerClient(opts: { writable?: boolean } = {}) {
  const writable = !!opts.writable;
  const jar = await cookies(); // ✅ <- AJOUTER await

  const safeSet = (name: string, value: string, options: CookieOptions) => {
    if (!writable) return;
    try { (jar as any).set({ name, value, ...options }); } catch {}
  };
  const safeRemove = (name: string, options: CookieOptions) => {
    if (!writable) return;
    try { (jar as any).set({ name, value: "", ...options, maxAge: 0 }); } catch {}
  };

  const client = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      get(name: string) { return jar.get(name)?.value; },
      set(name: string, value: string, options: CookieOptions) { safeSet(name, value, options); },
      remove(name: string, options: CookieOptions) { safeRemove(name, options); },
    },
  });

  let access  = jar.get("sb-access-token")?.value || null;
  let refresh = jar.get("sb-refresh-token")?.value || null;

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

  if (access && refresh) {
    await client.auth.setSession({ access_token: access, refresh_token: refresh }).catch(() => {});
  }

  return client;
}

export async function getSupabaseActionClient() {
  return getSupabaseServerClient({ writable: true });
}
