"use client";

import {
  flushOutbox,
  listOfflineOutboxEntries,
  registerOfflineSessionReference,
  removeQueuedOfflineMutation,
  type FlushedMutationAcknowledgement,
  type OfflineOutboxEntry,
} from "@/lib/offline";
import {
  listTeacherAttendanceOperations,
  markTeacherAttendanceSyncedInCloud,
  type TeacherAttendanceDeliveryRecord,
} from "@/lib/teacher-attendance-delivery";
import {
  listTeacherSessionOpenOperations,
  markTeacherSessionOpenedInCloud,
  type TeacherSessionDeliveryRecord,
} from "@/lib/teacher-session-delivery";
import {
  listTeacherSessionLifecycleOperations,
  markTeacherSessionClosedInCloud,
  type TeacherSessionLifecycleDeliveryRecord,
} from "@/lib/teacher-session-lifecycle-delivery";

type OperationType = "session-start" | "attendance" | "session-end";
type ClassItem = { id: string; label?: string | null; institution_id: string };
type RawOutboxRow = { id?: string; body?: any };
type ReconcileOperation = {
  operationId: string;
  operationType: OperationType;
  dependencyKey: string;
  body: Record<string, any>;
  outboxIds: string[];
};
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

export type ClassDeviceSyncRepairV2Summary = {
  before: number;
  after: number;
  flushed: number;
  reconciled: number;
  blocked: number;
  last_error: string | null;
};

const CALL_TYPES = new Set<OperationType>([
  "session-start",
  "attendance",
  "session-end",
]);
const CALL_TYPE_LIST = ["session-start", "attendance", "session-end"] as const;

