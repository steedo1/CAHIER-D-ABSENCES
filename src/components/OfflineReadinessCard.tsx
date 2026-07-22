"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CloudDownload, RefreshCcw, ShieldCheck, WifiOff } from "lucide-react";
import {
  getOfflineReadiness,
  prepareOffline,
  type OfflineReadiness,
  type OfflineRole,
} from "@/lib/offline-readiness";

type Props = {
  role: OfflineRole;
  className?: string;
};

function formatPreparedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "date inconnue";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export default function OfflineReadinessCard({ role, className = "" }: Props) {
  const [readiness, setReadiness] = useState<OfflineReadiness | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    void getOfflineReadiness(role).then(setReadiness).catch(() => setReadiness(null));

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [role]);

  const stale = useMemo(() => {
    if (!readiness) return false;
    const preparedAt = new Date(readiness.prepared_at).getTime();
    return !Number.isFinite(preparedAt) || Date.now() - preparedAt > 24 * 60 * 60 * 1000;
  }, [readiness]);

  async function handlePrepare() {
    if (!online || preparing) return;
    setPreparing(true);
    setError(null);
    setProgress("Démarrage de la préparation…");
    try {
      const next = await prepareOffline(role, setProgress);
      setReadiness(next);
      setProgress("Préparation terminée.");
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
        : "Télécharge l’emploi du temps, les listes d’élèves, les évaluations, les notes et le cahier de texte sur cet appareil.";

  const relayConnectivity = role === "teacher" ? readiness?.relay_connectivity : undefined;
  const relayConnectivityMessage = relayConnectivity?.status === "reachable"
    ? "Relais joignable par l’application."
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
                ? "Mode hors ligne prêt — actualisation conseillée"
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
                relayConnectivity?.status === "reachable" ? "text-emerald-800" : "text-amber-800",
              ].join(" ")}
            >
              {relayConnectivityMessage}
            </p>
          )}
          {!online && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-800">
              <WifiOff className="h-3.5 w-3.5" />
              Hors connexion : les données déjà préparées restent disponibles.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={handlePrepare}
          disabled={!online || preparing}
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
