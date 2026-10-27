"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useAuth } from "@/app/providers";
import {
  getOfflineReadiness,
  prepareOffline,
} from "@/lib/offline-readiness";
import { probeCloudSchedule } from "@/lib/cloud-availability";
import { setAdminEssentialSessionUser } from "@/lib/admin-essential-fetch";
import {
  getOfflineAccessIntent,
  getOrCreateOfflineDeviceId,
} from "@/lib/offline-auth-client";
import { isOfflineAccessRole, type OfflineAccessRole } from "@/lib/offline-auth-contract";
import {
  ATTENDANCE_PREPARATION_CHECK_INTERVAL_MS,
  shouldRunAttendancePreparation,
} from "@/lib/background-attendance-preparation-policy";
import { rememberRelayCapability } from "@/lib/relay-capability";

const ROLE_TIMEOUT_MS = 5_000;
const BACKGROUND_CHECK_TTL_MS = 55_000;

type RolePayload = {
  user_id?: string;
  role?: string;
  institution_id?: string | null;
  relay_enabled?: boolean;
  offline_access?: unknown;
};

let preparationInFlight: Promise<void> | null = null;

async function fetchRole() {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), ROLE_TIMEOUT_MS);
  try {
    const response = await fetch("/api/auth/role", {
      credentials: "include",
      cache: "no-store",
      headers: { "X-Mon-Cahier-Device-Id": getOrCreateOfflineDeviceId() },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`role_http_${response.status}`);
    return (await response.json()) as RolePayload;
  } finally {
    window.clearTimeout(timeout);
  }
}

function numberFromStorage(key: string) {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeStorage(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // La préparation reste fonctionnelle dans l'onglet courant sans throttle persistant.
  }
}

function safeScheduleRevision(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

async function attendanceScheduleRevisionChanged(role: OfflineAccessRole) {
  if (role !== "teacher" && role !== "class_device") return false;

  const offlineRole = role === "teacher" ? "teacher" : "class-device";
  const [localReadiness, cloudSchedule] = await Promise.all([
    getOfflineReadiness(offlineRole).catch(() => null),
    probeCloudSchedule().catch(() => null),
  ]);
  const localRevision = safeScheduleRevision(localReadiness?.schedule_revision);
  const cloudRevision = safeScheduleRevision(cloudSchedule?.schedule_revision);

  // Une révision Cloud différente signifie qu'un EDT, un créneau ou une
  // affectation prof/classe a changé. Le paquet d'appel doit alors être
  // reconstruit immédiatement au lieu d'attendre le TTL historique de 6 h.
  return cloudRevision !== null && cloudRevision !== localRevision;
}

async function withCrossTabLock(task: () => Promise<void>) {
  const locks = (
    navigator as Navigator & {
      locks?: {
        request<T>(
          name: string,
          options: { mode: "exclusive"; ifAvailable: true },
          callback: (lock: unknown | null) => Promise<T | undefined>,
        ): Promise<T | undefined>;
      };
    }
  ).locks;
  if (!locks) {
    await task();
    return;
  }
  await locks.request(
    "moncahier-offline-background-preparation",
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (!lock) return undefined;
      await task();
      return undefined;
    },
  );
}