function text(value: unknown) {
  return String(value ?? "").trim();
}
function isCallType(value: unknown): value is OperationType {
  return CALL_TYPES.has(text(value) as OperationType);
}
function terminalAttendance(record: TeacherAttendanceDeliveryRecord) {
  return record.state === "cloud_synced" ||
    record.state === "relay_secured" ||
    record.state === "superseded";
}
function terminalOpen(record: TeacherSessionDeliveryRecord) {
  return record.state === "cloud_opened" || record.state === "relay_opened";
}
function terminalClose(record: TeacherSessionLifecycleDeliveryRecord) {
  return record.state === "cloud_confirmed" || record.state === "relay_confirmed";
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
async function rawOutboxRows(ids: string[]) {
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

async function fetchClasses(): Promise<ClassItem[]> {
  const response = await fetch(
    "/api/class/my-classes?offline_contract=v5&sync_reconcile=2",
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok) return [];
  const payload = await response.json().catch(() => ({}));
  return (Array.isArray(payload?.items) ? payload.items : [])
    .map((item: any) => ({
      id: text(item?.id),
      label: item?.label || null,
      institution_id: text(item?.institution_id),
    }))
    .filter((item: ClassItem) => item.id && item.institution_id);
}

function scopedOutbox(entry: OfflineOutboxEntry, cls: ClassItem, classCount: number) {
  if (!isCallType(entry.operationType)) return false;
  const classId = text(entry.meta?.classId);
  const institutionId = text(entry.meta?.institutionId);
  if (classId && classId !== cls.id) return false;
  if (institutionId && institutionId !== cls.institution_id) return false;
  return Boolean(classId || institutionId || classCount === 1);
}

function outboxBody(entry: OfflineOutboxEntry, raw: RawOutboxRow | undefined) {
  const body = raw?.body && typeof raw.body === "object" ? raw.body : {};
  if (entry.operationType === "attendance") {
    return {
      session_id: text(body.session_id) || null,
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
      session_id: text(body.session_id) || null,
      actual_end_at: text(body.actual_end_at) || null,
    };
  }
  return {
    class_id: text(body.class_id) || null,
    subject_id: text(body.subject_id) || null,
    period_id: text(body.period_id) || null,
    actual_call_at: text(body.actual_call_at) || null,
  };
}

function durableAttendanceBody(record: TeacherAttendanceDeliveryRecord) {
  return {
    session_id: record.session_id || record.session_reference,
    captured_at_device: record.captured_at_device || null,
    marks: record.marks.map((mark) => ({
      student_id: mark.student_id,
      status: mark.status,
      reason: mark.comment,
      observed_at: mark.observed_at,
    })),
  };
}
function durableOpenBody(record: TeacherSessionDeliveryRecord) {
  return {
    class_id: record.class_id,
    subject_id: record.subject_id,
    period_id: record.period_id,
    actual_call_at: record.actual_call_at,
  };
}
function durableCloseBody(record: TeacherSessionLifecycleDeliveryRecord) {
  return {
    session_id: record.session_id,
    device_requested_at: record.device_requested_at,
  };
}

function upsertOperation(
  map: Map<string, ReconcileOperation>,
  value: ReconcileOperation,
  preferBody = false,
) {
  const existing = map.get(value.operationId);
  if (!existing) {
    map.set(value.operationId, value);
    return;
  }
  existing.outboxIds = Array.from(new Set([...existing.outboxIds, ...value.outboxIds]));
  if (preferBody || Object.keys(existing.body).length === 0) existing.body = value.body;
  if (!existing.dependencyKey && value.dependencyKey) existing.dependencyKey = value.dependencyKey;
}

async function classOperations(
  cls: ClassItem,
  classes: ClassItem[],
  outbox: OfflineOutboxEntry[],
  rawRows: Map<string, RawOutboxRow>,
) {
  const [opens, attendance, lifecycle] = await Promise.all([
    listTeacherSessionOpenOperations(cls.institution_id),
    listTeacherAttendanceOperations(cls.institution_id),
    listTeacherSessionLifecycleOperations(cls.institution_id),
  ]);
  const map = new Map<string, ReconcileOperation>();

  for (const record of opens) {
    if (record.class_id !== cls.id || terminalOpen(record)) continue;
    upsertOperation(map, {
      operationId: record.operation_id,
      operationType: "session-start",
      dependencyKey: `client:${record.operation_id}`,
      body: durableOpenBody(record),
      outboxIds: [],
    });
  }
  for (const record of attendance) {
    if (record.class_id !== cls.id || terminalAttendance(record)) continue;
    upsertOperation(map, {
      operationId: record.operation_id,
      operationType: "attendance",
      dependencyKey: record.session_reference || record.session_id,
      body: durableAttendanceBody(record),
      outboxIds: [],
    });
  }
  for (const record of lifecycle) {
    if (
      record.kind !== "close" ||
      terminalClose(record) ||
      (record.class_id && record.class_id !== cls.id)
    ) continue;
    const belongs = record.class_id === cls.id || attendance.some((item) =>
      item.class_id === cls.id &&
      (item.session_id === record.session_id || item.session_reference === record.session_id),
    );
    if (!belongs) continue;
    upsertOperation(map, {
      operationId: record.operation_id,
      operationType: "session-end",
      dependencyKey: record.session_id || "",
      body: durableCloseBody(record),
      outboxIds: [],
    });
  }

  for (const entry of outbox) {
    if (!scopedOutbox(entry, cls, classes.length) || !isCallType(entry.operationType)) continue;
    upsertOperation(map, {
      operationId: entry.operationId,
      operationType: entry.operationType,
      dependencyKey: entry.sessionDependencyKey || "",
      body: outboxBody(entry, rawRows.get(entry.id)),
      outboxIds: [entry.id],
    }, true);
  }
  return Array.from(map.values());
}

async function terminalizeResult(cls: ClassItem, result: ReconcileResult) {
  if (!result.acknowledged || !result.session_id) return;
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
}

async function reconcileClass(
  cls: ClassItem,
  classes: ClassItem[],
  outbox: OfflineOutboxEntry[],
  rawRows: Map<string, RawOutboxRow>,
) {
  const operations = await classOperations(cls, classes, outbox, rawRows);
  if (!operations.length) return 0;
  const response = await fetch("/api/class/sync/reconcile-v2", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      class_id: cls.id,
      operations: operations.map((operation) => ({
        operation_id: operation.operationId,
        operation_type: operation.operationType,
        session_dependency_key: operation.dependencyKey,
        operation_body: operation.body,
      })),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) return 0;
  const results = Array.isArray(payload?.results)
    ? (payload.results as ReconcileResult[])
    : [];
  const byId = new Map(operations.map((operation) => [operation.operationId, operation]));
  let resolved = 0;
  for (const result of results) {
    if (!result.acknowledged) continue;
    const operation = byId.get(result.operation_id);
    if (!operation) continue;
    await terminalizeResult(cls, result);
    for (const outboxId of operation.outboxIds) {
      await removeQueuedOfflineMutation(outboxId);
    }
    resolved += 1;
  }
  return resolved;
}

async function applyFlushAcks(classes: ClassItem[], acks: FlushedMutationAcknowledgement[]) {
  let marked = 0;
  for (const ack of acks) {
    if (!isCallType(ack.operationType)) continue;
    const cls = classes.find((candidate) =>
      candidate.id === ack.classId || candidate.institution_id === ack.institutionId,
    );
    if (!cls) continue;
    if (ack.operationType === "session-start" && ack.sessionId) {
      await registerOfflineSessionReference(
        `client:${ack.operationId}`,
        ack.sessionId,
      ).catch(() => undefined);
      await markTeacherSessionOpenedInCloud({
        institutionId: cls.institution_id,
        operationId: ack.operationId,
        sessionId: ack.sessionId,
      });
      marked += 1;
    } else if (ack.operationType === "attendance") {
      await markTeacherAttendanceSyncedInCloud({
        institutionId: cls.institution_id,
        operationId: ack.operationId,
        sessionId: ack.sessionId,
        status: ack.status,
      });
      marked += 1;
    } else if (ack.operationType === "session-end") {
      await markTeacherSessionClosedInCloud({
        institutionId: cls.institution_id,
        operationId: ack.operationId,
        status: ack.status,
      });
      marked += 1;
    }
  }
  return marked;
}

async function unresolvedAttendanceDependencies(classes: ClassItem[]) {
  const keys = new Set<string>();
  for (const cls of classes) {
    const records = await listTeacherAttendanceOperations(cls.institution_id);
    for (const record of records) {
      if (record.class_id !== cls.id || terminalAttendance(record)) continue;
      if (record.session_reference) keys.add(record.session_reference);
      if (record.session_id) keys.add(record.session_id);
    }
  }
  return Array.from(keys);
}

async function pendingLogicalCount(classes: ClassItem[]) {
  const outbox = (await listOfflineOutboxEntries()).filter((entry) =>
    isCallType(entry.operationType),
  );
  const ids = new Set(outbox.map((entry) => entry.operationId));
  for (const cls of classes) {
    const [opens, attendance, lifecycle] = await Promise.all([
      listTeacherSessionOpenOperations(cls.institution_id),
      listTeacherAttendanceOperations(cls.institution_id),
      listTeacherSessionLifecycleOperations(cls.institution_id),
    ]);
    for (const record of opens) {
      if (record.class_id === cls.id && !terminalOpen(record)) ids.add(record.operation_id);
    }
    for (const record of attendance) {
      if (record.class_id === cls.id && !terminalAttendance(record)) ids.add(record.operation_id);
    }
    for (const record of lifecycle) {
      if (record.kind === "close" && !terminalClose(record) && record.class_id === cls.id) {
        ids.add(record.operation_id);
      }
    }
  }
  return ids.size;
}

function latestError(entries: OfflineOutboxEntry[]) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i]?.lastError) return entries[i]!.lastError;
  }
  return null;
}

