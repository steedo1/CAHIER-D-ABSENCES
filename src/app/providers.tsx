// src/app/providers.tsx
"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const AuthContext = createContext<{ session: Session | null; loading: boolean }>({
  session: null,
  loading: true,
});

export function useAuth() {
  return useContext(AuthContext);
}

async function syncSsrCookies(s: Session | null) {
  if (!s?.access_token || !s?.refresh_token) return;

  await fetch("/api/auth/sync", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      access_token: s.access_token,
      refresh_token: s.refresh_token,
    }),
  });
}

async function clearSsrCookies() {
  await fetch("/api/auth/sync", {
    method: "DELETE",
    cache: "no-store",
    credentials: "include",
  });
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const supabase = getSupabaseBrowserClient();

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) console.error("[providers] getSession error:", error);

        const s = data?.session ?? null;
        if (s) {
          try {
            await syncSsrCookies(s);
          } catch (e: any) {
            console.warn("[providers] initial sync failed:", e?.message || e);
          }
        }

        if (mountedRef.current) {
          setSession(s);
          setLoading(false);
        }
      } catch (e: any) {
        console.error("[providers] init error:", e?.message || e);
        if (mountedRef.current) {
          setSession(null);
          setLoading(false);
        }
      }
    })();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, s) => {
      if (mountedRef.current) setSession(s ?? null);

      try {
        if (
          (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") &&
          s?.access_token &&
          s?.refresh_token
        ) {
          await syncSsrCookies(s);
        }

        if (event === "SIGNED_OUT") {
          await clearSsrCookies();
          if (mountedRef.current) setSession(null);
        }
      } catch (e: any) {
        console.warn("[providers] sync cookies failed:", e?.message || e);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    });

    return () => {
      mountedRef.current = false;
      subscription?.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>;
}
