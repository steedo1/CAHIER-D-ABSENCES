"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  relayBootstrapErrorMessage,
  syncRelayBootstrap,
} from "@/lib/local-relay";
import {
  readRelaySupervision,
  sanitizedRelayDiagnostic,
  type RelaySupervisionSnapshot,
} from "@/lib/relay-supervision";

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Africa/Abidjan",
  }).format(date);
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function StatusIcon({ state }: { state: RelaySupervisionSnapshot["state"] }) {
  if (state === "operational") return <CheckCircle2 className="h-7 w-7 text-emerald-600" />;
  if (state === "unreachable") return <WifiOff className="h-7 w-7 text-rose-600" />;
  return <AlertTriangle className="h-7 w-7 text-amber-600" />;
}

function stateClasses(state: RelaySupervisionSnapshot["state"]) {
  if (state === "operational") return "border-emerald-200 bg-emerald-50";
  if (state === "unreachable") return "border-rose-200 bg-rose-50";
  return "border-amber-200 bg-amber-50";
}

function MiniCard(props: {
  title: string;
  value: string;
  detail: string;
  good?: boolean;
  warning?: boolean;
}) {
  const dot = props.good
    ? "bg-emerald-500"
    : props.warning
      ? "bg-amber-500"
      : "bg-slate-400";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        {props.title}
      </div>
      <div className="mt-2 text-xl font-bold text-slate-900">{props.value}</div>
      <p className="mt-1 text-xs leading-5 text-slate-500">{props.detail}</p>
    </div>
  );
}

