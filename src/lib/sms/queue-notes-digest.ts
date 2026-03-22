// src/lib/sms/queue-notes-digest.ts

import type { SupabaseClient } from "@supabase/supabase-js";
import { triggerSmsDispatch } from "@/lib/sms-dispatch";

export type NotesDigestQueueItem = {
  subject: string;
  score: number | string;
  scale?: number | string | null;
};

export async function enqueueNotesDigestSms(opts: {
  srv: SupabaseClient;
  req?: Request;
  institutionId: string;
  studentId: string;
  studentName: string;
  classId?: string | null;
  classLabel?: string | null;
  institutionName?: string | null;
  periodLabel?: string | null;
  average?: number | string | null;
  items: NotesDigestQueueItem[];
  profileId?: string | null;
  parentId?: string | null;
  dispatch?: boolean;
}) {
  const {
    srv,
    req,
    institutionId,
    studentId,
    studentName,
    classId,
    classLabel,
    institutionName,
    periodLabel,
    average,
    items,
    profileId,
    parentId,
    dispatch = true,
  } = opts;

  if (!institutionId) throw new Error("institutionId manquant.");
  if (!studentId) throw new Error("studentId manquant.");
  if (!studentName?.trim()) throw new Error("studentName manquant.");
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Aucune note Ã  envoyer.");
  }

  const payload = {
    kind: "notes_digest",
    event: "notes_digest",
    student: {
      id: studentId,
      name: studentName,
    },
    class:
      classId || classLabel
        ? {
            id: classId || null,
            label: classLabel || null,
          }
        : null,
    institution: institutionName
      ? {
          id: institutionId,
          name: institutionName,
        }
      : {
          id: institutionId,
        },
    period_label: periodLabel || null,
    average: average ?? null,
    items: items.map((x) => ({
      subject: String(x.subject || "").trim(),
      score: x.score,
      scale: x.scale ?? 20,
    })),
  };

  const title = `Nouvelles notes - ${studentName}`;
  const body = items
    .map((x) => `${x.subject}: ${x.score}${x.scale ? `/${x.scale}` : ""}`)
    .join(", ");

  const { data, error } = await srv
    .from("notifications_queue")
    .insert({
      institution_id: institutionId,
      student_id: studentId,
      parent_id: parentId || null,
      profile_id: profileId || null,
      channels: ["sms"],
      title,
      body,
      payload,
      status: "pending",
      attempts: 0,
      meta: {
        source: "notes_digest",
      },
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(
      `Insertion notifications_queue impossible: ${error.message}`
    );
  }

  if (dispatch) {
    await triggerSmsDispatch({
      req,
      reason: "notes_digest",
      timeoutMs: 5000,
      retries: 2,
    });
  }

  return data;
}