// src/lib/supabase-browser.ts
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
// import type { Database } from "@/types/supabase"; // <- si tu as des types générés

// Cache global pour éviter de recréer le client à chaque HMR en dev
declare global {
  // eslint-disable-next-line no-var
  var __supabase__: SupabaseClient | undefined; // SupabaseClient<Database> si typé
}

export function getSupabaseBrowserClient(): SupabaseClient {
  if (globalThis.__supabase__) return globalThis.__supabase__;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL ou NEXT_PUBLIC_SUPABASE_ANON_KEY manquantes (navigateur)"
    );
  }

  const client = createBrowserClient(
    url,
    anon,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    }
  );

  // En prod, le module est chargé une fois ; en dev on garde une seule instance
  if (process.env.NODE_ENV !== "production") {
    globalThis.__supabase__ = client;
  }

  return client;
}
