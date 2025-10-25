// src/lib/supabase-browser.ts
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Cache HMR en dev
declare global {
  // eslint-disable-next-line no-var
  var __supabase__: SupabaseClient | undefined;
}

function assertClientEnv() {
  const url  = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

  if (!url || !anon) {
    throw new Error("Config Supabase manquante : NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error("URL doit commencer par http(s)://");
  } catch {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL invalide: "${url}"`);
  }
  if (anon.length < 20) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY semble invalide (trop courte).");
  }
  return { url, anon };
}

/** Patch fetch: toujours donner une string à window.fetch (évite “Invalid value” sur Edge) */
function safeFetch(input: any, init?: RequestInit) {
  try {
    // si input est un Request/url-objet d’une autre “realm”, prends .url ou cast en string
    const url =
      typeof input === "string"
        ? input
        : (input && typeof input.url === "string")
          ? input.url
          : String(input);
    return fetch(url, init as any);
  } catch {
    return fetch(String(input), init as any);
  }
}

export function getSupabaseBrowserClient(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error("getSupabaseBrowserClient() ne peut être appelé que dans le navigateur.");
  }
  if (globalThis.__supabase__) return globalThis.__supabase__;

  const { url, anon } = assertClientEnv();

  const client = createBrowserClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    // forcer l'usage de notre fetch patché
    global: { fetch: safeFetch as any },
  });

  if (process.env.NODE_ENV !== "production") {
    globalThis.__supabase__ = client;
  }

  // Petit debug
  try { (window as any).__SUPA_DBG__ = { supabaseUrl: url, anonLen: anon.length }; } catch {}

  return client;
}
