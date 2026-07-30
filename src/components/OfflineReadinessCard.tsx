"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CloudDownload, RefreshCcw, ShieldCheck, WifiOff } from "lucide-react";
import {
  assessClassDeviceOfflineReadiness,
  assessTeacherOfflineReadiness,
  getOfflineReadiness,
  prepareOffline,
  type ClassDeviceScheduleAssessment,
  type OfflineReadiness,
  type OfflineRole,
  type TeacherScheduleAssessment,
} from "@/lib/offline-readiness";

type Props = {
  role: OfflineRole;
  className?: string;
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

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const stored = await getOfflineReadiness(role).catch(() => null);
      if (cancelled) return;
      setReadiness(stored);
      if (role === "teacher" || role === "class-device") {
        const next =
          role === "teacher"
            ? await assessTeacherOfflineReadiness(stored)
            : await assessClassDeviceOfflineReadiness(stored);
        if (cancelled) return;
        setAssessment(next);
        setReadiness(next.readiness);
      }
    };
    void refresh();
    const handleNetworkChange = () => void refresh();
    window.addEventListener("online", handleNetworkChange);
    window.addEventListener("offline", handleNetworkChange);
    return () => {
      cancelled = true;
      window.removeEventListener("online", handleNetworkChange);
      window.removeEventListener("offline", handleNetworkChange);
    };
  }, [role]);

  const stale = useMemo(() => {
    if (!readiness) return false;
    const preparedAt = new Date(readiness.prepared_at).getTime();
    const ageStale =
      !Number.isFinite(preparedAt) ||
      Date.now() - preparedAt > 24 * 60 * 60 * 1000;
    const scheduleStale =
      (role === "teacher" || role === "class-device") &&
      assessment?.status !== "ready";
    return ageStale || scheduleStale;
  }, [assessment?.status, readiness, role]);

  async function handlePrepare() {
    if (preparing) return;
    setPreparing(true);
    setError(null);
    setProgress("Démarrage de la préparation…");
    try {
      const next = await prepareOffline(role, setProgress);
      if (role === "teacher" || role === "class-device") {
        const checked =
          role === "teacher"
            ? await assessTeacherOfflineReadiness(next)
            : await assessClassDeviceOfflineReadiness(next);
        setAssessment(checked);
        setReadiness(checked.readiness);
        setProgress(
          checked.status === "ready"
            ? "Préparation et cohérence vérifiées."
            : "Données téléchargées, mais cohérence hors ligne non confirmée.",
        );
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
      setPreparing(false);
    }
  }

  const preparedSummary = readiness
    ? role === "admin"
      ? `${readiness.class_count} classe(s), ${readiness.student_count} élève(s), ${readiness.bulletin_count} bulletin(s) et historique des communications`
      : role === "parent"
        ? `${readiness.parent_child_count} enfant(s), ${readiness.bulletin_count} bulletin(s), notes, absences et cahier de texte`
        : `${readiness.class_count} classe(s), ${readiness.student_count} élève(s), ${readiness.slot_count} créneau(x), ${readiness.evaluation_count} évaluation(s), ${readiness.textbook_assignment_count} progression(s)`
    : "";

  const preparationDescription =
    role === "admin"
      ? "Télécharge les bulletins officiels, leurs images et l’historique des communications sur cet appareil."
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
            {readiness
              ? stale
                ? role === "teacher" || role === "class-device"
                  ? "Mode hors ligne non compatible"
                  : "Mode hors ligne prêt — actualisation conseillée"
                : "Mode hors ligne prêt"
              : "Préparer le mode hors ligne"}
          </div>

          {readiness ? (
            <p className="mt-1 text-sm text-slate-700">
              {preparedSummary} — mis à jour le{" "}
              {formatPreparedAt(readiness.prepared_at)}.
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-600">
              {preparationDescription}
            </p>
          )}

          {preparing && progress && <p className="mt-2 text-xs font-medium text-sky-800">{progress}</p>}
          {error && <p className="mt-2 text-xs font-medium text-rose-700">{error}</p>}
          {relayConnectivityMessage && (
            <p
              className={[
                "mt-2 text-xs font-semibold",
                assessment?.status === "ready" ? "text-emerald-800" : "text-amber-800",
              ].join(" ")}
            >
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
          onClick={handlePrepare}
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
