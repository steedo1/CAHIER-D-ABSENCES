// src/lib/push/founder.ts
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { triggerPushDispatch } from "@/lib/push-dispatch";

const WAIT_STATUS = (process.env.PUSH_WAIT_STATUS || "pending").trim();

type FounderNotificationKind =
  | "founder_student_enrolled"
  | "founder_daily_summary";

type QueueFounderNotificationInput = {
  institutionId: string;
  kind: FounderNotificationKind;
  title: string;
  body: string;
  data?: Record<string, any>;
  req?: Request;
  dispatch?: boolean;
};

function compactString(value: unknown, fallback = "") {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s || fallback;
}

export async function queueFounderNotification({
  institutionId,
  kind,
  title,
  body,
  data = {},
  req,
  dispatch = true,
}: QueueFounderNotificationInput) {
  const srv = getSupabaseServiceClient();
  const inst = compactString(institutionId);

  if (!inst) {
    console.warn("[push/founder] institutionId manquant", { kind });
    return { ok: false as const, queued: 0, reason: "missing_institution" };
  }

  const { data: roleRows, error: roleErr } = await srv
    .from("user_roles")
    .select("profile_id")
    .eq("institution_id", inst)
    .eq("role", "founder");

  if (roleErr) {
    console.error("[push/founder] role lookup error", roleErr);
    return { ok: false as const, queued: 0, reason: roleErr.message };
  }

  const founderIds = Array.from(
    new Set(
      (roleRows ?? [])
        .map((row: any) => String(row.profile_id || ""))
        .filter(Boolean),
    ),
  );

  if (!founderIds.length) {
    return { ok: true as const, queued: 0, reason: "no_founder" };
  }

  const payload = {
    kind,
    title: compactString(title, "Notification fondateur"),
    body: compactString(body),
    institution_id: inst,
    url: "/founder/dashboard",
    ...data,
  };

  const rows = founderIds.map((profileId) => ({
    institution_id: inst,
    profile_id: profileId,
    channels: ["push"],
    payload,
    title: payload.title,
    body: payload.body,
    status: WAIT_STATUS,
    attempts: 0,
    meta: {
      kind,
      institution_id: inst,
      queued_for: "founder",
    },
  }));

  const { error: insertErr } = await srv.from("notifications_queue").insert(rows as any);

  if (insertErr) {
    console.error("[push/founder] queue insert error", insertErr);
    return { ok: false as const, queued: 0, reason: insertErr.message };
  }

  if (dispatch) {
    try {
      await triggerPushDispatch({
        req,
        reason: kind,
        timeoutMs: 2500,
        retries: 0,
      });
    } catch (e: any) {
      console.warn("[push/founder] dispatch non bloquant", e?.message || e);
    }
  }

  return { ok: true as const, queued: rows.length, reason: "queued" };
}

export async function queueFounderStudentEnrollmentNotification(input: {
  institutionId: string;
  institutionName?: string | null;
  classLabel?: string | null;
  count: number;
  mode: "manual" | "import";
  req?: Request;
}) {
  const count = Math.max(0, Number(input.count || 0));
  if (!count) return { ok: true as const, queued: 0, reason: "zero_count" };

  const school = compactString(input.institutionName, "Établissement");
  const klass = compactString(input.classLabel, "Classe");
  const plural = count > 1;

  return queueFounderNotification({
    institutionId: input.institutionId,
    kind: "founder_student_enrolled",
    title: plural ? "Nouvelles inscriptions" : "Nouvelle inscription",
    body: `${school} • ${klass} • ${count} élève${plural ? "s" : ""} inscrit${plural ? "s" : ""}.`,
    data: {
      count,
      class_label: klass,
      institution_name: school,
      mode: input.mode,
    },
    req: input.req,
  });
}
