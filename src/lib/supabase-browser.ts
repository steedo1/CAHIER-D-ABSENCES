// src/lib/supabase-browser.ts
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

declare global {
  // eslint-disable-next-line no-var
  var __supabase__: SupabaseClient | undefined;
}

export function getSupabaseBrowserClient(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error("getSupabaseBrowserClient() ne peut être appelé que dans le navigateur.");
  }
  if (globalThis.__supabase__) return globalThis.__supabase__;

  const rawUrl  = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const rawAnon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!rawUrl || !rawAnon) {
    throw new Error("Config Supabase manquante: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  let base: string;
  try { base = new URL(rawUrl).origin; }
  catch { throw new Error(`NEXT_PUBLIC_SUPABASE_URL invalide: "${rawUrl}"`); }

  const client = createBrowserClient(base, rawAnon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    // ⬇️ force l’envoi de l’API key sur tous les fetch émis par le SDK
    global: {
      headers: {
        apikey: rawAnon,
        Authorization: `Bearer ${rawAnon}`,
      },
    },
  });

  try { (window as any).__SUPA_DBG__ = { supabaseUrl: base, anonLen: rawAnon.length }; } catch {}

  if (process.env.NODE_ENV !== "production") {
    globalThis.__supabase__ = client;
  }
  return client;
}
