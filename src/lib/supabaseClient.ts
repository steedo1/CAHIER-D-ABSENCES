"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Client Supabase pour le navigateur â€“ aucun JSX ici. */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (client) return client;

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  client = createBrowserClient(url, anon);

  return client;
}