export default function BackgroundAttendancePreparation() {
  const { session, loading } = useAuth();
  const sessionRef = useRef(session);
  const loadingRef = useRef(loading);

  // Tous les layout effects sont exécutés avant les useEffect des pages. Le pont
  // de lecture ne peut donc jamais reprendre le scope Cloud d'un ancien compte
  // pendant qu'une nouvelle page Admin démarre ses propres lectures.
  useLayoutEffect(() => {
    setAdminEssentialSessionUser(session?.user?.id || null);
  }, [session?.user?.id]);

  useEffect(() => {
    sessionRef.current = session;
    loadingRef.current = loading;
  }, [loading, session]);

  const runRef = useRef<(force?: boolean) => void>(() => undefined);

  useEffect(() => {
    let disposed = false;
    let rerunRequested = false;

    const run = (force = false) => {
      if (disposed || loadingRef.current) return;
      // Une préparation préventive peut attendre que l'utilisateur revienne.
      // Ne pas consommer le throttle pendant cette pause : visibilitychange
      // doit pouvoir vérifier immédiatement la révision au retour à l'écran.
      // L'envoi des appels déjà saisis est indépendant et reste actif en fond
      // dans BackgroundAttendanceDeliverySync et le service worker.
      if (document.visibilityState === "hidden") return;
      if (preparationInFlight) {
        rerunRequested = true;
        return;
      }

      // IndexedDB et localStorage sont partagés entre les onglets. Une seule
      // vérification par appareil et par minute suffit donc, même si plusieurs
      // pages reçoivent simultanément focus/online/visibilitychange.
      const sessionUserId = sessionRef.current?.user?.id || "";
      if (!force && sessionUserId) {
        const checkKey = `mc:attendance-background-check:${sessionUserId}`;
        const now = Date.now();
        if (now - numberFromStorage(checkKey) < BACKGROUND_CHECK_TTL_MS) return;
        writeStorage(checkKey, now);
      }

      preparationInFlight = (async () => {
        let role: OfflineAccessRole | null = null;
        let userId = sessionRef.current?.user?.id || "";
        let institutionId = "";
        let cloudRoleVerified = false;
        try {
          if (sessionRef.current) {
            try {
              const payload = await fetchRole();
              role = isOfflineAccessRole(payload.role) ? payload.role : null;
              userId = String(payload.user_id || userId).trim();
              institutionId = String(payload.institution_id || "").trim();
              if (institutionId) {
                rememberRelayCapability({
                  institutionId,
                  relayEnabled: payload.relay_enabled === true,
                });
              }
              cloudRoleVerified = Boolean(role && userId && institutionId);
            } catch (error) {
              // Une session Supabase peut encore être présente localement alors que
              // le réseau est coupé. Le grant local permet de continuer à utiliser
              // le dernier paquet valide, mais jamais de le remplacer.
              const active = await getOfflineAccessIntent();
              if (!active || active.payload.user_id !== userId) throw error;
              role = active.payload.role;
              userId = active.payload.user_id;
              institutionId = active.payload.institution_id;
            }
          } else {
            const active = await getOfflineAccessIntent();
            role = active?.payload.role || null;
            userId = active?.payload.user_id || "";
            institutionId = active?.payload.institution_id || "";
          }

          // Administration cloud-only : ne pas télécharger en arrière-plan
          // toutes les listes, bulletins et conduites de l'établissement.
          // Les caches/outbox existants restent intacts.
          if (!role || !userId || role === "admin") return;

          const revisionChanged =
            cloudRoleVerified &&
            (role === "teacher" || role === "class_device")
              ? await attendanceScheduleRevisionChanged(role)
              : false;
          const forcePreparation = force || revisionChanged;

          const scope = `${userId}:${role}`;
          const successKey = `mc:attendance-preparation:success:${scope}`;
          const attemptKey = `mc:attendance-preparation:attempt:${scope}`;
          const now = Date.now();
          const lastSuccess = numberFromStorage(successKey);
          const lastAttempt = numberFromStorage(attemptKey);
          if (!forcePreparation && !shouldRunAttendancePreparation({
            now,
            lastSuccess,
            lastAttempt: 0,
            force: false,
          })) {
            return;
          }
          if (!shouldRunAttendancePreparation({
            now,
            lastSuccess,
            lastAttempt,
            force: forcePreparation,
          })) return;
          writeStorage(attemptKey, now);

          await withCrossTabLock(async () => {
            await prepareOffline(role === "teacher" ? "teacher" : "class-device");
            // Marquer uniquement une préparation terminée sans erreur.
            writeStorage(successKey, Date.now());
          });
        } catch {
          // Préparation opportuniste et silencieuse : une indisponibilité du Cloud,
          // du relais ou du cache ne doit jamais devenir un état global de l'app.
        }
      })().finally(() => {
        preparationInFlight = null;
        if (rerunRequested && !disposed) {
          rerunRequested = false;
          queueMicrotask(() => run(false));
        }
      });
    };

    runRef.current = run;
    // Le retour d'Internet ne force jamais une reconstruction. Il relance seulement
    // la vérification légère ; une vraie préparation ne repart que si la révision
    // Cloud diffère du paquet local ou si le TTL normal l'exige.
    const onOnline = () => run(false);
    const onFocus = () => run(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") run(false);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(
      () => run(false),
      ATTENDANCE_PREPARATION_CHECK_INTERVAL_MS,
    );
    run(false);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!loading) runRef.current(false);
  }, [loading, session?.user?.id]);

  return null;
}
