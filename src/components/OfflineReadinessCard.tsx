"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CloudDownload,
  Database,
  RefreshCcw,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import {
  getOfflineReadiness,
  type ClassDeviceAssessmentContext,
  type OfflineReadiness,
  type OfflineRole,
} from "@/lib/offline-readiness";
import {
  getOfflinePreparationSnapshot,
  runCoordinatedOfflinePreparation,
  setOfflinePreparationContext,
  subscribeOfflinePreparation,
} from "@/lib/offline-preparation-coordinator";
import type { OfflinePreparationState } from "@/lib/offline-preparation-machine";
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

function stateTitle(state: OfflinePreparationState, hasReadiness: boolean) {
  if (state === "checking") return "Vérification hors ligne en cours";
  if (state === "preparing_core") return "Mise à jour hors ligne en cours";
  if (state === "ready") return "Mode hors ligne prêt";
  if (state === "ready_local") return "Appel hors ligne disponible localement";
  if (state === "retry_wait") return "Nouvelle tentative programmée";
  if (state === "error") return "Configuration hors ligne à vérifier";
  return hasReadiness
    ? "Mode hors ligne déjà préparé"
    : "Configuration hors ligne automatique";
}

export default function OfflineReadinessCard({
  role,
  className = "",
  classDeviceContext,
  onPrepared,
}: Props) {
  const [snapshot, setSnapshot] = useState(() =>
    getOfflinePreparationSnapshot(role),
  );
  const [readiness, setReadiness] = useState<OfflineReadiness | null>(
    snapshot.readiness,
  );
  const [storageProtection, setStorageProtection] =
    useState<OfflineStorageProtection | null>(null);
  const lastPreparedAtRef = useRef<string | null>(null);

  useEffect(() => {
    setOfflinePreparationContext(role, classDeviceContext);
  }, [
    role,
    classDeviceContext?.institutionId,
    classDeviceContext?.classId,
    classDeviceContext?.actorProfileId,
    classDeviceContext?.relayBaseUrl,
    classDeviceContext?.relayAccessToken,
  ]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getOfflineReadiness(role).catch(() => null),
      getOfflineStorageProtection().catch(() => null),
    ]).then(([stored, storage]) => {
      if (cancelled) return;
      setReadiness(stored);
      setStorageProtection(storage || stored?.storage_protection || null);
    });
    const unsubscribe = subscribeOfflinePreparation(role, (next) => {
      if (cancelled) return;
      setSnapshot(next);
      if (next.readiness) {
        setReadiness(next.readiness);
        setStorageProtection(next.readiness.storage_protection || null);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [role]);

  useEffect(() => {
    const preparedAt = readiness?.prepared_at || null;
    if (
      !readiness ||
      !preparedAt ||
      preparedAt === lastPreparedAtRef.current ||
      (snapshot.state !== "ready" && snapshot.state !== "ready_local")
    ) {
      return;
    }
    lastPreparedAtRef.current = preparedAt;
    void onPrepared?.(readiness);
  }, [onPrepared, readiness, snapshot.state]);

  const isBusy =
    snapshot.state === "checking" || snapshot.state === "preparing_core";
  const isReady =
    snapshot.state === "ready" ||
    snapshot.state === "ready_local" ||
    (snapshot.state === "idle" && Boolean(readiness?.attendance_core_ready));
  const hasError =
    snapshot.state === "error" || snapshot.state === "retry_wait";
  const title = stateTitle(snapshot.state, Boolean(readiness));
  const storageProtectionText = offlineStorageProtectionMessage(
    storageProtection || readiness?.storage_protection || null,
  );

  const summary = useMemo(() => {
    if (!readiness) return null;
    if (role === "admin") {
      return "Supervision des appels et écrans essentiels préparés";
    }
    return `${readiness.class_count} classe(s), ${readiness.student_count} élève(s), ${readiness.slot_count} créneau(x)`;
  }, [readiness, role]);

  async function retry() {
    await runCoordinatedOfflinePreparation(role, {
      trigger: "manual",
      classDeviceContext,
    });
  }

  return (
    <section
      className={[
        "rounded-2xl border p-4 shadow-sm",
        isReady
          ? "border-emerald-200 bg-emerald-50/80"
          : hasError
            ? "border-amber-200 bg-amber-50/80"
            : "border-slate-200 bg-white",
        className,
      ].join(" ")}
      aria-live="polite"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            {isReady ? (
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
            ) : hasError ? (
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            ) : (
              <CloudDownload className="h-5 w-5 text-slate-600" />
            )}
            {title}
          </div>

          {summary && readiness ? (
            <p className="mt-1 text-sm text-slate-700">
              {summary} — mis à jour le {formatPreparedAt(readiness.prepared_at)}.
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-600">
              Seules les données indispensables à l’appel sont préparées automatiquement.
            </p>
          )}

          {isBusy && snapshot.progress && (
            <p className="mt-2 text-xs font-medium text-sky-800">
              {snapshot.progress}
            </p>
          )}
          {snapshot.error && (
            <p className="mt-2 text-xs font-medium text-rose-700">
              {snapshot.error}
            </p>
          )}
          {snapshot.state === "ready_local" && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-800">
              <WifiOff className="h-3.5 w-3.5" />
              Cloud indisponible : les données essentielles déjà préparées restent utilisables.
            </p>
          )}
          {storageProtectionText && (
            <p className="mt-2 inline-flex items-start gap-1.5 text-xs font-medium text-slate-700">
              <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{storageProtectionText}</span>
            </p>
          )}
        </div>

        {hasError && !isBusy && (
          <button
            type="button"
            onClick={() => void retry()}
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
