"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CloudDownload,
  RefreshCcw,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import {
  assessClassDeviceOfflineReadiness,
  assessTeacherOfflineReadiness,
  getOfflineReadiness,
  prepareOffline,
  type ClassDeviceScheduleAssessment,
  type ClassDeviceAssessmentContext,
  type OfflineReadiness,
  type OfflineRole,
  type TeacherScheduleAssessment,
} from "@/lib/offline-readiness";
import {
  isClassDeviceOperationalReadiness,
  type ClassDeviceReadinessStatus,
} from "@/lib/offlineClassDevice";
import { cacheGet } from "@/lib/offline";
import { useRelayCapability } from "@/components/RelayCapabilityProvider";

type Props = {
  role: OfflineRole;
  className?: string;
  classDeviceContext?: ClassDeviceAssessmentContext;
  onPrepared?: (readiness: OfflineReadiness) => void | Promise<void>;
};

const AUTOMATIC_ATTENDANCE_RETRY_STATUSES = new Set([
  "relay_stale",
  "sources_diverged",
  "phone_stale",
]);

const AUTOMATIC_PREPARE_STATUSES = new Set([
  "not_prepared",
  "schedule_not_prepared",
  "relay_stale",
  "sources_diverged",
  "phone_stale",
  "offline_schema_stale",
]);

const AUTOMATIC_REFRESH_MS = 5_000;
const AUTOMATIC_PREPARE_COOLDOWN_MS = 10_000;
const MAX_AUTOMATIC_PREPARATION_AGE_MS = 24 * 60 * 60 * 1000;
const CLASS_DEVICE_APPLIED_REVISION_KEY =
  "moncahier:class-device:applied-schedule-revision";

function automaticAttendanceRole(role: OfflineRole) {
  return role === "teacher" || role === "class-device";
}

function formatPreparedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "date inconnue";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatCheckedAt(value: string | undefined) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function readinessTooOld(readiness: OfflineReadiness | null) {
  if (!readiness?.prepared_at) return true;
  const preparedAt = new Date(readiness.prepared_at).getTime();
  return (
    !Number.isFinite(preparedAt) ||
    Date.now() - preparedAt > MAX_AUTOMATIC_PREPARATION_AGE_MS
  );
}

function shouldPrepareAutomatically(
  assessment: TeacherScheduleAssessment | ClassDeviceScheduleAssessment,
  readiness: OfflineReadiness | null,
) {
  if (!assessment.cloud_reachable) return false;
  const status = String(assessment.status || "");
  if (AUTOMATIC_PREPARE_STATUSES.has(status)) return true;

  const phoneRevision = Number(assessment.phone_revision);
  const cloudRevision = Number(assessment.cloud_revision);
  if (
    Number.isSafeInteger(phoneRevision) &&
    Number.isSafeInteger(cloudRevision) &&
    phoneRevision !== cloudRevision
  ) {
    return true;
  }

  return readinessTooOld(readiness);
}

function automaticAttendanceMessage(
  assessment: TeacherScheduleAssessment | ClassDeviceScheduleAssessment | null,
  role: OfflineRole,
  relayEnabled: boolean,
  preparing: boolean,
) {
  if (preparing) return "Mise à jour des données d’appel…";
  if (!assessment) return "Préparation des données d’appel…";

  const status = String(assessment.status || "");
  if (status === "ready" || status === "ready_local") return null;

  if (status === "not_prepared" || status === "schedule_not_prepared") {
    return "Préparation automatique des données d’appel…";
  }
  if (AUTOMATIC_ATTENDANCE_RETRY_STATUSES.has(status)) {
    return "Actualisation du planning d’appel…";
  }
  if (status === "offline_schema_stale") {
    return "Mise à jour du mode hors connexion…";
  }

  if (!relayEnabled) {
    return assessment.cloud_reachable
      ? assessment.message
      : "Connexion indisponible. Les dernières données validées restent utilisées.";
  }

  if (status === "relay_unreachable") return "Relais local momentanément inaccessible.";
  if (status === "relay_access_denied") return "Accès au relais local refusé.";
  if (status === "relay_permission_denied") return "Accès au réseau local non autorisé.";
  if (status === "browser_incompatible") return "Accès local indisponible sur ce navigateur.";
  if (status === "relay_incompatible") return "Le relais local doit être mis à jour.";

  return role === "class-device"
    ? "Actualisation des données de cette classe…"
    : assessment.message;
}