export async function repairClassDeviceSyncV2(): Promise<ClassDeviceSyncRepairV2Summary> {
  const classes = await fetchClasses();
  const initialOutbox = await listOfflineOutboxEntries();
  const before = classes.length
    ? await pendingLogicalCount(classes)
    : initialOutbox.filter((entry) => isCallType(entry.operationType)).length;
  if (!classes.length || typeof navigator === "undefined" || !navigator.onLine) {
    return {
      before,
      after: before,
      flushed: 0,
      reconciled: 0,
      blocked: initialOutbox.filter((entry) => isCallType(entry.operationType) && entry.state === "blocked").length,
      last_error: latestError(initialOutbox),
    };
  }

  let flushed = 0;
  let reconciled = 0;
  let lastError: string | null = null;

  for (let pass = 0; pass < 4; pass += 1) {
    const outboxBefore = await listOfflineOutboxEntries();
    const rawRows = await rawOutboxRows(outboxBefore.map((entry) => entry.id));
    let passProgress = 0;
    for (const cls of classes) {
      const resolved = await reconcileClass(cls, classes, outboxBefore, rawRows);
      reconciled += resolved;
      passProgress += resolved;
    }

    const deferredEnds = await unresolvedAttendanceDependencies(classes);
    const flush = await flushOutbox({
      includeOperationTypes: CALL_TYPE_LIST,
      deferSessionEndKeys: deferredEnds,
      releaseNetworkBackoff: true,
      maxAcknowledgements: 100,
    });
    flushed += flush.flushed;
    passProgress += flush.flushed;
    lastError = flush.lastError || lastError;
    passProgress += await applyFlushAcks(classes, flush.acknowledged);

    const outboxAfter = await listOfflineOutboxEntries();
    const rawAfter = await rawOutboxRows(outboxAfter.map((entry) => entry.id));
    for (const cls of classes) {
      const resolved = await reconcileClass(cls, classes, outboxAfter, rawAfter);
      reconciled += resolved;
      passProgress += resolved;
    }

    if ((await pendingLogicalCount(classes)) === 0 || passProgress === 0) break;
  }

  const finalOutbox = await listOfflineOutboxEntries();
  const after = await pendingLogicalCount(classes);
  return {
    before,
    after,
    flushed,
    reconciled,
    blocked: finalOutbox.filter((entry) => isCallType(entry.operationType) && entry.state === "blocked").length,
    last_error: latestError(finalOutbox) || lastError,
  };
}
