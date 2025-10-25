// src/lib/supabase-browser.ts
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

declare global { var __supabase__: SupabaseClient | undefined } // cache HMR

export function getSupabaseBrowserClient(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error("getSupabaseBrowserClient() ne peut être appelé que dans le navigateur.");
  }
  if (globalThis.__supabase__) return globalThis.__supabase__;

  const rawUrl  = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const rawAnon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!rawUrl || !rawAnon) throw new Error("Config Supabase manquante côté client.");

  let base: string;
  try {
    const u = new URL(rawUrl);
    if (!/^https?:$/.test(u.protocol)) throw new Error("URL doit commencer par http(s)://");
    base = u.origin; // ex: https://xxxxx.supabase.co
  } catch {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL invalide: "${rawUrl}"`);
  }
  if (rawAnon.length < 20) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY semble invalide.");

  const client = createBrowserClient(base, rawAnon, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  if (process.env.NODE_ENV !== "production") globalThis.__supabase__ = client;
  try { (window as any).__SUPA_DBG__ = { supabaseUrl: base, anonLen: rawAnon.length }; } catch {}

  return client;
}