export default function RelaySupervisionPage() {
  const [snapshot, setSnapshot] = useState<RelaySupervisionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showDiagnostic, setShowDiagnostic] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await readRelaySupervision();
      setSnapshot(result);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const result = await syncRelayBootstrap({ force: true });
      if (result.ok) {
        setMessage("Synchronisation terminée avec succès.");
      } else {
        setMessage(relayBootstrapErrorMessage(result));
      }
      await refresh();
    } catch (error) {
      setMessage(relayBootstrapErrorMessage(error));
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  const sync = snapshot?.dashboard?.sync;
  const counts = snapshot?.health?.academic?.counts;
  const pending = number(sync?.pending_operations);
  const blocked = number(sync?.blocked_operations);
  const conflicts = number(sync?.unresolved_conflicts);
  const materialization = number(sync?.materialization_failures);
  const syncIncident = blocked + conflicts + materialization > 0 || Boolean(sync?.last_cloud_sync_error);
  const syncAvailable = Boolean(snapshot?.dashboard);

  const diagnostic = useMemo(
    () => (snapshot ? JSON.stringify(sanitizedRelayDiagnostic(snapshot), null, 2) : ""),
    [snapshot],
  );

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-900 text-white shadow-sm">
              <ServerCog className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-950">Mon Cahier Relais</h1>
              <p className="text-sm text-slate-500">Supervision du PC relais et des données disponibles hors connexion.</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading || syncing}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            <Activity className="h-4 w-4" />
            {loading ? "Vérification…" : "Tester le relais"}
          </button>
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={loading || syncing || snapshot?.configured !== true}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Synchronisation…" : "Synchroniser maintenant"}
          </button>
        </div>
      </div>

      {loading && !snapshot ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
          Vérification du relais local…
        </div>
      ) : snapshot ? (
        <>
          <section className={`rounded-3xl border p-5 shadow-sm ${stateClasses(snapshot.state)}`}>
            <div className="flex items-start gap-4">
              <StatusIcon state={snapshot.state} />
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold text-slate-950">
                  {snapshot.state === "operational"
                    ? "Relais opérationnel"
                    : snapshot.state === "unreachable"
                      ? "Relais non détecté"
                      : snapshot.state === "not_configured"
                        ? "Relais à configurer"
                        : "Relais à vérifier"}
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-700">{snapshot.message}</p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
                  <span>Adresse : <strong>{snapshot.base_url}</strong></span>
                  <span>Contrôle : <strong>{formatDate(snapshot.checked_at)}</strong></span>
                </div>
              </div>
            </div>
          </section>

          {message ? (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
              {message}
            </div>
          ) : null}

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MiniCard
              title="Relais"
              value={snapshot.reachable ? "Connecté" : "Non détecté"}
              detail={`Version ${snapshot.health?.relay_version || "—"} · schéma ${snapshot.health?.schema_version ?? "—"}`}
              good={snapshot.reachable}
              warning={!snapshot.reachable}
            />
            <MiniCard
              title="Données hors ligne"
              value={snapshot.data_ready ? "Prêtes" : "À préparer"}
              detail={`Révision académique ${snapshot.health?.academic?.revision ?? "—"}`}
              good={snapshot.data_ready}
              warning={!snapshot.data_ready}
            />
            <MiniCard
              title="Synchronisation"
              value={!syncAvailable ? "Indisponible" : syncIncident ? "À vérifier" : "Saine"}
              detail={syncAvailable ? `${pending} opération(s) en attente · ${blocked} bloquée(s)` : "Diagnostic administrateur non disponible"}
              good={syncAvailable && !syncIncident}
              warning={syncAvailable && syncIncident}
            />
            <MiniCard
              title="Planning"
              value={snapshot.health?.schedule_status === "ready" ? "Prêt" : String(snapshot.health?.schedule_status || "—")}
              detail={`Révision ${snapshot.health?.snapshot_revision ?? "—"}`}
              good={snapshot.health?.schedule_status === "ready"}
              warning={snapshot.health?.schedule_status !== "ready"}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-slate-700" />
                <h2 className="font-bold text-slate-900">Données disponibles localement</h2>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Classes", counts?.classes],
                  ["Élèves", counts?.students],
                  ["Enseignants", counts?.teachers],
                  ["Périodes", counts?.grading_periods],
                  ["Matières", counts?.subjects],
                  ["Évaluations", counts?.assessments],
                  ["Notes", counts?.grades],
                  ["Notes publiées", counts?.published_scores],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-2xl bg-slate-50 px-3 py-4 text-center">
                    <div className="text-2xl font-bold text-slate-950">{number(value)}</div>
                    <div className="mt-1 text-xs text-slate-500">{String(label)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-slate-700" />
                <h2 className="font-bold text-slate-900">Synchronisation & intégrité</h2>
              </div>
              <dl className="mt-4 divide-y divide-slate-100 text-sm">
                <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Dernière synchro académique</dt><dd className="text-right font-medium text-slate-900">{formatDate(snapshot.health?.academic?.last_sync_at)}</dd></div>
                <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Dernier envoi Cloud</dt><dd className="text-right font-medium text-slate-900">{formatDate(sync?.last_cloud_sync_at)}</dd></div>
                <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Conflits non résolus</dt><dd className="font-semibold text-slate-900">{conflicts}</dd></div>
                <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Échecs de matérialisation</dt><dd className="font-semibold text-slate-900">{materialization}</dd></div>
                <div className="flex justify-between gap-4 py-3"><dt className="text-slate-500">Dernière erreur Cloud</dt><dd className={`max-w-[60%] text-right font-medium ${sync?.last_cloud_sync_error ? "text-rose-700" : "text-emerald-700"}`}>{sync?.last_cloud_sync_error || "Aucune"}</dd></div>
              </dl>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <button
              type="button"
              onClick={() => setShowDiagnostic((value) => !value)}
              className="flex w-full items-center justify-between gap-4 text-left"
            >
              <span>
                <span className="block font-bold text-slate-900">Diagnostic technique</span>
                <span className="mt-1 block text-xs text-slate-500">Informations utiles au support, sans jeton administrateur ni secret.</span>
              </span>
              <span className="text-sm font-semibold text-slate-600">{showDiagnostic ? "Masquer" : "Afficher"}</span>
            </button>
            {showDiagnostic ? (
              <pre className="mt-4 max-h-[420px] overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">{diagnostic}</pre>
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
