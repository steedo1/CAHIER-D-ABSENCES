import { cookies } from "next/headers";
import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SESSION_STORAGE_KEY, sessionCookies } from "./auth/session-cookies";

/** Validation is memoized by the request client, never across users/requests. */
export function getVerifiedServerUser(client: SupabaseClient) {
  return client.auth.getUser();
}

const createRequestClient = cache(async (writable: boolean) => {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) throw new Error("Config Supabase serveur manquante.");
  const jar = await cookies();
  const client = createServerClient(url, key, {
    auth: { storageKey: SESSION_STORAGE_KEY },
    cookies: {
      getAll: () => sessionCookies(jar.getAll(), url),
      setAll(values) {
        // Middleware persists refreshes before RSC rendering. Actions can
        // also change sessions and must persist their cookie changes.
        if (!writable) return;
        for (const { name, value, options } of values) jar.set(name, value, options);
      },
    },
  });
  const getUser = client.auth.getUser.bind(client.auth);
  let verified: ReturnType<typeof getUser> | undefined;
  client.auth.getUser = (jwt?: string) => {
    if (jwt) return getUser(jwt);
    return (verified ??= getUser());
  };
  client.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" || event === "USER_UPDATED" || event === "SIGNED_IN") verified = undefined;
  });
  return client;
});

export function getSupabaseServerClient(opts: { writable?: boolean } = {}) {
  return createRequestClient(Boolean(opts.writable));
}

export function getSupabaseActionClient() {
  return getSupabaseServerClient({ writable: true });
}
