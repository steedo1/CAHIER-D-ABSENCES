"use client";

import {
  flushOutbox,
  listOfflineOutboxEntries,
  registerOfflineSessionReference,
  removeQueuedOfflineMutation,
  type OfflineOutboxEntry,
} from "@/lib/offline";

const CALL_OPERATION_TYPES = new Set([
  "session-start",
  "attendance",
  "session-end",
]);

const CALL_OPERATION_TYPE_LIST = [
  "session-start",
  "attendance",
  "session-end",
] as const;

type ClassItem = {
  id: string;
  label?: string | null;
  institution_id: string;
};

type RawOutboxRow = {
  id?: string;
  body?: any;
};

type ReconcileResult = {
  operation_id: string;
  operation_type: "session-start" | "attendance" | "session-end";
  acknowledged: boolean;
  session_id: string | null;
  reason: string;
};

export type ClassDeviceOutboxRepairSummary = {
  before: number;
  after: number;
  flushed: number;
  reconciled: number;
  blocked: number;
  last_error: string | null;
};

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function latestEntryError(entries: OfflineOutboxEntry[]) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const error = entries[index]?.lastError;
    if (error) return error;
  }
  return null;
}

async function readRawOutboxRows(ids: string[]) {
  const rows = new Map<string, RawOutboxRow>();
  if (typeof window === "undefined" || !("indexedDB" in window) || !ids.length) {
    return rows;
  }

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("moncahier_offline_v1");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  try {
    if (!db.objectStoreNames.contains("outbox")) return rows;
    const transaction = db.transaction(["outbox"], "readonly");
    const done = transactionDone(transaction);
    const store = transaction.objectStore("outbox");
    const values = await Promise.all(
      ids.map(async (id) => {
        const row = await requestToPromise<RawOutboxRow | undefined>(store.get(id));
        return [id, row || null] as const;
      }),
    );
    await done;
    for (const [id, row] of values) {
      if (row) rows.set(id, row);
    }
    return rows;
  } finally {
    db.close();
  }
}

function scopedToClass(entry: OfflineOutboxEntry, cls: ClassItem, classCount: number) {
  const metaClassId = String(entry.meta?.classId || "").trim();
  const metaInstitutionId = String(entry.meta?.institutionId || "").trim();
  if (metaClassId && metaClassId !== cls.id) return false;
  if (metaInstitutionId && metaInstitutionId !== cls.institution_id) return false;
  if (!metaClassId && classCount > 1) return false;
  return CALL_OPERATION_TYPES.has(String(entry.operationType || ""));
}

function sanitizedOperationBody(entry: OfflineOutboxEntry, raw: RawOutboxRow | undefined) {
  const body = raw?.body && typeof raw.body === "object" ? raw.body : {};
  if (entry.operationType === "attendance") {
    const marks = Array.isArray(body.marks)
      ? body.marks
          .map((mark: any) => ({
            student_id: String(mark?.student_id || "").trim(),
            status: String(mark?.status || "").trim(),
            minutes_late:
              Number.isFinite(Number(mark?.minutes_late))
                ? Number(mark.minutes_late)
                : null,
            reason:
              mark?.reason == null ? null : String(mark.reason).trim() || null,
            observed_at:
              mark?.observed_at == null ? null : String(mark.observed_at).trim() || null,
            late_observed_at:
              mark?.late_observed_at == null
                ? null
                : String(mark.late_observed_at).trim() || null,
          }))
          .filter((mark: any) => mark.student_id && mark.status)
      : [];
    return {
      session_id: String(body.session_id || "").trim() || null,
      captured_at_device:
        String(
          body.captured_at_device ||
            body.actual_call_at ||
            body.client_call_at ||
            body.call_at ||
            "",
        ).trim() || null,
      marks,
    };
  }

  if (entry.operationType === "session-end") {
    return {
      session_id: String(body.session_id || "").trim() || null,
      actual_end_at: String(body.actual_end_at || "").trim() || null,
    };
  }

  if (entry.operationType === "session-start") {
    return {
      class_id: String(body.class_id || "").trim() || null,
      subject_id: String(body.subject_id || "").trim() || null,
      period_id: String(body.period_id || "").trim() || null,
      started_at: String(body.started_at || "").trim() || null,
      actual_call_at: String(body.actual_call_at || "").trim() || null,
      expected_minutes:
        Number.isFinite(Number(body.expected_minutes))
          ? Number(body.expected_minutes)
          : null,
    };
  }

  return null;
}

