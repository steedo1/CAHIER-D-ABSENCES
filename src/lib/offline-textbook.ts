"use client";

import {
  cacheGet,
  cacheSet,
  offlineGetJson,
  offlineMutateJson,
  type MutateResult,
} from "@/lib/offline";

export const TEXTBOOK_BOOTSTRAP_KEY = "textbook:bootstrap";

export type TextbookSessionPayload = {
  assignment_id: string;
  item_id: string;
  session_title: string;
  session_date: string;
  session_period_id?: string | null;
  session_period_label?: string | null;
  session_start_time?: string | null;
  session_end_time?: string | null;
  duration_minutes: number;
  content: string;
  homework?: string | null;
  observations?: string | null;
};

export type TextbookLessonStatusPayload = {
  assignment_id: string;
  item_id: string;
  status: "completed" | "reopened";
  note?: string | null;
};

export type TextbookLocalMutation<TBootstrap = any> = {
  mutation: MutateResult<any>;
  bootstrap: TBootstrap | null;
};

function part(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return normalized ? encodeURIComponent(normalized) : "none";
}

export function textbookSlotsKey(classId: string) {
  return `textbook:slots:${part(classId)}`;
}

export async function getTextbookBootstrap<T = any>(): Promise<T> {
  return await offlineGetJson<T>(
    "/api/teacher/textbook/bootstrap",
    TEXTBOOK_BOOTSTRAP_KEY,
  );
}

export async function getCachedTextbookBootstrap<T = any>(): Promise<T | null> {
  return await cacheGet<T>(TEXTBOOK_BOOTSTRAP_KEY);
}

export async function getTextbookSlots<T = any>(classId: string): Promise<T> {
  const url = `/api/institution/slots?class_id=${encodeURIComponent(classId)}`;
  return await offlineGetJson<T>(url, textbookSlotsKey(classId));
}

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

function updateBootstrapItem(
  bootstrap: any,
  assignmentId: string,
  itemId: string,
  updater: (item: any) => any,
) {
  if (!bootstrap || !Array.isArray(bootstrap.items)) return bootstrap;
  return {
    ...bootstrap,
    items: bootstrap.items.map((assignment: any) => {
      if (String(assignment?.id || "") !== assignmentId) return assignment;
      return {
        ...assignment,
        progression_items: Array.isArray(assignment?.progression_items)
          ? assignment.progression_items.map((item: any) =>
              String(item?.id || "") === itemId ? updater(item) : item,
            )
          : assignment?.progression_items,
      };
    }),
    local_updated_at: new Date().toISOString(),
  };
}

async function applySessionToLocalCache(
  payload: TextbookSessionPayload,
  clientSessionId: string,
  serverItem?: any,
) {
  const cached = await getCachedTextbookBootstrap<any>();
  if (!cached) return null;

  const localSession = serverItem || {
    id: `client:${clientSessionId}`,
    ...payload,
    client_session_id: clientSessionId,
    local_pending: true,
  };

  const next = updateBootstrapItem(
    cached,
    payload.assignment_id,
    payload.item_id,
    (item) => {
      const sessions = (Array.isArray(item?.sessions) ? item.sessions : []).filter(
        (session: any) =>
          String(session?.id || "") !== String(localSession.id || "") &&
          String(session?.client_session_id || "") !== clientSessionId,
      );
      return {
        ...item,
        sessions: [localSession, ...sessions],
        completion:
          item?.completion?.status === "completed"
            ? item.completion
            : {
                ...(item?.completion || {}),
                id: item?.completion?.id || `client:${payload.assignment_id}:${payload.item_id}`,
                status: "in_progress",
                completed_at: null,
                local_pending: !serverItem,
              },
      };
    },
  );
  await cacheSet(TEXTBOOK_BOOTSTRAP_KEY, next);
  return next;
}

async function applyStatusToLocalCache(
  payload: TextbookLessonStatusPayload,
  serverItem?: any,
) {
  const cached = await getCachedTextbookBootstrap<any>();
  if (!cached) return null;

  const completedAt =
    payload.status === "completed" ? new Date().toISOString() : null;
  const next = updateBootstrapItem(
    cached,
    payload.assignment_id,
    payload.item_id,
    (item) => ({
      ...item,
      completion: serverItem || {
        ...(item?.completion || {}),
        id: item?.completion?.id || `client:${payload.assignment_id}:${payload.item_id}`,
        status: payload.status,
        completed_at: completedAt,
        local_pending: true,
      },
    }),
  );
  await cacheSet(TEXTBOOK_BOOTSTRAP_KEY, next);
  return next;
}

/**
 * Sauvegarde une séance sur le serveur ou dans l'outbox, puis reflète aussitôt
 * la saisie dans le bootstrap local. L'UUID client sert aussi de clé serveur :
 * un rejeu après une réponse réseau perdue ne peut donc pas créer de doublon.
 */
export async function saveTextbookSession<TBootstrap = any>(
  payload: TextbookSessionPayload,
): Promise<TextbookLocalMutation<TBootstrap>> {
  const clientSessionId = randomUuid();
  const mutation = await offlineMutateJson(
    "/api/teacher/textbook/sessions",
    {
      method: "POST",
      body: { ...payload, client_session_id: clientSessionId },
    },
    {
      operationId: `textbook-session:${clientSessionId}`,
      meta: {
        operationType: "textbook-session",
        assignmentId: payload.assignment_id,
        itemId: payload.item_id,
        clientSessionId,
      },
    },
  );

  let bootstrap = (await getCachedTextbookBootstrap<TBootstrap>()) as TBootstrap | null;
  if (mutation.ok || mutation.queued) {
    bootstrap = (await applySessionToLocalCache(
      payload,
      clientSessionId,
      mutation.ok ? mutation.data?.item : null,
    )) as TBootstrap | null;
  }

  return { mutation, bootstrap };
}

/**
 * Conserve uniquement le dernier état demandé pour une leçon. Une succession
 * hors ligne « terminer puis rouvrir » rejouera donc l'état final attendu.
 */
export async function saveTextbookLessonStatus<TBootstrap = any>(
  payload: TextbookLessonStatusPayload,
): Promise<TextbookLocalMutation<TBootstrap>> {
  const mutation = await offlineMutateJson(
    "/api/teacher/textbook/lesson-status",
    { method: "POST", body: payload },
    {
      mergeKey: `textbook-status:${part(payload.assignment_id)}:${part(payload.item_id)}`,
      meta: {
        operationType: "textbook-lesson-status",
        assignmentId: payload.assignment_id,
        itemId: payload.item_id,
      },
    },
  );

  let bootstrap = (await getCachedTextbookBootstrap<TBootstrap>()) as TBootstrap | null;
  if (mutation.ok || mutation.queued) {
    bootstrap = (await applyStatusToLocalCache(
      payload,
      mutation.ok ? mutation.data?.item : null,
    )) as TBootstrap | null;
  }

  return { mutation, bootstrap };
}
