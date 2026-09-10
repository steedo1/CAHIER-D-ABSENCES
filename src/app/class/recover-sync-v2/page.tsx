"use client";

import { useEffect, useMemo, useState } from "react";
import {
  listOfflineOutboxEntries,
  registerOfflineSessionReference,
  removeQueuedOfflineMutation,
  resolveOfflineSessionReference,
  type OfflineOutboxEntry,
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

  const unresolved = useMemo(
    () => rows.filter((row) => !row.result?.acknowledged),
    [rows],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const classResponse = await fetch(
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

        const initial = (await listOfflineOutboxEntries()).filter((entry) =>
          isCallType(entry.operationType),
        );
        if (cancelled) return;
        setBefore(initial.length);
        if (!initial.length) {
          setRemaining(0);
          setStatus("Aucun résidu d’appel à réconcilier.");
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
            const response = await fetch("/api/class/sync/reconcile-v2", {
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

        const finalEntries = (await listOfflineOutboxEntries()).filter((entry) =>
          isCallType(entry.operationType),
        );
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
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <section className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Récupération Sync — liaison locale/Cloud</h1>
        <p className="mt-2 text-sm text-slate-600">{status}</p>

        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-2xl bg-slate-100 p-3"><div className="text-2xl font-bold">{before ?? "…"}</div><div className="text-xs text-slate-600">avant</div></div>
          <div className="rounded-2xl bg-emerald-50 p-3"><div className="text-2xl font-bold text-emerald-700">{removed}</div><div className="text-xs text-emerald-700">confirmés</div></div>
          <div className="rounded-2xl bg-amber-50 p-3"><div className="text-2xl font-bold text-amber-700">{remaining ?? "…"}</div><div className="text-xs text-amber-700">restants</div></div>
        </div>

        {error ? <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div> : null}

        {unresolved.length > 0 ? (
          <div className="mt-5 space-y-3">
            {unresolved.map((row) => (
              <div key={row.operationId} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
                <div className="font-semibold">{row.operationType}</div>
                <div className="mt-1 break-all">{row.operationId}</div>
                <div className="mt-1 break-all">Local : {row.localSession || "non trouvé"}</div>
                <div className="mt-1 break-all">Cloud lié : {row.resolvedSession || "NON — mapping local perdu"}</div>
                <div className="mt-1">Preuve : {row.result?.reason || "non vérifiée"}</div>
                <div className="mt-1">État local : {row.state}{row.lastStatus ? ` / HTTP ${row.lastStatus}` : ""}{row.lastError ? ` / ${row.lastError}` : ""}</div>
              </div>
            ))}
          </div>
        ) : null}

        <p className="mt-5 text-xs leading-5 text-slate-500">
          Cette récupération ne vide pas IndexedDB. Elle retire uniquement une opération après preuve Cloud, puis met son journal durable en état terminal.
        </p>
        <a href="/class" className="mt-5 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Retour aux appels</a>
      </section>
    </main>
  );
}
