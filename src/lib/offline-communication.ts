"use client";

import {
  cacheGet,
  cacheSet,
  offlineGetJson,
  offlineMutateJson,
  type MutateResult,
} from "@/lib/offline";

export const COMMUNICATION_META_KEY = "admin:communication:meta";
export const COMMUNICATION_HISTORY_KEY = "admin:communication:history";

export type CommunicationOfflinePayload = {
  audience_type: "parents" | "staff";
  target_type: string;
  target_value: string | null;
  target_label?: string | null;
  education_type?: string | null;
  formation_code?: string | null;
  formation_level_code?: string | null;
  class_id?: string | null;
  channel: "push" | "sms" | "push_sms";
  title: string;
  body: string;
  sender_name?: string | null;
};

function randomUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

export async function getCommunicationMeta<T = any>(): Promise<T> {
  return await offlineGetJson<T>(
    "/api/admin/communication/meta",
    COMMUNICATION_META_KEY,
  );
}

export async function getCommunicationHistory<T = any>(): Promise<T> {
  return await offlineGetJson<T>(
    "/api/admin/communication/campaigns",
    COMMUNICATION_HISTORY_KEY,
  );
}

async function addCommunicationToLocalHistory(
  payload: CommunicationOfflinePayload,
  clientOperationId: string,
  mutation: MutateResult<any>,
) {
  const cached = await cacheGet<any>(COMMUNICATION_HISTORY_KEY);
  const items = Array.isArray(cached?.items) ? cached.items : [];
  const sender = String(payload.sender_name || "Mon Cahier").trim();
  const signedBody = payload.body.trim().endsWith(sender)
    ? payload.body.trim()
    : `${payload.body.trim()}\n\n— ${sender}`;
  const campaignId = mutation.ok
    ? String(mutation.data?.campaign_id || clientOperationId)
    : `client:${clientOperationId}`;
  const localItem = {
    id: campaignId,
    client_operation_id: clientOperationId,
    audience_type: payload.audience_type,
    target_type: payload.target_type,
    target_value: payload.target_value,
    target_label:
      mutation.ok
        ? mutation.data?.target_label || payload.target_label || payload.target_type
        : payload.target_label || payload.target_type,
    channel: payload.channel,
    title: payload.title,
    body: signedBody,
    status: mutation.ok ? "queued" : "local_pending",
    recipient_count: mutation.ok
      ? Number(mutation.data?.summary?.recipient_count || 0)
      : 0,
    push_queued_count: mutation.ok
      ? Number(mutation.data?.queued?.push || 0)
      : 0,
    sms_queued_count: mutation.ok ? Number(mutation.data?.queued?.sms || 0) : 0,
    created_at: new Date().toISOString(),
    sent_at: mutation.ok ? new Date().toISOString() : null,
    local_pending: !mutation.ok,
  };
  const next = {
    ...(cached && typeof cached === "object" ? cached : {}),
    ok: true,
    items: [
      localItem,
      ...items.filter(
        (item: any) =>
          String(item?.id || "") !== campaignId &&
          String(item?.client_operation_id || "") !== clientOperationId,
      ),
    ],
    local_updated_at: new Date().toISOString(),
  };
  await cacheSet(COMMUNICATION_HISTORY_KEY, next);
  return next;
}

export async function saveCommunication(
  payload: CommunicationOfflinePayload,
): Promise<{ mutation: MutateResult<any>; history: any | null }> {
  const clientOperationId = randomUuid();
  const mutation = await offlineMutateJson(
    "/api/admin/communication/send",
    {
      method: "POST",
      body: { ...payload, client_operation_id: clientOperationId },
    },
    {
      operationId: `communication:${clientOperationId}`,
      meta: {
        operationType: "communication-send",
        clientOperationId,
      },
    },
  );

  const history =
    mutation.ok || mutation.queued
      ? await addCommunicationToLocalHistory(
          payload,
          clientOperationId,
          mutation,
        )
      : await cacheGet(COMMUNICATION_HISTORY_KEY);

  return { mutation, history };
}
