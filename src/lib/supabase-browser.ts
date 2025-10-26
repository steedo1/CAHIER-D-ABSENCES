// src/lib/supabase-browser.ts
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

function clean(v?: string | null) {
  return (v ?? "").replace(/[\r\n]/g, "").trim();
}

export function getSupabaseBrowserClient(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error("getSupabaseBrowserClient() ne peut être appelé que dans le navigateur.");
  }
  if (_client) return _client;

  const rawUrl  = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const rawAnon = clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!rawUrl || !rawAnon) {
    throw new Error("Config Supabase manquante: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  let base: string;
  try { base = new URL(rawUrl).origin; }
  catch { throw new Error(`NEXT_PUBLIC_SUPABASE_URL invalide: "${rawUrl}"`); }

  // ⚠️ PAS de global.headers ici : le SDK gère apikey/Authorization.
  _client = createBrowserClient(base, rawAnon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "mca-auth-v1", // clé stable pour éviter les collisions
    },
  });

  // petit debug utile
  try { (window as any).__SUPA_DBG__ = { supabaseUrl: base, anonLen: rawAnon.length }; } catch {}
  return _client;
}
