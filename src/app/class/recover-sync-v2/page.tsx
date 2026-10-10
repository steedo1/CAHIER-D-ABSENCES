"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchAttendanceBackground } from "@/lib/attendance-network";
import { repairClassDeviceSyncV2 } from "@/lib/class-device-sync-reconcile-v2";
import {
  archiveOfflineCalls,
  listOfflineOutboxEntries,
  previewOfflineCallArchive,
  readOfflineCallArchive,
  registerOfflineSessionReference,
  removeQueuedOfflineMutation,
  resolveOfflineSessionReference,
  type OfflineOutboxEntry,
  type OfflineCallArchivePreview,
  type OfflineCallArchiveResult,
} from "@/lib/offline";
import {
  markTeacherAttendanceSyncedInCloud,
} from "@/lib/teacher-attendance-delivery";
import {
  markTeacherSessionOpenedInCloud,
} from "@/lib/teacher-session-delivery";
import {
  markTeacherSessionClosedInCloud,
} from "@/lib/teacher-session-lifecycle-delivery";

type OperationType = "session-start" | "attendance" | "session-end";
type ClassItem = { id: string; label?: string | null; institution_id: string };
type RawOutboxRow = { id?: string; body?: Record<string, any> };
type ReconcileResult = {
  operation_id: string;
  operation_type: OperationType;
  acknowledged: boolean;
  session_id: string | null;
  reason: string;
  subject_id?: string | null;
  started_at?: string | null;
  actual_call_at?: string | null;
};
type RowView = {
  operationId: string;
  operationType: string;
  createdAt: number;
  classId: string | null;
  state: string;
  lastStatus: number | null;
  lastError: string | null;
  localSession: string | null;
  resolvedSession: string | null;
  result?: ReconcileResult | null;
};

const CALL_TYPES = new Set<OperationType>([
  "session-start",
  "attendance",
  "session-end",
]);

function text(value: unknown) {
  return String(value ?? "").trim();
}
function localDate(value: string | number | null) {
  if (!value) return "Date non enregistrée";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" }) : "Date non enregistrée";
}
function isCallType(value: unknown): value is OperationType {
  return CALL_TYPES.has(text(value) as OperationType);
}
function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function req<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function txDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function readRawRows(ids: string[]) {
  const result = new Map<string, RawOutboxRow>();
  if (typeof window === "undefined" || !("indexedDB" in window) || !ids.length) {
    return result;
  }
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("moncahier_offline_v1");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    if (!db.objectStoreNames.contains("outbox")) return result;
    const transaction = db.transaction(["outbox"], "readonly");
    const done = txDone(transaction);
    const store = transaction.objectStore("outbox");
    for (const id of ids) {
      const row = await req<RawOutboxRow | undefined>(store.get(id));
      if (row) result.set(id, row);
    }
    await done;
    return result;
  } finally {
    db.close();
  }
}

function scopedToClass(entry: OfflineOutboxEntry, cls: ClassItem, classCount: number) {
  if (!isCallType(entry.operationType)) return false;
  const classId = text(entry.meta?.classId);
  const institutionId = text(entry.meta?.institutionId);
  if (classId && classId !== cls.id) return false;
  if (institutionId && institutionId !== cls.institution_id) return false;
  return Boolean(classId || institutionId || classCount === 1);
}

function localSessionCandidate(entry: OfflineOutboxEntry, raw?: RawOutboxRow) {
  const body = raw?.body || {};
  return (
    text(body.session_id) ||
    text(body.client_session_id) ||
    text(entry.meta?.clientSessionId) ||
    text(entry.sessionDependencyKey) ||
    null
  );
}

async function resolvedSessionFor(entry: OfflineOutboxEntry, raw?: RawOutboxRow) {
  if (entry.operationType === "session-start") return null;
  const candidate = localSessionCandidate(entry, raw);
  if (!candidate) return null;
  if (isUuid(candidate)) return candidate;
  const normalized = candidate.startsWith("client:") ? candidate : `client:${candidate}`;
  const resolved = await resolveOfflineSessionReference(normalized);
  return resolved.serverSessionId;
}

