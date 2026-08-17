"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/providers";
import { prepareOffline } from "@/lib/offline-readiness";
import { prepareAdminEssentialOffline } from "@/lib/admin-essential-preparation";
import { setAdminEssentialSessionUser } from "@/lib/admin-essential-fetch";
import { fetchAdminAttendanceMonitor } from "@/lib/local-relay";
import { warmOfflineShell } from "@/lib/offline";
import {
  getOfflineAccessIntent,
  getOrCreateOfflineDeviceId,
} from "@/lib/offline-auth-client";
import { isOfflineAccessRole, type OfflineAccessRole } from "@/lib/offline-auth-contract";
import {
  ATTENDANCE_PREPARATION_CHECK_INTERVAL_MS,
  shouldRunAttendancePreparation,
} from "@/lib/background-attendance-preparation-policy";

const ROLE_TIMEOUT_MS = 5_000;
const ADMIN_PREPARATION_TIMEOUT_MS = 12_000;

type RolePayload = {
  user_id?: string;
  role?: string;
  institution_id?: string | null;
  offline_access?: unknown;
};

let preparationInFlight: Promise<void> | null = null;

const ADMIN_ATTENDANCE_PATHS = new Set([
  "/admin/absences/appels",
  "/admin/absences/appels-matrice",
]);

function isAdminAttendancePath(pathname: string | null | undefined) {
  return !!pathname && ADMIN_ATTENDANCE_PATHS.has(pathname);
}

function localDateInAbidjan() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Abidjan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

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

async function prepareAdminAttendanceView() {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    ADMIN_PREPARATION_TIMEOUT_MS,
  );
  try {
    const today = localDateInAbidjan();
    await fetchAdminAttendanceMonitor(today, today, controller.signal);
    // La préparation du shell est utile pour le secours hors ligne, mais elle ne
    // doit jamais invalider une lecture Cloud déjà réussie.
    await warmOfflineShell(["/admin/absences/appels-matrice"]).catch(() => undefined);
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
  const pathname = usePathname();
  const sessionRef = useRef(session);
  const loadingRef = useRef(loading);
  const pathnameRef = useRef(pathname);

  // Tous les layout effects sont exécutés avant les useEffect des pages. Le pont
  // de lecture ne peut donc jamais reprendre le scope Cloud d'un ancien compte
  // pendant qu'une nouvelle page Admin démarre ses propres lectures.
  useLayoutEffect(() => {
    setAdminEssentialSessionUser(session?.user?.id || null);
  }, [session?.user?.id]);

  useEffect(() => {
    sessionRef.current = session;
    loadingRef.current = loading;
    pathnameRef.current = pathname;
  }, [loading, pathname, session]);

  const runRef = useRef<(force?: boolean) => void>(() => undefined);

  useEffect(() => {
    let disposed = false;
    let rerunRequested = false;

    const run = (force = false) => {
      if (disposed || loadingRef.current) return;
      if (preparationInFlight) {
        rerunRequested = true;
        return;
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

          if (!role || !userId) return;

          const scope = `${userId}:${role}`;
          // Le paquet Admin essentiel est plus riche que l'ancienne préparation
          // des appels : une nouvelle clé force donc sa première exécution sur les
          // appareils déjà utilisés avant ce LOT, sans attendre l'ancien TTL 6 h.
          const successKey =
            role === "admin"
              ? `mc:admin-essential-preparation:success:v1:${scope}`
              : `mc:attendance-preparation:success:${scope}`;
          const attemptKey =
            role === "admin"
              ? `mc:admin-essential-preparation:attempt:v1:${scope}`
              : `mc:attendance-preparation:attempt:${scope}`;
          const now = Date.now();
          const lastSuccess = numberFromStorage(successKey);
          const lastAttempt = numberFromStorage(attemptKey);
          if (!force && !shouldRunAttendancePreparation({
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
            force,
          })) return;
          writeStorage(attemptKey, now);

          await withCrossTabLock(async () => {
            let prepared = false;

            if (role === "admin") {
              // Appels garde sa lecture Cloud -> relais -> cache, y compris lorsque
              // le Cloud est déjà coupé.
              if (isAdminAttendancePath(pathnameRef.current)) {
                await prepareAdminAttendanceView();
                prepared = true;
              }

              // Le vrai hors-ligne Admin est préparé uniquement après confirmation
              // Cloud du compte ET de son établissement. L'utilisateur n'a pas à
              // ouvrir Listes, Bulletins ou Conseil avant la panne.
              if (
                cloudRoleVerified &&
                sessionRef.current &&
                institutionId
              ) {
                await prepareAdminEssentialOffline({ userId, institutionId });
                prepared = true;
              }
            } else {
              await prepareOffline(role === "teacher" ? "teacher" : "class-device");
              prepared = true;
            }

            // Une session Cloud résiduelle hors réseau sur une page Admin autre que
            // Appels est un no-op : elle ne doit pas repousser la prochaine vraie
            // préparation de six heures.
            if (prepared) writeStorage(successKey, Date.now());
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
    const onOnline = () => run(true);
    window.addEventListener("online", onOnline);
    const interval = window.setInterval(
      () => run(false),
      ATTENDANCE_PREPARATION_CHECK_INTERVAL_MS,
    );
    run(false);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useEffect(() => {
    if (!loading) runRef.current(false);
  }, [loading, session?.user?.id]);

  return null;
}
