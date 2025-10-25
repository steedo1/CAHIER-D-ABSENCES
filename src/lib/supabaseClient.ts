// src/lib/supabase-browser.ts
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Cache global pour éviter de recréer le client à chaque HMR en dev
declare global {
  // eslint-disable-next-line no-var
  var __supabase__: SupabaseClient | undefined;
}

function assertClientEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error(
      "Config Supabase manquante : NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error("URL doit commencer par http(s)://");
  } catch {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL invalide: "${url}"`);
  }

  if (anon.trim().length < 20) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY semble invalide (trop courte).");
  }

  return { url, anon };
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
    // (optionnel) forcer l’usage du fetch global du navigateur
    global: { fetch: (...args) => fetch(...args) },
  });

  if (process.env.NODE_ENV !== "production") {
    globalThis.__supabase__ = client;
  }

  return client;
}
