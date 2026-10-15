"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchAttendanceBackground } from "@/lib/attendance-network";
import { getClassDeviceLocalSyncStatus, repairClassDeviceSyncV2 } from "@/lib/class-device-sync-reconcile-v2";
import type { ClassDeviceSyncScope } from "@/lib/class-device-sync-state";
import {
  archiveOfflineCalls, cacheGet, previewOfflineCallArchive, readOfflineCallArchive,
  resolveOfflineSessionReference, type OfflineCallArchivePreview, type OfflineCallArchiveResult,
} from "@/lib/offline";

type Scope = ClassDeviceSyncScope & { label?: string | null };
type RowView = {
  operationId: string; operationType: string; createdAt: number;
  state: string; lastStatus: number | null; lastError: string | null;
  localSession: string | null; resolvedSession: string | null;
};
const callTypes = new Set(["session-start", "attendance", "session-end"]);
const text = (value: unknown) => String(value ?? "").trim();
function localDate(value: string | number | null) {
  if (!value) return "Date non enregistrée";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" }) : "Date non enregistrée";
}
function selectedScope(payload: { items?: Scope[] } | null, classId: string | null) {
  const items = (Array.isArray(payload?.items) ? payload.items : []).filter((item) => item.id && item.institution_id);
  return (classId ? items.find((item) => item.id === classId) : items.length === 1 ? items[0] : null) || null;
}
async function localRows(scope: Scope) {
  const status = await getClassDeviceLocalSyncStatus(scope);
  const rows = new Map<string, RowView>();
  for (const operation of status.operations) {
    rows.set(operation.operationId, {
      operationId: operation.operationId, operationType: operation.operationType,
      createdAt: operation.createdAt || 0, state: operation.blocked ? "blocked" : "pending",
      lastStatus: operation.lastStatus ?? null, lastError: operation.lastError || null,
      localSession: operation.dependencyKey || null, resolvedSession: null,
    });
  }
  for (const entry of status.entries) {
    rows.set(entry.operationId, {
      operationId: entry.operationId, operationType: entry.operationType || "inconnue",
      createdAt: entry.createdAt, state: entry.state, lastStatus: entry.lastStatus,
      lastError: entry.lastError, localSession: entry.sessionDependencyKey, resolvedSession: null,
    });
  }
  await Promise.all([...rows.values()].map(async (row) => {
    if (!row.localSession) return;
    const resolved = await resolveOfflineSessionReference(row.localSession).catch(() => null);
    row.resolvedSession = resolved?.serverSessionId || null;
  }));
  return { ...status, rows: [...rows.values()].sort((a, b) => a.createdAt - b.createdAt) };
}

