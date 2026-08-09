"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/app/providers";
import { prepareOffline } from "@/lib/offline-readiness";
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

type PreparationStatus = "idle" | "preparing" | "ready" | "error" | "unavailable";
type RolePayload = { user_id?: string; role?: string; offline_access?: unknown };

let preparationInFlight: Promise<void> | null = null;

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
    await Promise.all([
      fetchAdminAttendanceMonitor(today, today, controller.signal),
      warmOfflineShell(["/admin/absences/appels-matrice"]),
    ]);
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
    "moncahier-attendance-background-preparation",
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
  const [status, setStatus] = useState<PreparationStatus>("idle");
  const [message, setMessage] = useState("");

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
      if (preparationInFlight) {
        rerunRequested = true;
        return;
      }
      preparationInFlight = (async () => {
        let role: OfflineAccessRole | null = null;
        let userId = sessionRef.current?.user?.id || "";
        try {
          if (sessionRef.current) {
            try {
              const payload = await fetchRole();
              role = isOfflineAccessRole(payload.role) ? payload.role : null;
              userId = String(payload.user_id || userId);
            } catch (error) {
              // Une session Supabase peut encore être présente localement alors que
              // le réseau est coupé. Dans ce cas seulement, l'intention déjà
              // provisionnée permet de préparer les mêmes données sans nouvel appel.
              const active = await getOfflineAccessIntent();
              if (!active || active.payload.user_id !== userId) throw error;
              role = active.payload.role;
              userId = active.payload.user_id;
            }
          } else {
            const active = await getOfflineAccessIntent();
            role = active?.payload.role || null;
            userId = active?.payload.user_id || "";
          }

          if (!role || !userId) {
            if (!disposed) {
              setStatus("unavailable");
              setMessage("Préparation d’appel non disponible pour cette session.");
            }
            return;
          }

          const scope = `${userId}:${role}`;
          const successKey = `mc:attendance-preparation:success:${scope}`;
          const attemptKey = `mc:attendance-preparation:attempt:${scope}`;
          const now = Date.now();
          const lastSuccess = numberFromStorage(successKey);
          const lastAttempt = numberFromStorage(attemptKey);
          if (!force && !shouldRunAttendancePreparation({
            now,
            lastSuccess,
            lastAttempt: 0,
            force: false,
          })) {
            if (!disposed) {
              setStatus("ready");
              setMessage("Données d’appel prêtes");
            }
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
            if (!disposed) {
              setStatus("preparing");
              setMessage("Actualisation des appels en arrière-plan");
            }
            if (role === "admin") {
              await prepareAdminAttendanceView();
            } else {
              await prepareOffline(role === "teacher" ? "teacher" : "class-device");
            }
            writeStorage(successKey, Date.now());
            if (!disposed) {
              setStatus("ready");
              setMessage("Actualisation des appels terminée");
            }
          });
        } catch {
          if (!disposed) {
            setStatus("error");
            setMessage("Actualisation impossible, ancienne préparation conservée");
          }
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

  if (status === "idle" || (status === "unavailable" && !session)) return null;
  const tone =
    status === "error"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : status === "preparing"
        ? "border-sky-200 bg-sky-50 text-sky-900"
        : status === "unavailable"
          ? "border-slate-200 bg-white text-slate-600"
          : "border-emerald-200 bg-emerald-50 text-emerald-900";

  return (
    <div
      aria-live="polite"
      className={`fixed bottom-3 left-3 z-[130] max-w-xs rounded-full border px-3 py-1.5 text-[11px] font-medium shadow-sm ${tone}`}
    >
      {message}
    </div>
  );
}
