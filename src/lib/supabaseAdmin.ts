// src/lib/supabaseAdmin.ts
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

let _admin: SupabaseClient | null = null;

function cleanServerEnv(value: string | undefined): string {
  return String(value || "")
    .trim()
    .replace(/\\r\\n|\\n|\\r/g, "");
}

/**
 * Client "service role" (cl� SERVICE_ROLE) pour l'admin.
 * �a� Serveur uniquement. Pas de session persist�e.
 */
export function getSupabaseServiceClient(): SupabaseClient {
  if (_admin) return _admin;

  const url = cleanServerEnv(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  ).replace(/\/+$/, "");
  const serviceKey = cleanServerEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!url) throw new Error("[supabaseAdmin] SUPABASE_URL manquant.");
  if (!serviceKey) throw new Error("[supabaseAdmin] SUPABASE_SERVICE_ROLE_KEY manquant.");

  _admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return _admin;
}


