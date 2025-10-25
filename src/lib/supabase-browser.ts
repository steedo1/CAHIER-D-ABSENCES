// src/lib/supabase-browser.ts
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Cache HMR en dev
declare global {
  // eslint-disable-next-line no-var
  var __supabase__: SupabaseClient | undefined;
}

export function getSupabaseBrowserClient(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error("getSupabaseBrowserClient() ne peut être appelé que dans le navigateur.");
  }
  if (globalThis.__supabase__) return globalThis.__supabase__;

  // 1) Récupération + nettoyage
  const rawUrl  = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const rawAnon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

  if (!rawUrl || !rawAnon) {
    throw new Error("Config Supabase manquante côté client: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  // 2) Validation/normalisation URL
  let base: string;
  try {
    const u = new URL(rawUrl);
    if (!/^https?:$/.test(u.protocol)) throw new Error("URL doit commencer par http(s)://");
    base = u.origin; // normalise: garde juste https://xxxxx.supabase.co
  } catch {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL invalide: "${rawUrl}"`);
  }

  if (rawAnon.length < 20) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY semble invalide (trop courte).");
  }

  // 3) Création du client (pas d'override fetch)
  const client = createBrowserClient(base, rawAnon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  // 4) Cache en dev + petit debug visible en prod
  if (process.env.NODE_ENV !== "production") {
    globalThis.__supabase__ = client;
  }
  try {
    (window as any).__SUPA_DBG__ = { supabaseUrl: base, anonLen: rawAnon.length };
  } catch {}

  return client;
}