function operationBody(entry: OfflineOutboxEntry, raw: RawOutboxRow | undefined, serverSessionId: string | null) {
  const body = raw?.body && typeof raw.body === "object" ? raw.body : {};
  if (entry.operationType === "attendance") {
    return {
      session_id: serverSessionId || text(body.session_id) || null,
      captured_at_device:
        text(body.captured_at_device) ||
        text(body.actual_call_at) ||
        text(body.client_call_at) ||
        text(body.call_at) ||
        null,
      marks: Array.isArray(body.marks) ? body.marks : [],
    };
  }
  if (entry.operationType === "session-end") {
    return {
      session_id: serverSessionId || text(body.session_id) || null,
      actual_end_at: text(body.actual_end_at) || null,
      device_requested_at: text(body.device_requested_at) || null,
    };
  }
  return {
    class_id: text(body.class_id) || null,
    subject_id: text(body.subject_id) || null,
    period_id: text(body.period_id) || null,
    actual_call_at: text(body.actual_call_at) || null,
  };
}

async function terminalize(cls: ClassItem, result: ReconcileResult) {
  if (!result.acknowledged || !result.session_id) return false;
  if (result.operation_type === "session-start") {
    await registerOfflineSessionReference(
      `client:${result.operation_id}`,
      result.session_id,
    ).catch(() => undefined);
    await markTeacherSessionOpenedInCloud({
      institutionId: cls.institution_id,
      operationId: result.operation_id,
      sessionId: result.session_id,
      subjectId: result.subject_id || null,
      startedAt: result.started_at || null,
      actualCallAt: result.actual_call_at || null,
    });
  } else if (result.operation_type === "attendance") {
    await markTeacherAttendanceSyncedInCloud({
      institutionId: cls.institution_id,
      operationId: result.operation_id,
      sessionId: result.session_id,
      status: 200,
    });
  } else {
    await markTeacherSessionClosedInCloud({
      institutionId: cls.institution_id,
      operationId: result.operation_id,
      status: 200,
    });
  }
  return true;
}

