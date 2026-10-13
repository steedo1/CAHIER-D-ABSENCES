// src/app/providers.tsx
"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { setAttendanceCacheActor } from "@/lib/attendance-cache-identity";
import { resetAttendanceCloudProbe } from "@/lib/attendance-network";
import {
  OFFLINE_AUTH_STATE_EVENT,
  getOfflineAccessIntent,
  getOfflineLogoutLock,
} from "@/lib/offline-auth-client";

const AuthContext = createContext<{ session: Session | null; loading: boolean }>({
  session: null,
  loading: true,
});

export function useAuth() {
  return useContext(AuthContext);
}

async function fetchAuthSync(init: RequestInit, controller: AbortController) {
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    return await fetch("/api/auth/sync", {
      ...init,
      cache: "no-store",
      credentials: "include",
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function syncSsrCookies(s: Session | null, controller: AbortController) {
  if (!s?.access_token || !s?.refresh_token) return;

  await fetchAuthSync({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      access_token: s.access_token,
      refresh_token: s.refresh_token,
    }),
  }, controller);
}

async function clearSsrCookies(controller: AbortController) {
  await fetchAuthSync({
    method: "DELETE",
  }, controller);
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    let revision = 0;
    let latestSession: Session | null = null;
    let cookieController: AbortController | null = null;
    const supabase = getSupabaseBrowserClient();
    // Ne pas laisser les lectures de cache démarrer leur propre refresh réseau.
    setAttendanceCacheActor(null);

    const publishLocal = async (expectedRevision: number, finishWithoutGrant = false) => {
      const intent = await getOfflineAccessIntent();
      if (!mounted || revision !== expectedRevision) return;
      const locked = Boolean(getOfflineLogoutLock());
      const s = !locked && intent && latestSession?.user.id === intent.payload.user_id
        ? latestSession : null;
      setAttendanceCacheActor(locked ? null : s?.user.id || intent?.payload.user_id || null);
      if (intent || locked || finishWithoutGrant) {
        setSession(s);
        setLoading(false);
      }
    };

    const publishCloud = async (s: Session | null, expectedRevision: number, signedOut = false) => {
      const intent = await getOfflineAccessIntent();
      if (!mounted || revision !== expectedRevision) return;
      // Un ancien refresh ne doit ni déverrouiller l'appareil ni remplacer le
      // compte qui vient de se réauthentifier localement.
      if (getOfflineLogoutLock() || (s && intent && s.user.id !== intent.payload.user_id)) {
        await publishLocal(expectedRevision, true);
        return;
      }
      window.clearTimeout(fallbackTimer);
      latestSession = s;
      setAttendanceCacheActor(s?.user.id || intent?.payload.user_id || null);
      setSession(s);
      setLoading(false);
      cookieController?.abort();
      if (navigator.onLine === false) return;
      cookieController = new AbortController();
      const sync = signedOut
        ? clearSsrCookies(cookieController)
        : syncSsrCookies(s, cookieController);
      void sync.catch(() => undefined);
    };

    // IndexedDB peut rendre l'appel utilisable avant un getSession() qui attend
    // le réseau. Sans preuve locale, l'attente reste bornée et l'écran de login
    // prend le relais ; elle ne donne aucun accès à un document protégé.
    void publishLocal(revision);
    const fallbackTimer = window.setTimeout(() => void publishLocal(revision, true), 2_000);
    const initialRevision = revision;
    void supabase.auth.getSession()
      .then(({ data }) => publishCloud(data?.session ?? null, initialRevision))
      .catch(() => publishLocal(initialRevision, true));

    const handleOfflineAuthState = () => {
      cookieController?.abort();
      revision++;
      void publishLocal(revision, true);
    };
    window.addEventListener(OFFLINE_AUTH_STATE_EVENT, handleOfflineAuthState);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") resetAttendanceCloudProbe();
      const expectedRevision = ++revision;
      // Sortir du verrou interne du SDK avant toute lecture/asynchronisme.
      window.setTimeout(() => {
        if (mounted) void publishCloud(s ?? null, expectedRevision, event === "SIGNED_OUT");
      }, 0);
    });

    return () => {
      mounted = false;
      window.clearTimeout(fallbackTimer);
      cookieController?.abort();
      window.removeEventListener(OFFLINE_AUTH_STATE_EVENT, handleOfflineAuthState);
      subscription?.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ session, loading }}>{children}</AuthContext.Provider>;
}
