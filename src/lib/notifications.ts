// src/lib/notifications.ts
import { SupabaseClient } from "@supabase/supabase-js";

// Essaie de récupérer un nom lisible d'élève
async function fetchStudentNames(
  srv: SupabaseClient,
  ids: string[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const { data } = await srv
      .from("students")
      .select("id, full_name, display_name, first_name, last_name")
      .in("id", ids);
    for (const r of data || []) {
      const name =
        r.full_name ||
        r.display_name ||
        [r.first_name, r.last_name].filter(Boolean).join(" ") ||
        r.id;
      out[r.id] = name;
    }
  } catch {}
  return out;
}

// Récupère les parents (schéma tolérant: prend la 1ère colonne existante)
function pickParentId(row: any): string | null {
  return (
    row?.parent_id ||
    row?.guardian_profile_id ||
    row?.parent_profile_id ||
    row?.profile_id ||
    row?.user_id ||
    null
  );
}

export async function queuePenaltyNotifications(opts: {
  srv: SupabaseClient;
  institution_id: string;
  class_label: string | null;
  rubric: "discipline" | "tenue" | "moralite";
  subject_name: string | null; // peut être null
  items: Array<{ student_id: string; points: number; reason?: string | null }>;
  whenIso: string; // e.g. nowIso
}) {
  const {
    srv,
    institution_id,
    class_label,
    rubric,
    subject_name,
    items,
    whenIso,
  } = opts;

  if (!items?.length) return { queued: 0 };

  const studentIds = Array.from(new Set(items.map((i) => i.student_id)));
  const names = await fetchStudentNames(srv, studentIds);

  // liens élève → parent(s)
  const { data: sg } = await srv
    .from("student_guardians")
    .select("*")
    .in("student_id", studentIds);

  const linksByStudent = new Map<string, string[]>();
  for (const row of sg || []) {
    const sid = String(row.student_id);
    const pid = pickParentId(row);
    if (!pid) continue;
    const arr = linksByStudent.get(sid) || [];
    arr.push(String(pid));
    linksByStudent.set(sid, Array.from(new Set(arr)));
  }

  // construire les notifications
  const WAIT = (process.env.PUSH_WAIT_STATUS || "pending").trim();
  const rows: any[] = [];

  for (const it of items) {
    const parents = linksByStudent.get(it.student_id) || [];
    if (!parents.length) continue;

    const studentName = names[it.student_id] || it.student_id;
    const title = `Sanction — ${studentName}`;
    const pieces = [
      subject_name || "Discipline",
      class_label || "",
      new Date(whenIso).toLocaleString("fr-FR", { hour12: false }),
    ].filter(Boolean);
    const body = pieces.join(" • ");

    const payload = {
      kind: "conduct_penalty",
      rubric,
      points: it.points,
      reason: it.reason ?? null,
      class: { label: class_label },
      subject: { name: subject_name },
      student: { id: it.student_id, name: studentName },
      occurred_at: whenIso,
      severity: it.points >= 5 ? "high" : it.points >= 3 ? "medium" : "low",
      title,
      body,
    };

    for (const parent_id of parents) {
      rows.push({
        institution_id,
        student_id: it.student_id,
        parent_id,
        channels: ["inapp", "push"], // <— INDISPENSABLE pour le dispatcher
        payload,
        title,
        body,
        status: WAIT,
        send_after: whenIso, // ou null, selon tes règles
      });
    }
  }

  if (!rows.length) return { queued: 0 };

  const { error, count } = await srv
    .from("notifications_queue")
    .insert(rows, { count: "exact" });

  if (error) throw error;
  return { queued: count || rows.length };
}
