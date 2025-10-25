// src/lib/supabase-browser.ts
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Singleton (partagé par tous les composants du même onglet)
let _browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error("getSupabaseBrowserClient() doit être appelé dans le navigateur.");
  }
  if (_browserClient) return _browserClient;

  const url  = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !anon) {
    throw new Error("Config Supabase manquante: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  // ⚠️ Pas de global.headers personnalisés : Supabase gère apikey/Authorization.
  _browserClient = createBrowserClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Clé de stockage dédiée pour éviter toute collision
      storageKey: "mca-auth-v1",
    },
  });

  try { (window as any).__SUPA_DBG__ = { supabaseUrl: url, anonLen: anon.length }; } catch {}

  return _browserClient;
}