export default function OfflineReadinessCard({
  role,
  className = "",
  classDeviceContext,
  onPrepared,
}: Props) {
  const { relayEnabled } = useRelayCapability();
  const [readiness, setReadiness] = useState<OfflineReadiness | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [assessment, setAssessment] =
    useState<TeacherScheduleAssessment | ClassDeviceScheduleAssessment | null>(
      null,
    );

  const onPreparedRef = useRef(onPrepared);
  const refreshingRef = useRef(false);
  const preparationRef = useRef<Promise<void> | null>(null);
  const lastAutomaticPrepareAtRef = useRef(0);
  const mountedRef = useRef(true);
  const isAutomaticAttendance = automaticAttendanceRole(role);

  useEffect(() => {
    onPreparedRef.current = onPrepared;
  }, [onPrepared]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const classDeviceStatus: ClassDeviceReadinessStatus | undefined =
    role === "class-device"
      ? (assessment as ClassDeviceScheduleAssessment | null)?.status ||
        readiness?.class_device_compatibility
      : undefined;

  const assess = useCallback(
    async (stored: OfflineReadiness | null) =>
      role === "teacher"
        ? await assessTeacherOfflineReadiness(stored)
        : await assessClassDeviceOfflineReadiness(stored, classDeviceContext),
    [
      role,
      classDeviceContext?.institutionId,
      classDeviceContext?.classId,
      classDeviceContext?.actorProfileId,
      classDeviceContext?.relayBaseUrl,
      classDeviceContext?.relayAccessToken,
    ],
  );

  const applyAssessment = useCallback(
    async (
      next: TeacherScheduleAssessment | ClassDeviceScheduleAssessment,
      notify = false,
    ) => {
      if (!mountedRef.current) return;
      setAssessment(next);
      setReadiness(next.readiness);
      if (notify && next.readiness) {
        await onPreparedRef.current?.(next.readiness);
      }
    },
    [],
  );

  const runPreparation = useCallback(
    async (automatic: boolean) => {
      if (preparationRef.current) {
        await preparationRef.current;
        return;
      }

      if (automatic) {
        const now = Date.now();
        if (
          now - lastAutomaticPrepareAtRef.current <
          AUTOMATIC_PREPARE_COOLDOWN_MS
        ) {
          return;
        }
        lastAutomaticPrepareAtRef.current = now;
      }

      const previousReadiness = await getOfflineReadiness(role).catch(
        () => null,
      );
      const previousRevision = previousReadiness?.schedule_revision ?? null;
      const previousWasTooOld = readinessTooOld(previousReadiness);

      const task = (async () => {
        if (mountedRef.current) {
          setPreparing(true);
          setError(null);
          setProgress(
            automatic
              ? "Actualisation automatique des données d’appel…"
              : "Démarrage de la préparation…",
          );
        }

        try {
          const next = await prepareOffline(role, (message) => {
            if (mountedRef.current) setProgress(message);
          });

          if (role === "teacher" || role === "class-device") {
            const preparedClassDeviceContext =
              role === "class-device"
                ? {
                    institutionId: next.institution_id || undefined,
                    classId: next.authorized_class_id || undefined,
                    actorProfileId:
                      next.authorized_actor_profile_id || undefined,
                  }
                : undefined;

            const checked =
              role === "teacher"
                ? await assessTeacherOfflineReadiness(next)
                : await assessClassDeviceOfflineReadiness(
                    next,
                    preparedClassDeviceContext,
                  );

            await applyAssessment(checked, true);

            const operational =
              role === "teacher"
                ? checked.status === "ready"
                : isClassDeviceOperationalReadiness(
                    (checked as ClassDeviceScheduleAssessment).status,
                  );

            if (!operational) {
              throw new Error(checked.message);
            }

            if (mountedRef.current) {
              setProgress("Données d’appel actualisées et vérifiées.");
            }

            if (role === "class-device" && typeof window !== "undefined") {
              const nextRevision = next.schedule_revision ?? null;
              const scheduleChanged = previousRevision !== nextRevision;
              const shouldApplyFreshBundle =
                scheduleChanged || previousWasTooOld || !previousReadiness;
              if (shouldApplyFreshBundle) {
                const localOpen = await cacheGet<any>(
                  "classDevice:local-open",
                ).catch(() => null);
                if (!localOpen) {
                  const token = `${String(nextRevision ?? "none")}|${String(
                    next.service_worker_release || "",
                  )}`;
                  const alreadyApplied = window.sessionStorage.getItem(
                    CLASS_DEVICE_APPLIED_REVISION_KEY,
                  );
                  if (alreadyApplied !== token) {
                    window.sessionStorage.setItem(
                      CLASS_DEVICE_APPLIED_REVISION_KEY,
                      token,
                    );
                    window.setTimeout(() => window.location.reload(), 150);
                  }
                }
              }
            }
          } else {
            if (mountedRef.current) {
              setReadiness(next);
              setProgress("Préparation terminée.");
            }
            await onPreparedRef.current?.(next);
          }
        } catch (cause: any) {
          if (mountedRef.current) {
            setError(
              String(
                cause?.message || "La préparation hors ligne a échoué.",
              ),
            );
            setProgress("");
          }
        } finally {
          if (mountedRef.current) setPreparing(false);
        }
      })();

      preparationRef.current = task;
      try {
        await task;
      } finally {
        if (preparationRef.current === task) preparationRef.current = null;
      }
    },
    [applyAssessment, role],
  );

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const stored = await getOfflineReadiness(role).catch(() => null);
      if (!mountedRef.current) return;
      setReadiness(stored);

      if (role !== "teacher" && role !== "class-device") return;

      let next = await assess(stored);
      if (!mountedRef.current) return;
      await applyAssessment(next, false);

      if (shouldPrepareAutomatically(next, stored)) {
        await runPreparation(true);
        return;
      }

      if (
        next.cloud_reachable &&
        AUTOMATIC_ATTENDANCE_RETRY_STATUSES.has(String(next.status || ""))
      ) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        if (!mountedRef.current) return;
        next = await assess(next.readiness || stored);
        if (!mountedRef.current) return;
        await applyAssessment(next, false);
      }
    } finally {
      refreshingRef.current = false;
    }
  }, [applyAssessment, assess, role, runPreparation]);

  useEffect(() => {
    void refresh();

    const handleNetworkChange = () => void refresh();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };

    window.addEventListener("online", handleNetworkChange);
    window.addEventListener("offline", handleNetworkChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const interval = isAutomaticAttendance
      ? window.setInterval(() => void refresh(), AUTOMATIC_REFRESH_MS)
      : null;

    return () => {
      window.removeEventListener("online", handleNetworkChange);
      window.removeEventListener("offline", handleNetworkChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [isAutomaticAttendance, refresh]);

  const stale = useMemo(() => {
    if (!readiness) return false;
    const ageStale = readinessTooOld(readiness);
    const scheduleStale =
      role === "teacher"
        ? assessment?.status !== "ready"
        : role === "class-device"
          ? classDeviceStatus === "ready_local" ||
            !isClassDeviceOperationalReadiness(classDeviceStatus)
          : false;
    return ageStale || scheduleStale;
  }, [assessment?.status, classDeviceStatus, readiness, role]);

  const automaticOperational =
    role === "teacher"
      ? assessment?.status === "ready"
      : role === "class-device"
        ? isClassDeviceOperationalReadiness(classDeviceStatus)
        : false;

  const relayConnectivity =
    role === "teacher" || role === "class-device"
      ? readiness?.relay_connectivity
      : undefined;
  const relayCheckedAt = formatCheckedAt(relayConnectivity?.checked_at);
  const relayConnectivityMessage = isAutomaticAttendance
    ? automaticAttendanceMessage(
        assessment,
        role,
        relayEnabled,
        preparing,
      )
    : assessment
      ? assessment.message
      : relayConnectivity?.status === "reachable"
        ? `Relais joignable lors de la dernière actualisation${
            relayCheckedAt ? ` (${relayCheckedAt})` : ""
          }, cohérence non encore vérifiée.`
        : relayConnectivity?.status === "access_denied"
          ? "Accès au relais refusé. Actualisez les données d’accès."
          : relayConnectivity?.status === "permission_denied"
            ? "Permission réseau local refusée."
            : relayConnectivity?.status === "incompatible_browser"
              ? "Navigateur incompatible avec l’accès au relais local."
              : relayConnectivity?.status === "unreachable"
                ? "Relais inaccessible depuis l’application."
                : null;

  if (isAutomaticAttendance) {
    const compactMessage = error || (preparing ? progress : relayConnectivityMessage);
    if (automaticOperational && !preparing && !error) return null;

    return (
      <section
        className={[
          "rounded-xl border px-3 py-2 shadow-sm",
          error
            ? "border-rose-200 bg-rose-50 text-rose-900"
            : "border-amber-200 bg-amber-50 text-amber-900",
          className,
        ].join(" ")}
        aria-live="polite"
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          {error ? (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          ) : (
            <RefreshCcw className={preparing ? "h-4 w-4 shrink-0 animate-spin" : "h-4 w-4 shrink-0"} />
          )}
          <span>{compactMessage || "Préparation des données d’appel…"}</span>
        </div>
      </section>
    );
  }

  const preparedSummary = readiness
    ? role === "admin"
      ? `${readiness.class_count} classe(s), ${readiness.student_count} élève(s), ${readiness.bulletin_count} bulletin(s) et historique des communications`
      : role === "parent"
        ? `${readiness.parent_child_count} enfant(s), ${readiness.bulletin_count} bulletin(s), notes, absences et cahier de texte`
        : `${readiness.class_count} classe(s), ${readiness.student_count} élève(s) et ${readiness.slot_count} créneau(x) d’appel`
    : "";

  const preparationDescription =
    role === "admin"
      ? "Télécharge les bulletins officiels, leurs images et l’historique des communications sur cet appareil."
      : role === "parent"
        ? "Télécharge les notes, absences, conduites, cahiers de texte, notifications et bulletins de tes enfants."
        : "Mon Cahier synchronise automatiquement l’emploi du temps, les classes et les listes d’élèves nécessaires à l’appel.";

  const visualReady = Boolean(readiness && !stale);

  return (
    <section
      className={[
        "rounded-2xl border p-4 shadow-sm",
        readiness
          ? visualReady
            ? "border-emerald-200 bg-emerald-50/80"
            : "border-amber-200 bg-amber-50/80"
          : "border-slate-200 bg-white",
        className,
      ].join(" ")}
      aria-live="polite"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            {readiness ? (
              visualReady ? (
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              )
            ) : (
              <CloudDownload className="h-5 w-5 text-slate-600" />
            )}
            {readiness
              ? stale
                ? "Mode hors ligne prêt — actualisation conseillée"
                : "Mode hors ligne prêt"
              : "Préparer le mode hors ligne"}
          </div>

          {readiness ? (
            <p className="mt-1 text-sm text-slate-700">
              {preparedSummary} — mis à jour le {formatPreparedAt(readiness.prepared_at)}.
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-600">
              {preparationDescription}
            </p>
          )}

          {preparing && progress && (
            <p className="mt-2 text-xs font-medium text-sky-800">{progress}</p>
          )}
          {error && <p className="mt-2 text-xs font-medium text-rose-700">{error}</p>}
          {relayConnectivityMessage && (
            <p className="mt-2 text-xs font-semibold text-amber-800">
              {relayConnectivityMessage}
            </p>
          )}
          {assessment && !assessment.cloud_reachable && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-800">
              <WifiOff className="h-3.5 w-3.5" />
              Cloud indisponible : la cohérence est décidée avec le relais local.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => void runPreparation(false)}
          disabled={preparing}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {preparing ? (
            <RefreshCcw className="h-4 w-4 animate-spin" />
          ) : readiness ? (
            <RefreshCcw className="h-4 w-4" />
          ) : (
            <CloudDownload className="h-4 w-4" />
          )}
          {preparing ? "Préparation…" : readiness ? "Actualiser" : "Préparer"}
        </button>
      </div>
    </section>
  );
}