async function fetchClassContext(): Promise<ClassItem[]> {
  const response = await fetch(
    "/api/class/my-classes?offline_contract=v5&sync_reconcile=1",
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok) return [];
  const payload = await response.json().catch(() => ({}));
  return (Array.isArray(payload?.items) ? payload.items : [])
    .map((item: any) => ({
      id: String(item?.id || "").trim(),
      label: item?.label || null,
      institution_id: String(item?.institution_id || "").trim(),
    }))
    .filter((item: ClassItem) => item.id && item.institution_id);
}

async function reconcilePass(classes: ClassItem[]) {
  const allEntries = await listOfflineOutboxEntries();
  const callEntries = allEntries.filter((entry) =>
    CALL_OPERATION_TYPES.has(String(entry.operationType || "")),
  );
  if (!callEntries.length || !classes.length) return 0;

  const rawRows = await readRawOutboxRows(callEntries.map((entry) => entry.id));
  let removed = 0;

  for (const cls of classes) {
    const entries = callEntries.filter((entry) =>
      scopedToClass(entry, cls, classes.length),
    );
    if (!entries.length) continue;

    const response = await fetch("/api/class/sync/reconcile", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        class_id: cls.id,
        operations: entries.map((entry) => ({
          operation_id: entry.operationId,
          operation_type: entry.operationType,
          session_dependency_key: entry.sessionDependencyKey,
          created_at: entry.createdAt,
          last_status: entry.lastStatus,
          last_error: entry.lastError,
          operation_body: sanitizedOperationBody(entry, rawRows.get(entry.id)),
        })),
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) continue;
    const results = Array.isArray(payload?.results)
      ? (payload.results as ReconcileResult[])
      : [];
    const resultByOperation = new Map(
      results.map((result) => [result.operation_id, result]),
    );

    for (const entry of entries) {
      const result = resultByOperation.get(entry.operationId);
      if (!result?.acknowledged) continue;
      if (result.operation_type === "session-start" && result.session_id) {
        await registerOfflineSessionReference(
          `client:${result.operation_id}`,
          result.session_id,
        ).catch(() => undefined);
      }
      await removeQueuedOfflineMutation(entry.id);
      removed += 1;
    }
  }

  return removed;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export async function repairClassDeviceCallOutbox(): Promise<ClassDeviceOutboxRepairSummary> {
  const initial = (await listOfflineOutboxEntries()).filter((entry) =>
    CALL_OPERATION_TYPES.has(String(entry.operationType || "")),
  );
  const before = initial.length;
  if (!before || typeof navigator === "undefined" || !navigator.onLine) {
    return {
      before,
      after: before,
      flushed: 0,
      reconciled: 0,
      blocked: initial.filter((entry) => entry.state === "blocked").length,
      last_error: latestEntryError(initial),
    };
  }

  const classes = await fetchClassContext();
  let flushed = 0;
  let reconciled = 0;
  let lastError: string | null = null;

  for (let pass = 0; pass < 4; pass += 1) {
    const removedBeforeFlush = await reconcilePass(classes);
    reconciled += removedBeforeFlush;

    const flush = await flushOutbox({
      includeOperationTypes: CALL_OPERATION_TYPE_LIST,
      releaseNetworkBackoff: true,
      maxAcknowledgements: 60,
    });
    flushed += flush.flushed;
    lastError = flush.lastError || lastError;

    const removedAfterFlush = await reconcilePass(classes);
    reconciled += removedAfterFlush;

    const remaining = (await listOfflineOutboxEntries()).filter((entry) =>
      CALL_OPERATION_TYPES.has(String(entry.operationType || "")),
    );
    if (!remaining.length) break;

    const progress = removedBeforeFlush + flush.flushed + removedAfterFlush;
    if (progress <= 0) break;
    await sleep(200 * (pass + 1));
  }

  const finalEntries = (await listOfflineOutboxEntries()).filter((entry) =>
    CALL_OPERATION_TYPES.has(String(entry.operationType || "")),
  );

  return {
    before,
    after: finalEntries.length,
    flushed,
    reconciled,
    blocked: finalEntries.filter((entry) => entry.state === "blocked").length,
    last_error: latestEntryError(finalEntries) || lastError || null,
  };
}
