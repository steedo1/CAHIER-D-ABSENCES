// src/app/providers.tsx
"use client";

import React, { createContext, useEffect, useState, useContext, useRef } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const AuthContext = createContext<{ session: Session | null; loading: boolean }>({
  session: null,
  loading: true,
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const didInitialSyncRef = useRef(false);

  // Sync SSR cookies (tolérant)
  async function syncSsrCookies(s: Session | null) {
    if (!s?.access_token || !s?.refresh_token) return;
    try {
      await fetch("/api/auth/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          access_token: s.access_token,
          refresh_token: s.refresh_token,
        }),
      });
    } catch (e: any) {
      console.warn("[providers] initial sync failed:", e?.message);
    }
  }

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) console.error("[providers] getSession error:", error);
      const s = data?.session ?? null;
      setSession(s);
      setLoading(false);
      if (s && !didInitialSyncRef.current) {
        didInitialSyncRef.current = true;
        await syncSsrCookies(s);
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, s) => {
      setSession(s ?? null);
      try {
        if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && s?.access_token && s?.refresh_token) {
          await fetch("/api/auth/sync", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              access_token: s.access_token,
              refresh_token: s.refresh_token,
            }),
          });
        }
        if (event === "SIGNED_OUT") {
          await fetch("/api/auth/sync", { method: "DELETE" });
        }
      } catch (e: any) {
        console.warn("[providers] sync cookies failed:", e?.message);
      }
    });

    return () => subscription?.unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>;
}