export default function RecoverClassSyncV2Page() {
  const [scope, setScope] = useState<Scope | null>(null);
  const [status, setStatus] = useState("Analyse des actions de cette classe…");
  const [before, setBefore] = useState<number | null>(null);
  const [removed, setRemoved] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [rows, setRows] = useState<RowView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);
  const [analyzing, setAnalyzing] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [archivePreview, setArchivePreview] = useState<OfflineCallArchivePreview | null>(null);
  const [archiveConfirmed, setArchiveConfirmed] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archived, setArchived] = useState<OfflineCallArchiveResult | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const busy = analyzing || archiving;
  const diagnostic = useMemo(() => rows.map((row) => [
    `Action : ${row.operationType} / ${row.operationId}`,
    `Enregistrée sur l’appareil : ${localDate(row.createdAt)}`,
    `Séance : ${row.resolvedSession || row.localSession || "non trouvée"}`,
    `État local : ${row.state} / HTTP ${row.lastStatus ?? "non reçu"} / ${row.lastError || "aucune erreur enregistrée"}`,
  ].join("\n")).join("\n\n"), [rows]);

  useEffect(() => {
    let cancelled = false;
    setAnalyzing(true);
    setError(null);
    setArchivePreview(null);
    setArchiveConfirmed(false);
    setSelectedIds([]);
    setRemoved(0);
    const display = (local: Awaited<ReturnType<typeof localRows>>) => {
      if (cancelled) return;
      setRows(local.rows); setRemaining(local.total);
    };
    void (async () => {
      try {
        const classId = new URLSearchParams(window.location.search).get("class_id");
        let active = selectedScope(await cacheGet<{ items?: Scope[] }>("classDevice:my-classes"), classId);
        if (active) {
          const local = await localRows(active);
          if (cancelled) return;
          setScope(active); setBefore(local.total); display(local);
        }
        if (navigator.onLine) {
          const response = await fetchAttendanceBackground("/api/class/my-classes?offline_contract=v5&sync_reconcile=3",
            { credentials: "include", cache: "no-store" });
          if (!response.ok) throw new Error(`Vérification Cloud indisponible (${response.status}). Les actions locales restent conservées.`);
          active = selectedScope(await response.json(), classId);
          if (!active) {
            if (!cancelled) { setScope(null); setRows([]); setRemaining(null); }
            throw new Error("Revenez à l’appel et ouvrez les détails de la classe connectée.");
          }
        }
        if (!active) throw new Error("Le contexte de cette classe est indisponible. Revenez à l’appel pour le charger.");
        if (cancelled) return;
        setScope(active);
        const initial = await localRows(active);
        if (cancelled) return;
        setBefore(initial.total); display(initial);
        if (navigator.onLine && (initial.total > 0 || initial.completion?.relay_state === "device_pending")) {
          setStatus("Vérification et reprise des actions de cette classe…");
          await repairClassDeviceSyncV2({ scope: active });
        }
        const final = await localRows(active);
        if (cancelled) return;
        display(final);
        setRemoved(Math.max(0, initial.total - final.total));
        setStatus(final.total > 0
          ? `${final.total} action(s) de cette classe restent conservées sur ce téléphone.`
          : final.completion?.relay_state === "device_pending"
            ? "Aucune action dans la file de cette classe. Le dernier appel attend encore sa confirmation Cloud."
            : "Aucune action en attente pour cette classe.");
      } catch (cause: unknown) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "La vérification est indisponible.");
          setStatus("Les actions affichées restent conservées sur ce téléphone.");
        }
      } finally { if (!cancelled) setAnalyzing(false); }
    })();
    return () => { cancelled = true; };
  }, [runId]);

  async function reviewArchive() {
    if (busy || !selectedIds.length) return;
    setArchiving(true); setError(null); setArchiveConfirmed(false);
    try { setArchivePreview(await previewOfflineCallArchive(selectedIds)); }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "La sélection n’a pas pu être vérifiée."); }
    finally { setArchiving(false); }
  }
  async function archive() {
    if (busy || !archivePreview || !archiveConfirmed) return;
    setArchiving(true); setError(null);
    try {
      setArchived(await archiveOfflineCalls(archivePreview));
      setRunId((value) => value + 1);
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "Le retrait a échoué. Les actions restent conservées."); }
    finally { setArchivePreview(null); setArchiveConfirmed(false); setArchiving(false); }
  }
  async function downloadArchive() {
    if (!archived) return;
    try {
      const backup = await readOfflineCallArchive(archived.id);
      if (!backup) throw new Error("Sauvegarde locale introuvable.");
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `mon-cahier-actions-archivees-${archived.id}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "Le téléchargement a échoué."); }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Détails de synchronisation{scope?.label ? ` — ${scope.label}` : ""}</h1>
        <p className="mt-2 text-sm text-slate-600">Les actions ci-dessous concernent cette classe. Les appels non confirmés restent conservés sur ce téléphone.</p>
        <p role="status" className="mt-2 text-sm text-slate-600">{status}</p>
        <button type="button" disabled={busy || !scope} onClick={() => setRunId((value) => value + 1)} className="mt-4 rounded-xl bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {analyzing ? "Vérification en cours…" : "Réessayer l’envoi des appels"}
        </button>
        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-2xl bg-slate-100 p-3"><div className="text-2xl font-bold">{before ?? "…"}</div><div className="text-xs text-slate-600">avant</div></div>
          <div className="rounded-2xl bg-emerald-50 p-3"><div className="text-2xl font-bold text-emerald-700">{removed}</div><div className="text-xs text-emerald-700">confirmées</div></div>
          <div className="rounded-2xl bg-amber-50 p-3"><div className="text-2xl font-bold text-amber-700">{remaining ?? "…"}</div><div className="text-xs text-amber-700">restantes</div></div>
        </div>
        {error ? <div role="alert" className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div> : null}
        {archived ? <div role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p>{archived.operationCount} ancienne(s) action(s) retirée(s) de cet appareil et sauvegardée(s) localement. Les autres appels sont conservés.</p>
          <button type="button" onClick={() => void downloadArchive()} className="mt-3 rounded-xl border border-emerald-700 px-3 py-2 font-semibold">Télécharger la sauvegarde</button>
        </div> : null}
        <div className="mt-5 space-y-3">
          {rows.map((row) => <div key={row.operationId} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
            {callTypes.has(row.operationType) ? <label className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" disabled={busy} checked={selectedIds.includes(row.operationId)} onChange={(event) => {
                setSelectedIds((ids) => event.target.checked ? [...ids, row.operationId] : ids.filter((id) => id !== row.operationId));
                setArchivePreview(null); setArchiveConfirmed(false);
              }} />Sélectionner cette ancienne action
            </label> : null}
            <div className="font-semibold">{row.operationType}</div>
            <div className="mt-1">Enregistrée sur l’appareil : {localDate(row.createdAt)}</div>
            <div className="mt-1 break-all">{row.operationId}</div>
            <div className="mt-1 break-all">Séance locale : {row.localSession || "non trouvée"}</div>
            <div className="mt-1 break-all">Séance Cloud liée : {row.resolvedSession || "non confirmée"}</div>
            <div className="mt-1">État local : {row.state}{row.lastStatus ? ` / HTTP ${row.lastStatus}` : ""}{row.lastError ? ` / ${row.lastError}` : ""}</div>
          </div>)}
        </div>
        {rows.some((row) => callTypes.has(row.operationType)) ? <div className="mt-5 rounded-2xl border border-slate-300 p-4 text-sm">
          <h2 className="font-semibold">Retirer d’anciennes actions de cet appareil</h2>
          <p className="mt-2">Cochez uniquement les anciens essais ou actions à abandonner. Les actions liées à la même séance seront regroupées avant validation.</p>
          <p className="mt-2">Un appel réel non envoyé doit rester dans la file. Le retrait ne confirme pas sa réception par l’administration.</p>
          <button type="button" disabled={busy || !selectedIds.length} onClick={() => void reviewArchive()} className="mt-3 rounded-xl border border-slate-400 px-3 py-2 font-semibold disabled:opacity-50">Vérifier la sélection ({selectedIds.length})</button>
          {archivePreview ? <div className="mt-4 border-t border-slate-200 pt-4">
            <p className="font-semibold">{archivePreview.operationIds.length} action(s) de ces séances seront archivées sur cet appareil.</p>
            <ul className="mt-2 space-y-2 text-xs">{archivePreview.actions.map((action) => <li key={action.operationId} className="break-all">{localDate(action.createdAt)} · {action.type} · {action.sessionReference || action.operationId}</li>)}</ul>
            <label className="mt-4 flex items-start gap-2"><input type="checkbox" disabled={busy} checked={archiveConfirmed} onChange={(event) => setArchiveConfirmed(event.target.checked)} />Je confirme l’abandon de ces anciennes actions. Elles ne seront plus envoyées ; une sauvegarde locale sera conservée.</label>
            <button type="button" disabled={busy || !archiveConfirmed} onClick={() => void archive()} className="mt-3 rounded-xl bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-50">{archiving ? "Retrait en cours…" : "Retirer les anciennes actions sélectionnées"}</button>
          </div> : null}
        </div> : null}
        {diagnostic ? <div className="mt-4">
          <button type="button" onClick={async () => {
            try { await navigator.clipboard.writeText(diagnostic); setCopyStatus("Diagnostic copié."); }
            catch { setCopyStatus("Copie indisponible. Le texte ci-dessous peut être sélectionné."); }
          }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">Copier le diagnostic</button>
          {copyStatus ? <p role="status" className="mt-2 text-sm">{copyStatus}</p> : null}
          <details className="mt-3 text-xs"><summary>Voir le texte du diagnostic</summary><pre className="mt-2 whitespace-pre-wrap break-all select-text">{diagnostic}</pre></details>
        </div> : null}
        <Link href="/class" className="mt-5 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Retour aux appels</Link>
      </section>
    </main>
  );
}
