"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CloudDownload, Database, RefreshCcw, ShieldCheck, WifiOff } from "lucide-react";
import {
  assessTeacherOfflineReadiness,
  getOfflineReadiness,
  resolveAuthoritativeClassDeviceSchedule,
  type ClassDeviceScheduleAssessment,
  type ClassDeviceAssessmentContext,
  type OfflineReadiness,
  type OfflineRole,
  type TeacherScheduleAssessment,
} from "@/lib/offline-readiness";
import { isClassDeviceReadyStatus } from "@/lib/offlineClassDevice";
import {
  shouldAutomaticallyPrepareOffline,
  shouldShowOfflinePreparationRetry,
} from "@/lib/offline-auto-preparation";
import {
  OFFLINE_PREPARATION_EVENT,
  runCoordinatedOfflinePreparation,
} from "@/lib/offline-preparation-coordinator";
import {
  getOfflineStorageProtection,
  offlineStorageProtectionMessage,
  type OfflineStorageProtection,
} from "@/lib/offline-storage-security";

type Props = {
  role: OfflineRole;
  className?: string;
  classDeviceContext?: ClassDeviceAssessmentContext;
  onPrepared?: (readiness: OfflineReadiness) => void | Promise<void>;
};

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

export default function OfflineReadinessCard({
  role,
  className = "",
  classDeviceContext,
  onPrepared,
}: Props) {
  const [readiness, setReadiness] = useState<OfflineReadiness | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [assessment, setAssessment] =
    useState<TeacherScheduleAssessment | ClassDeviceScheduleAssessment | null>(
      null,
    );
  const [storageProtection, setStorageProtection] =
    useState<OfflineStorageProtection | null>(null);
  const [refreshCycle, setRefreshCycle] = useState(0);
  const [initialRefreshDone, setInitialRefreshDone] = useState(false);
  const autoAttemptedCycleRef = useRef<number | null>(null);
  const preparingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const [stored, currentStorageProtection] = await Promise.all([
        getOfflineReadiness(role).catch(() => null),
        getOfflineStorageProtection().catch(() => null),
      ]);
      if (cancelled) return;
      setStorageProtection(
        currentStorageProtection || stored?.storage_protection || null,
      );
      setReadiness(stored);
      if (role === "teacher" || role === "class-device") {
        const next =
          role === "teacher"
            ? await assessTeacherOfflineReadiness(stored)
            : await resolveAuthoritativeClassDeviceSchedule(
                stored,
                classDeviceContext,
              );
        if (cancelled) return;
        setAssessment(next);
        setReadiness(next.readiness);
      }
      if (cancelled) return;
      setInitialRefreshDone(true);
      setRefreshCycle((current) => current + 1);
    };
    void refresh();
    const handleNetworkChange = () => void refresh();
    const handleFocus = () => void refresh();
    const handlePrepared = (event: Event) => {
      const preparedRole = (event as CustomEvent<{ role?: OfflineRole }>).detail
        ?.role;
      if (preparedRole === role) void refresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("online", handleNetworkChange);
    window.addEventListener("offline", handleNetworkChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener(OFFLINE_PREPARATION_EVENT, handlePrepared);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleNetworkChange);
      window.removeEventListener("offline", handleNetworkChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener(OFFLINE_PREPARATION_EVENT, handlePrepared);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    role,
    classDeviceContext?.institutionId,
    classDeviceContext?.classId,
    classDeviceContext?.actorProfileId,
    classDeviceContext?.relayBaseUrl,
    classDeviceContext?.relayAccessToken,
  ]);

  const stale = useMemo(() => {
    if (!readiness) return false;
    const preparedAt = new Date(readiness.prepared_at).getTime();
    const ageStale =
      !Number.isFinite(preparedAt) ||
      Date.now() - preparedAt > 24 * 60 * 60 * 1000;
    const scheduleStale =
      role === "teacher"
        ? assessment?.status !== "ready"
        : role === "class-device"
          ? !isClassDeviceReadyStatus(assessment?.status)
          : false;
    return ageStale || scheduleStale;
  }, [assessment?.status, readiness, role]);

  async function handlePrepare() {
    if (preparingRef.current) return;
    preparingRef.current = true;
    setPreparing(true);
    setError(null);
    setProgress("Démarrage de la préparation…");
    try {
      const coordinated = await runCoordinatedOfflinePreparation(role, {
        force: true,
        onProgress: setProgress,
      });
      const next = coordinated.readiness;
      if (!next) {
        throw new Error("La préparation hors ligne n’a pas pu être confirmée.");
      }
      setStorageProtection(next.storage_protection || null);
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
            : await resolveAuthoritativeClassDeviceSchedule(
                next,
                preparedClassDeviceContext,
              );
        setAssessment(checked);
        setReadiness(checked.readiness);
        const checkedReady =
          role === "class-device"
            ? isClassDeviceReadyStatus(checked.status)
            : checked.status === "ready";
        setProgress(
          checkedReady
            ? "Préparation et cohérence vérifiées."
            : "Données téléchargées, mais cohérence hors ligne non confirmée.",
        );
        if (!checkedReady) {
          throw new Error(checked.message);
        }
        await onPrepared?.(checked.readiness || next);
      } else {
        setReadiness(next);
        setProgress("Préparation terminée.");
        await onPrepared?.(next);
      }
    } catch (cause: any) {
      setError(String(cause?.message || "La préparation hors ligne a échoué."));
      setProgress("");
    } finally {
      preparingRef.current = false;
      setPreparing(false);
    }
  }

  useEffect(() => {
    if (!initialRefreshDone || refreshCycle <= 0) return;
    if (autoAttemptedCycleRef.current === refreshCycle) return;

    const shouldPrepare = shouldAutomaticallyPrepareOffline({
      has_readiness: Boolean(readiness),
      stale,
      preparing,
      storage_status:
        storageProtection?.status || readiness?.storage_protection?.status,
    });
    if (!shouldPrepare) return;

    autoAttemptedCycleRef.current = refreshCycle;
    void handlePrepare();
  }, [
    initialRefreshDone,
    preparing,
    readiness,
    refreshCycle,
    stale,
    storageProtection?.status,
  ]);

  const preparedSummary = readiness
    ? role === "admin"
      ? `${readiness.class_count} classe(s), ${readiness.slot_count} créneau(x), ${readiness.bulletin_count} bulletin(s) et communications préparés`
      : role === "parent"
        ? `${readiness.parent_child_count} enfant(s), ${readiness.bulletin_count} bulletin(s), notes, absences et cahier de texte`
        : `${readiness.class_count} classe(s), ${readiness.student_count} élève(s), ${readiness.slot_count} créneau(x), ${readiness.evaluation_count} évaluation(s), ${readiness.textbook_assignment_count} progression(s)`
    : "";

  const preparationDescription =
    role === "admin"
      ? "Prépare automatiquement la surveillance des appels par créneau, les réglages, les bulletins et les communications sur cet appareil."
      : role === "parent"
        ? "Télécharge les notes, absences, conduites, cahiers de texte, notifications et bulletins de tes enfants."
        : role === "class-device"
          ? "Télécharge le planning borné à la classe autorisée, les élèves, les notes et le shell vérifié de cet appareil."
          : "Télécharge l’emploi du temps, les listes d’élèves, les évaluations, les notes et le cahier de texte sur cet appareil.";

  const relayConnectivity =
    role === "teacher" || role === "class-device"
      ? readiness?.relay_connectivity
      : undefined;
  const relayCheckedAt = formatCheckedAt(relayConnectivity?.checked_at);
  const relayConnectivityMessage = assessment
    ? assessment.message
    : relayConnectivity?.status === "reachable"
    ? `Relais joignable lors de la dernière actualisation${relayCheckedAt ? ` (${relayCheckedAt})` : ""}, cohérence non encore vérifiée.`
    : relayConnectivity?.status === "access_denied"
      ? "Accès au relais refusé. Actualisez les données d’accès."
      : relayConnectivity?.status === "permission_denied"
      ? "Permission réseau local refusée."
      : relayConnectivity?.status === "incompatible_browser"
        ? "Navigateur incompatible avec l’accès au relais local."
        : relayConnectivity?.status === "unreachable"
          ? "Relais inaccessible depuis l’application."
          : null;
  const assessmentReady =
    role === "class-device"
      ? isClassDeviceReadyStatus(assessment?.status)
      : assessment?.status === "ready";
  const effectiveStorageProtection =
    storageProtection || readiness?.storage_protection || null;
  const storageProtectionText = offlineStorageProtectionMessage(
    effectiveStorageProtection,
  );
  const storageProtectionClasses =
    effectiveStorageProtection?.status === "persistent"
      ? "text-emerald-800"
      : effectiveStorageProtection?.status === "low_space"
        ? "text-rose-800"
        : "text-amber-800";
  const showManualRetry = shouldShowOfflinePreparationRetry({
    preparing,
    error,
    storage_status: effectiveStorageProtection?.status,
  });

  return (
    <section
      className={[
        "rounded-2xl border p-4 shadow-sm",
        readiness
          ? stale
            ? "border-amber-200 bg-amber-50/80"
            : "border-emerald-200 bg-emerald-50/80"
          : "border-slate-200 bg-white",
        className,
      ].join(" ")}
      aria-live="polite"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            {readiness ? (
              stale ? (
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              ) : (
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
              )
            ) : (
              <CloudDownload className="h-5 w-5 text-slate-600" />
            )}
            {preparing
              ? "Mise à jour hors ligne en cours"
              : readiness
                ? stale
                  ? role === "teacher" || role === "class-device"
                    ? "Mode hors ligne à actualiser"
                    : "Actualisation hors ligne nécessaire"
                  : "Mode hors ligne prêt"
                : error
                  ? "Configuration hors ligne à reprendre"
                  : "Configuration hors ligne automatique"}
          </div>

          {readiness ? (
            <p className="mt-1 text-sm text-slate-700">
              {preparedSummary} — mis à jour le{" "}
              {formatPreparedAt(readiness.prepared_at)}.
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-600">
              {preparationDescription} La configuration se lance automatiquement dès que la connexion nécessaire est disponible.
            </p>
          )}

          {preparing && progress && <p className="mt-2 text-xs font-medium text-sky-800">{progress}</p>}
          {error && <p className="mt-2 text-xs font-medium text-rose-700">{error}</p>}
          {relayConnectivityMessage && (
            <p
              className={[
                "mt-2 text-xs font-semibold",
                assessmentReady ? "text-emerald-800" : "text-amber-800",
              ].join(" ")}
            >
              {relayConnectivityMessage}
            </p>
          )}
          {assessment && !assessment.cloud_reachable && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-800">
              <WifiOff className="h-3.5 w-3.5" />
              {role === "class-device" && assessment.status === "ready_local"
                ? "Cloud et relais indisponibles : le planning sécurisé de ce téléphone reste utilisable."
                : "Cloud indisponible : la cohérence est décidée avec le relais local."}
            </p>
          )}
          {storageProtectionText && (
            <p
              className={[
                "mt-2 inline-flex items-start gap-1.5 text-xs font-medium",
                storageProtectionClasses,
              ].join(" ")}
            >
              <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{storageProtectionText}</span>
            </p>
          )}
        </div>

        {showManualRetry && (
          <button
            type="button"
            onClick={handlePrepare}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/25"
          >
            <RefreshCcw className="h-4 w-4" />
            Réessayer
          </button>
        )}
      </div>
    </section>
  );
}
