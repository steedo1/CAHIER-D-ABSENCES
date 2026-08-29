"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/app/providers";
import { getOfflineAccessIntent } from "@/lib/offline-auth-client";
import {
  readRelayCapability,
  rememberRelayCapability,
} from "@/lib/relay-capability";

type RelayCapabilityContextValue = {
  institutionId: string | null;
  relayEnabled: boolean;
  resolved: boolean;
  refresh: () => Promise<void>;
};

const RelayCapabilityContext = createContext<RelayCapabilityContextValue>({
  institutionId: null,
  relayEnabled: false,
  resolved: false,
  refresh: async () => undefined,
});

export function useRelayCapability() {
  return useContext(RelayCapabilityContext);
}

export default function RelayCapabilityProvider({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [relayEnabled, setRelayEnabled] = useState(false);
  const [resolved, setResolved] = useState(false);
  const sessionRef = useRef(session);
  const sessionUserIdRef = useRef<string | null>(null);
  const institutionIdRef = useRef<string | null>(null);
  const relayEnabledRef = useRef(false);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    institutionIdRef.current = institutionId;
    relayEnabledRef.current = relayEnabled;
  }, [institutionId, relayEnabled]);

  const applyExplicitCache = useCallback(async () => {
    const intent = await getOfflineAccessIntent().catch(() => null);
    const intentInstitutionId = String(intent?.payload.institution_id || "").trim();
    const nextInstitutionId = intentInstitutionId || institutionIdRef.current || "";
    const cached = readRelayCapability(nextInstitutionId);
    setInstitutionId(nextInstitutionId || null);
    setRelayEnabled(
      cached
        ? cached.relay_enabled === true
        : nextInstitutionId === institutionIdRef.current && relayEnabledRef.current,
    );
    setResolved(true);
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionRef.current) {
      await applyExplicitCache();
      return;
    }

    try {
      const response = await fetch("/api/auth/role", {
        cache: "no-store",
        credentials: "include",
      });
      if (!response.ok) throw new Error(`relay_capability_http_${response.status}`);
      const payload = await response.json().catch(() => ({}));
      const nextInstitutionId = String(payload?.institution_id || "").trim();
      const nextRelayEnabled = payload?.relay_enabled === true;
      if (nextInstitutionId) {
        rememberRelayCapability({
          institutionId: nextInstitutionId,
          relayEnabled: nextRelayEnabled,
        });
      }
      setInstitutionId(nextInstitutionId || null);
      setRelayEnabled(nextRelayEnabled);
      setResolved(true);
    } catch {
      // Un timeout Cloud ne change jamais la capacité. On ne conserve qu'une
      // décision explicite déjà confirmée pour le même établissement.
      await applyExplicitCache();
    }
  }, [applyExplicitCache]);

  useEffect(() => {
    if (loading) return;
    const nextSessionUserId = session?.user?.id || null;
    if (sessionUserIdRef.current !== nextSessionUserId) {
      sessionUserIdRef.current = nextSessionUserId;
      institutionIdRef.current = null;
      relayEnabledRef.current = false;
      setInstitutionId(null);
      setRelayEnabled(false);
      setResolved(false);
    }
    void refresh();
  }, [loading, refresh, session?.user?.id]);

  useEffect(() => {
    const onOnline = () => void refresh();
    const onFocus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ institutionId, relayEnabled, resolved, refresh }),
    [institutionId, relayEnabled, resolved, refresh],
  );

  return (
    <RelayCapabilityContext.Provider value={value}>
      {children}
    </RelayCapabilityContext.Provider>
  );
}
