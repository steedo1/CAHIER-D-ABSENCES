"use client";
import React, { createContext, useEffect, useRef, useState, useContext } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabaseClient";

const AuthContext = createContext<{ session: Session | null; loading: boolean }>({
  session: null,
  loading: true,
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const supabase = getSupabaseBrowserClient();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const didInitialSyncRef = useRef(false);

  const syncSsrCookies = async (s: Session | null) => {
    if (!s?.access_token || !s?.refresh_token) return;
    try {
      await fetch("/api/auth/sync", {
        method: "POST",
        credentials: "include", // ðŸ‘ˆ important
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: s.access_token,
          refresh_token: s.refresh_token,
        }),
      });
    } catch (e) {
      console.warn("[providers] initial sync failed:", (e as any)?.message);
    }
  };

  useEffect(() => {
    let active = true;

    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!active) return;

      if (error) console.error("[providers] getSession error:", error);
      const s = data?.session ?? null;
      setSession(s);
      setLoading(false);
      console.log("[providers] init session:", !!s);

      if (s && !didInitialSyncRef.current) {
        didInitialSyncRef.current = true;
        await syncSsrCookies(s);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, s) => {
      console.log("[providers] onAuthStateChange:", event, !!s);
      setSession(s ?? null);

      try {
        if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && s?.access_token && s?.refresh_token) {
          await fetch("/api/auth/sync", {
            method: "POST",
            credentials: "include", // ðŸ‘ˆ important
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              access_token: s.access_token,
              refresh_token: s.refresh_token,
            }),
          });
        }
        if (event === "SIGNED_OUT") {
          await fetch("/api/auth/sync", { method: "DELETE", credentials: "include" });
        }
      } catch (e) {
        console.warn("[providers] sync cookies failed:", (e as any)?.message);
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