export default function RecoverClassSyncV2Page() {
  const [status, setStatus] = useState("Analyse des opérations historiques…");
  const [before, setBefore] = useState<number | null>(null);
  const [removed, setRemoved] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [rows, setRows] = useState<RowView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [archivePreview, setArchivePreview] = useState<OfflineCallArchivePreview | null>(null);
  const [archiveConfirmed, setArchiveConfirmed] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archived, setArchived] = useState<OfflineCallArchiveResult | null>(null);
  const busy = analyzing || retrying || archiving;

  const unresolved = useMemo(
    () => rows.filter((row) => !row.result?.acknowledged),
    [rows],
  );
  const diagnostic = unresolved.map((row) => [
    `Action : ${row.operationType} / ${row.operationId}`,
    `Enregistrée sur l’appareil : ${localDate(row.createdAt)}`,
    `Séance : ${row.resolvedSession || row.localSession || "non trouvée"}`,
    `Preuve : ${row.result?.reason || "non vérifiée"}`,
    `État local : ${row.state} / HTTP ${row.lastStatus ?? "non reçu"} / ${row.lastError || "aucune erreur enregistrée"}`,
  ].join("\n")).join("\n\n");

  async function retry() {
    if (busy) return;
    setArchivePreview(null);
    setRetrying(true);
    setError(null);
    setStatus("Reprise de l’envoi des appels conservés sur cet appareil…");
    try {
      await repairClassDeviceSyncV2();
    } catch (cause: any) {
      setError(text(cause?.message) || "La reprise a échoué. Les données restent conservées.");
    } finally {
      setRetrying(false);
      setRunId((value) => value + 1);
    }
  }

  async function reviewArchive() {
    if (busy || !selectedIds.length) return;
    setArchiving(true);
    setError(null);
    setArchiveConfirmed(false);
    try { setArchivePreview(await previewOfflineCallArchive(selectedIds)); }
    catch (cause: any) { setError(text(cause?.message) || "La sélection n’a pas pu être vérifiée."); }
    finally { setArchiving(false); }
  }

  async function archive() {
    if (busy || !archivePreview || !archiveConfirmed) return;
    setArchiving(true);
    setError(null);
    try {
      setArchived(await archiveOfflineCalls(archivePreview));
      setSelectedIds([]);
      setArchivePreview(null);
      setArchiveConfirmed(false);
      setRunId((value) => value + 1);
    } catch (cause: any) {
      setError(text(cause?.message) || "Le retrait a échoué. Les actions restent conservées.");
      setArchivePreview(null);
      setArchiveConfirmed(false);
    } finally { setArchiving(false); }
  }

  async function downloadArchive() {
    if (!archived) return;
    try {
      const backup = await readOfflineCallArchive(archived.id);
      if (!backup) throw new Error("Sauvegarde locale introuvable.");
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `mon-cahier-actions-archivees-${archived.id}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause: any) { setError(text(cause?.message) || "Le téléchargement a échoué."); }
  }

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setAnalyzing(true);
    setArchivePreview(null);

    void (async () => {
      try {
        // Local diagnostics stay available even when Cloud verification is unavailable.
        const initial = await listOfflineOutboxEntries();
        const initialRaw = await readRawRows(initial.map((entry) => entry.id));
        if (cancelled) return;
        setBefore(initial.length);
        setRemaining(initial.length);
        setRows(initial.map((entry) => ({
          operationId: entry.operationId, operationType: text(entry.operationType) || "inconnue",
          createdAt: entry.createdAt, classId: text(entry.meta?.classId) || null,
          state: entry.state, lastStatus: entry.lastStatus, lastError: entry.lastError,
          localSession: localSessionCandidate(entry, initialRaw.get(entry.id)), resolvedSession: null,
        })));
        const classResponse = await fetchAttendanceBackground(
          "/api/class/my-classes?offline_contract=v5&sync_reconcile=3",
          { credentials: "include", cache: "no-store" },
        );
        if (!classResponse.ok) {
          throw new Error(`Contexte de classe indisponible (${classResponse.status}).`);
        }
        const classPayload = await classResponse.json();
        const classes = (Array.isArray(classPayload?.items) ? classPayload.items : [])
          .map((item: any) => ({
            id: text(item?.id),
            label: item?.label || null,
            institution_id: text(item?.institution_id),
          }))
          .filter((item: ClassItem) => item.id && item.institution_id);
        if (!classes.length) throw new Error("Aucune classe autorisée n’a été trouvée.");

        if (cancelled) return;
        if (!initial.length) {
          setRemaining(0);
          setRows([]);
          setStatus("Aucune action dans la file d’envoi. Le badge de l’appel vérifie séparément sa réception dans le Cloud.");
          return;
        }

        const resultByOperation = new Map<string, ReconcileResult>();
        const resolvedByOperation = new Map<string, string | null>();
        let removedCount = 0;

        for (let pass = 0; pass < 3; pass += 1) {
          const entries = (await listOfflineOutboxEntries()).filter((entry) =>
            isCallType(entry.operationType),
          );
          if (!entries.length) break;
          const rawRows = await readRawRows(entries.map((entry) => entry.id));
          let progress = 0;

          for (const cls of classes) {
            const scoped = entries.filter((entry) => scopedToClass(entry, cls, classes.length));
            if (!scoped.length) continue;

            const operations = [] as Array<{
              entry: OfflineOutboxEntry;
              localSession: string | null;
              resolvedSession: string | null;
              operationBody: Record<string, any>;
              dependencyKey: string;
            }>;
            for (const entry of scoped) {
              const raw = rawRows.get(entry.id);
              const localSession = localSessionCandidate(entry, raw);
              const resolvedSession = await resolvedSessionFor(entry, raw);
              resolvedByOperation.set(entry.operationId, resolvedSession);
              operations.push({
                entry,
                localSession,
                resolvedSession,
                operationBody: operationBody(entry, raw, resolvedSession),
                dependencyKey:
                  resolvedSession ||
                  text(entry.sessionDependencyKey) ||
                  localSession ||
                  "",
              });
            }

            setStatus(`Vérification Cloud de ${operations.length} opération(s) pour ${cls.label || "la classe"}…`);
            const response = await fetchAttendanceBackground("/api/class/sync/reconcile-v2", {
              method: "POST",
              credentials: "include",
              cache: "no-store",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                class_id: cls.id,
                operations: operations.map((operation) => ({
                  operation_id: operation.entry.operationId,
                  operation_type: operation.entry.operationType,
                  session_dependency_key: operation.dependencyKey,
                  operation_body: operation.operationBody,
                })),
              }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || payload?.ok !== true) {
              throw new Error(String(payload?.error || `Réconciliation refusée (${response.status}).`));
            }
            const results = Array.isArray(payload?.results)
              ? (payload.results as ReconcileResult[])
              : [];
            for (const result of results) resultByOperation.set(result.operation_id, result);

            const operationById = new Map(
              operations.map((operation) => [operation.entry.operationId, operation]),
            );
            for (const result of results) {
              if (!result.acknowledged) continue;
              const operation = operationById.get(result.operation_id);
              if (!operation) continue;
              if (!(await terminalize(cls, result))) continue;
              await removeQueuedOfflineMutation(operation.entry.id);
              removedCount += 1;
              progress += 1;
            }
          }

          if (progress === 0) break;
        }

        const finalEntries = await listOfflineOutboxEntries();
        const rawFinal = await readRawRows(finalEntries.map((entry) => entry.id));
        const view: RowView[] = [];
        for (const entry of finalEntries) {
          const raw = rawFinal.get(entry.id);
          const localSession = localSessionCandidate(entry, raw);
          const resolvedSession =
            resolvedByOperation.get(entry.operationId) ??
            (await resolvedSessionFor(entry, raw));
          view.push({
            operationId: entry.operationId,
            operationType: text(entry.operationType) || "inconnue",
            createdAt: entry.createdAt,
            classId: text(entry.meta?.classId) || null,
            state: entry.state,
            lastStatus: entry.lastStatus,
            lastError: entry.lastError,
            localSession,
            resolvedSession,
            result: resultByOperation.get(entry.operationId) || null,
          });
        }

        if (cancelled) return;
        setRemoved(removedCount);
        setRemaining(finalEntries.length);
        setRows(view);
        setStatus(
          finalEntries.length === 0
            ? `${removedCount} résidu(s) historiques ont été prouvés dans le Cloud puis retirés localement.`
            : `${finalEntries.length} opération(s) restent protégées. Le détail ci-dessous indique maintenant si le lien local → séance Cloud a été retrouvé.`,
        );
      } catch (cause: any) {
        if (cancelled) return;
        setError(text(cause?.message) || "La récupération a échoué.");
        setStatus("Réconciliation interrompue.");
      } finally {
        if (!cancelled) setAnalyzing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runId]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Détails de synchronisation</h1>
        <p className="mt-2 text-sm text-slate-600">Cette page vérifie les actions conservées dans cette PWA. Une action déjà confirmée peut être retirée de la file d’envoi ; les autres restent conservées.</p>
        <p className="mt-2 text-sm text-slate-600">{status}</p>
        <button type="button" disabled={busy} onClick={() => void retry()} className="mt-4 rounded-xl bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {retrying ? "Reprise en cours…" : "Réessayer l’envoi des appels"}
        </button>

        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-2xl bg-slate-100 p-3"><div className="text-2xl font-bold">{before ?? "…"}</div><div className="text-xs text-slate-600">avant</div></div>
          <div className="rounded-2xl bg-emerald-50 p-3"><div className="text-2xl font-bold text-emerald-700">{removed}</div><div className="text-xs text-emerald-700">confirmés</div></div>
          <div className="rounded-2xl bg-amber-50 p-3"><div className="text-2xl font-bold text-amber-700">{remaining ?? "…"}</div><div className="text-xs text-amber-700">restants</div></div>
        </div>

        {error ? <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div> : null}
        {archived ? <div role="status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p>{archived.operationCount} ancienne(s) action(s) retirée(s) de cet appareil et sauvegardée(s) localement. La préparation et les autres appels sont conservés. Aucun enregistrement de la BDD n’a été supprimé.</p>
          <button type="button" onClick={() => void downloadArchive()} className="mt-3 rounded-xl border border-emerald-700 px-3 py-2 font-semibold">Télécharger la sauvegarde</button>
        </div> : null}

        {unresolved.length > 0 ? (
          <div className="mt-5 space-y-3">
            {unresolved.map((row) => (
              <div key={row.operationId} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
                {isCallType(row.operationType) ? <label className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" disabled={busy} checked={selectedIds.includes(row.operationId)} onChange={(event) => {
                    setSelectedIds((ids) => event.target.checked ? [...ids, row.operationId] : ids.filter((id) => id !== row.operationId));
                    setArchivePreview(null); setArchiveConfirmed(false);
                  }} />
                  Sélectionner cette ancienne action
                </label> : null}
                <div className="font-semibold">{row.operationType}</div>
                <div className="mt-1">Enregistrée sur l’appareil : {localDate(row.createdAt)}</div>
                <div className="mt-1 break-all">{row.operationId}</div>
                <div className="mt-1 break-all">Local : {row.localSession || "non trouvé"}</div>
                <div className="mt-1 break-all">Cloud lié : {row.resolvedSession || "NON — mapping local perdu"}</div>
                <div className="mt-1">Preuve : {row.result?.reason || (isCallType(row.operationType) ? "non vérifiée" : "action hors appel — conservée pour vérification")}</div>
                <div className="mt-1">État local : {row.state}{row.lastStatus ? ` / HTTP ${row.lastStatus}` : ""}{row.lastError ? ` / ${row.lastError}` : ""}</div>
              </div>
            ))}
          </div>
        ) : null}
        {unresolved.some((row) => isCallType(row.operationType)) ? <div className="mt-5 rounded-2xl border border-slate-300 p-4 text-sm">
          <h2 className="font-semibold">Retirer d’anciennes actions de cet appareil</h2>
          <p className="mt-2">Cochez uniquement les anciens essais ou actions à abandonner. Les actions liées à la même séance seront regroupées avant validation. Fermez les autres fenêtres Mon Cahier sur cet appareil.</p>
          <p className="mt-2">Un appel réel qui n’a pas été envoyé doit rester dans la file. Retirer une action ne confirme pas sa réception par l’administration.</p>
          <button type="button" disabled={busy || !selectedIds.length} onClick={() => void reviewArchive()} className="mt-3 rounded-xl border border-slate-400 px-3 py-2 font-semibold disabled:opacity-50">Vérifier la sélection ({selectedIds.length})</button>
          {archivePreview ? <div className="mt-4 border-t border-slate-200 pt-4">
            <p className="font-semibold">{archivePreview.operationIds.length} action(s) de ces séances seront archivées sur cet appareil, dont {archivePreview.outboxCount} dans la file d’envoi.</p>
            <ul className="mt-2 space-y-2 text-xs">{archivePreview.actions.map((action) => <li key={action.operationId} className="break-all">{localDate(action.createdAt)} · {action.type} · {action.sessionReference || action.operationId}</li>)}</ul>
            <label className="mt-4 flex items-start gap-2"><input type="checkbox" disabled={busy} checked={archiveConfirmed} onChange={(event) => setArchiveConfirmed(event.target.checked)} />Je confirme l’abandon de ces anciennes actions. Elles ne seront plus envoyées ; une sauvegarde locale sera conservée.</label>
            <button type="button" disabled={busy || !archiveConfirmed} onClick={() => void archive()} className="mt-3 rounded-xl bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-50">{archiving ? "Retrait en cours…" : "Retirer les anciennes actions sélectionnées"}</button>
          </div> : null}
        </div> : null}
        {diagnostic ? (
          <div className="mt-4">
            <button type="button" onClick={async () => {
              try { await navigator.clipboard.writeText(diagnostic); setCopyStatus("Diagnostic copié."); }
              catch { setCopyStatus("Copie indisponible. Le texte ci-dessous peut être sélectionné."); }
            }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">Copier le diagnostic</button>
            {copyStatus ? <p role="status" className="mt-2 text-sm">{copyStatus}</p> : null}
            <details className="mt-3 text-xs"><summary>Voir le texte du diagnostic</summary><pre className="mt-2 whitespace-pre-wrap break-all select-text">{diagnostic}</pre></details>
          </div>
        ) : null}

        <p className="mt-5 text-xs leading-5 text-slate-500">
          La vérification retire automatiquement une action uniquement après preuve Cloud. Le retrait manuel conserve une sauvegarde locale et ne vaut pas confirmation Cloud. Les caches de préparation ne sont pas effacés.
        </p>
        <Link href="/class" className="mt-5 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Retour aux appels</Link>
      </section>
    </main>
  );
}
