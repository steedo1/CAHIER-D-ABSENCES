// src/lib/supabase-browser.ts
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Nettoie une valeur d'env potentiellement collée avec retours ligne,
 * guillemets ou caractères invisibles (zéro-width).
 */
function clean(v?: string | null) {
  return (v ?? "")
    .replace(/[\r\n]+/g, "")                 // CR/LF
    .replace(/^\s+|\s+$/g, "")               // espaces
    .replace(/^["']+|["']+$/g, "")           // quotes en trop
    .replace(/[\u200B-\u200D\uFEFF]/g, "");  // zero-width chars
}

/**
 * Client Supabase côté navigateur (singleton).
 * - Pas de global.headers (apikey/Authorization gérés par le SDK).
 * - storageKey dédié pour éviter les collisions de sessions.
 */
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
  try {
    base = new URL(rawUrl).origin;
  } catch {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL invalide: "${rawUrl}"`);
  }

  _client = createBrowserClient(base, rawAnon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "mca-auth-v1",
    },
  });

  // Petit debug dev utile pour vérifier la clé (doit afficher jwtParts=3)
  if (process.env.NODE_ENV !== "production") {
    try {
      const jwtParts = rawAnon.split(".").length;
      (window as any).__SUPA_DBG__ = { supabaseUrl: base, anonLen: rawAnon.length, jwtParts };
      console.log("[supabase] url=%s anonLen=%d jwtParts=%d", base, rawAnon.length, jwtParts);
    } catch {}
  }

  return _client;
}
