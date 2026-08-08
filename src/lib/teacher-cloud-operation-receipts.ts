import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TeacherCloudOperationReceiptState =
  | "processing"
  | "retryable"
  | "acknowledged"
  | "blocked"
  | "conflict";

export type TeacherCloudOperationReceipt = {
  operation_id: string;
  institution_id: string;
  actor_user_id: string;
  operation_type: string;
  session_id: string | null;
  payload_fingerprint: string;
  state: TeacherCloudOperationReceiptState;
  error_code: string | null;
  response_json: Record<string, unknown>;
  received_at: string;
  processed_at: string | null;
  updated_at: string;
};

const PROCESSING_STALE_MS = 2 * 60 * 1000;

function text(value: unknown) {
  return String(value || "").trim();
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

export function validTeacherCloudOperationId(value: unknown) {
  const operationId = text(value);
  return /^[A-Za-z0-9][A-Za-z0-9:._-]{7,159}$/.test(operationId)
    ? operationId
    : null;
}

export function teacherCloudPayloadFingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function teacherCloudReceiptIsStale(
  receipt: Pick<TeacherCloudOperationReceipt, "state" | "updated_at">,
  now = new Date(),
) {
  if (receipt.state !== "processing") return false;
  const updatedAt = Date.parse(receipt.updated_at);
  return !Number.isFinite(updatedAt) || now.getTime() - updatedAt >= PROCESSING_STALE_MS;
}

export async function loadTeacherCloudOperationReceipt(
  service: SupabaseClient,
  operationId: string,
) {
  const { data, error } = await service
    .from("teacher_cloud_operation_receipts")
    .select(
      "operation_id,institution_id,actor_user_id,operation_type,session_id,payload_fingerprint,state,error_code,response_json,received_at,processed_at,updated_at",
    )
    .eq("operation_id", operationId)
    .maybeSingle();
  if (error) throw error;
  return data as TeacherCloudOperationReceipt | null;
}

export type ReserveTeacherCloudOperationResult =
  | { status: "reserved"; receipt: TeacherCloudOperationReceipt | null }
  | { status: "acknowledged"; receipt: TeacherCloudOperationReceipt }
  | { status: "processing"; receipt: TeacherCloudOperationReceipt }
  | { status: "conflict"; receipt: TeacherCloudOperationReceipt };

export async function reserveTeacherCloudOperationReceipt(
  service: SupabaseClient,
  input: {
    operationId: string;
    institutionId: string;
    actorUserId: string;
    operationType: string;
    sessionId?: string | null;
    payloadFingerprint: string;
    now?: Date;
  },
): Promise<ReserveTeacherCloudOperationResult> {
  const now = input.now || new Date();
  const nowIso = now.toISOString();
  const row = {
    operation_id: input.operationId,
    institution_id: input.institutionId,
    actor_user_id: input.actorUserId,
    operation_type: input.operationType,
    session_id: text(input.sessionId) || null,
    payload_fingerprint: input.payloadFingerprint,
    state: "processing",
    error_code: null,
    response_json: {},
    received_at: nowIso,
    processed_at: null,
    updated_at: nowIso,
  };
  const { error } = await service
    .from("teacher_cloud_operation_receipts")
    .insert(row);
  if (!error) return { status: "reserved", receipt: null };
  if ((error as { code?: string }).code !== "23505") throw error;

  const existing = await loadTeacherCloudOperationReceipt(service, input.operationId);
  if (!existing) throw new Error("teacher_cloud_receipt_collision_without_row");
  if (
    existing.institution_id !== input.institutionId ||
    existing.actor_user_id !== input.actorUserId ||
    existing.operation_type !== input.operationType ||
    existing.payload_fingerprint !== input.payloadFingerprint
  ) {
    return { status: "conflict", receipt: existing };
  }
  if (existing.state === "acknowledged") {
    return { status: "acknowledged", receipt: existing };
  }
  if (existing.state === "processing" && !teacherCloudReceiptIsStale(existing, now)) {
    return { status: "processing", receipt: existing };
  }

  const claimableState = existing.state;
  const { data: claimed, error: claimError } = await service
    .from("teacher_cloud_operation_receipts")
    .update({
      state: "processing",
      error_code: null,
      processed_at: null,
      updated_at: nowIso,
    })
    .eq("operation_id", input.operationId)
    .eq("state", claimableState)
    .select("operation_id")
    .maybeSingle();
  if (claimError) throw claimError;
  return claimed
    ? { status: "reserved", receipt: existing }
    : { status: "processing", receipt: existing };
}

export async function storeTeacherCloudOperationOutcome(
  service: SupabaseClient,
  input: {
    operationId: string;
    state: Exclude<TeacherCloudOperationReceiptState, "processing">;
    errorCode?: string | null;
    response?: Record<string, unknown> | null;
    now?: Date;
  },
) {
  const nowIso = (input.now || new Date()).toISOString();
  const { error } = await service
    .from("teacher_cloud_operation_receipts")
    .update({
      state: input.state,
      error_code: text(input.errorCode) || null,
      response_json: input.response || {},
      processed_at: input.state === "retryable" ? null : nowIso,
      updated_at: nowIso,
    })
    .eq("operation_id", input.operationId);
  if (error) throw error;
}
