"use client";

import { useEffect, useState } from "react";
import {
  cacheGet,
  cacheSet,
  listOfflineOutboxEntries,
  removeQueuedOfflineMutation,
  resolveOfflineSessionReference,
  type OfflineOutboxEntry,
} from "@/lib/offline";

const SAFE_INSTITUTION_ID = "ee34ab2a-8033-4e0b-acf0-05979cce1697";
const SAFE_CLASS_ID = "9cf05b9b-985e-4801-ba97-9c9d3960fa03";
const SAFE_ORPHAN_CLIENT = "client:1cfeaa80-068a-49e0-ba3b-d8321fc26fec";
const SAFE_CLOUD_SESSIONS = new Set([
  "55739466-ed37-59c6-a00c-efbf65e2bd21",
  "ca9ff1d3-a056-53c8-a6a9-0fb7353af816",
  "3327a519-20f3-5f30-99d9-2d8977117840",
]);
const CALL_TYPES = new Set(["session-start", "attendance", "session-end"]);

function text(value: unknown) {
  return String(value ?? "").trim();
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

async function rawBodies(ids: string[]) {
  const result = new Map<string, Record<string, any>>();
  if (typeof window === "undefined" || !("indexedDB" in window) || !ids.length) return result;
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
      const row = await req<any>(store.get(id));
      if (row?.body && typeof row.body === "object") result.set(id, row.body);
    }
    await done;
    return result;
  } finally {
    db.close();
  }
}

function localCandidate(entry: OfflineOutboxEntry, body?: Record<string, any>) {
  if (entry.operationType === "session-start") return `client:${entry.operationId}`;
  return (
    text(body?.session_id) ||
    text(body?.client_session_id) ||
    text(entry.meta?.clientSessionId) ||
    text(entry.sessionDependencyKey) ||
    ""
  );
}

async function resolvedCandidate(candidate: string) {
  if (!candidate) return null;
  if (isUuid(candidate)) return candidate;
  const normalized = candidate.startsWith("client:") ? candidate : `client:${candidate}`;
  return (await resolveOfflineSessionReference(normalized)).serverSessionId;
}

async function purgeDurableOperationIds(operationIds: Set<string>) {
  if (!operationIds.size) return;
  const keys = [
    `teacher:attendance-delivery:v1:${SAFE_INSTITUTION_ID}`,
    `teacher:session-delivery:v1:${SAFE_INSTITUTION_ID}`,
    `teacher:session-lifecycle:v1:${SAFE_INSTITUTION_ID}`,
  ];
  for (const key of keys) {
    const stored = await cacheGet<any[]>(key);
    if (!Array.isArray(stored)) continue;
    const next = stored.filter((record) => !operationIds.has(text(record?.operation_id)));
    if (next.length !== stored.length) await cacheSet(key, next);
  }
}

export default function RecoverSyncTestCleanupPage() {
  const [status, setStatus] = useState("Vérification du téléphone de classe…");
  const [before, setBefore] = useState<number | null>(null);
  const [removed, setRemoved] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [remainingIds, setRemainingIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          "/api/class/my-classes?offline_contract=v5&test_cleanup=2",
          { credentials: "include", cache: "no-store" },
        );
        if (!response.ok) throw new Error(`Contexte classe indisponible (${response.status}).`);
        const payload = await response.json();
        const authorized = (Array.isArray(payload?.items) ? payload.items : []).some(
          (item: any) =>
            text(item?.id) === SAFE_CLASS_ID &&
            text(item?.institution_id) === SAFE_INSTITUTION_ID,
        );
        if (!authorized) throw new Error("Ce nettoyage est réservé au téléphone de test 6e1 du CSCA.");

        const entries = (await listOfflineOutboxEntries()).filter((entry) =>
          CALL_TYPES.has(text(entry.operationType)),
        );
        if (cancelled) return;
        setBefore(entries.length);
        const bodies = await rawBodies(entries.map((entry) => entry.id));
        const removable: OfflineOutboxEntry[] = [];

        for (const entry of entries) {
          const candidate = localCandidate(entry, bodies.get(entry.id));
          const resolved = await resolvedCandidate(candidate).catch(() => null);
          const safeOrphan = candidate === SAFE_ORPHAN_CLIENT;
          const safeCloudDuplicate = Boolean(resolved && SAFE_CLOUD_SESSIONS.has(resolved));

          // Important: pour ces résidus historiques déjà identifiés, les anciennes métadonnées
          // classId/institutionId peuvent être absentes ou erronées. On ne les utilise donc plus
          // comme motif de rejet. La sécurité repose ici sur l'authentification du téléphone 6e1
          // ET sur les identifiants locaux/Cloud explicitement whitelistés ci-dessus.
          if (safeOrphan || safeCloudDuplicate) removable.push(entry);
        }

        const operationIds = new Set(removable.map((entry) => entry.operationId));
        for (const entry of removable) await removeQueuedOfflineMutation(entry.id);
        await purgeDurableOperationIds(operationIds);

        const finalEntries = (await listOfflineOutboxEntries()).filter((entry) =>
          CALL_TYPES.has(text(entry.operationType)),
        );
        if (cancelled) return;
        setRemoved(removable.length);
        setRemaining(finalEntries.length);
        setRemainingIds(finalEntries.map((entry) => `${entry.operationType}: ${entry.operationId}`));
        setStatus(
          finalEntries.length === 0
            ? `${removable.length} résidu(s) de test identifiés ont été retirés de ce téléphone.`
            : `${removable.length} résidu(s) de test retirés. ${finalEntries.length} autre(s) opération(s) restent protégées.`,
        );
      } catch (cause: any) {
        if (cancelled) return;
        setError(text(cause?.message) || "Nettoyage interrompu.");
        setStatus("Aucune donnée n’a été supprimée en dehors du périmètre de test autorisé.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <section className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Nettoyage ciblé des résidus de test</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{status}</p>
        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-2xl bg-slate-100 p-3"><div className="text-2xl font-bold">{before ?? "…"}</div><div className="text-xs text-slate-600">avant</div></div>
          <div className="rounded-2xl bg-emerald-50 p-3"><div className="text-2xl font-bold text-emerald-700">{removed}</div><div className="text-xs text-emerald-700">retirés</div></div>
          <div className="rounded-2xl bg-amber-50 p-3"><div className="text-2xl font-bold text-amber-700">{remaining ?? "…"}</div><div className="text-xs text-amber-700">restants</div></div>
        </div>
        {error ? <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div> : null}
        {remainingIds.length > 0 ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950">
            <div className="font-semibold">Opérations encore présentes</div>
            {remainingIds.map((item) => <div key={item} className="mt-1 break-all">{item}</div>)}
          </div>
        ) : null}
        <p className="mt-5 text-xs leading-5 text-slate-500">
          Ce nettoyage reste limité aux trois séances Cloud de test déjà vérifiées et à l’essai local dont la séance Cloud n’a jamais été créée. Il ne vide pas IndexedDB et ne touche pas aux autres opérations.
        </p>
        <a href="/class" className="mt-5 inline-flex rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Retour aux appels</a>
      </section>
    </main>
  );
}
