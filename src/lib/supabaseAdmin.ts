import { createReferenceFetch } from "./supabase-reference-fetch";
// src/lib/supabaseAdmin.ts
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

// Next can instantiate a module in several route bundles. Share only the
// stateless service-role client, never request-authenticated clients/sessions.
const serviceClientKey = Symbol.for("mon-cahier.supabase-service-client.v1");
const serviceScope = globalThis as typeof globalThis & { [serviceClientKey]?: SupabaseClient };

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
  if (serviceScope[serviceClientKey]) return serviceScope[serviceClientKey];

  const url = cleanServerEnv(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  ).replace(/\/+$/, "");
  const serviceKey = cleanServerEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!url) throw new Error("[supabaseAdmin] SUPABASE_URL manquant.");
  if (!serviceKey) throw new Error("[supabaseAdmin] SUPABASE_SERVICE_ROLE_KEY manquant.");

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createReferenceFetch() },
  });

  serviceScope[serviceClientKey] = client;
  return client;
}


