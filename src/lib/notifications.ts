// src/lib/notifications.ts
import { SupabaseClient } from "@supabase/supabase-js";

function isUuidLike(s: string | null | undefined) {
  return !!String(s || "").trim().match(/^[0-9a-f-]{32,36}$/i);
}

// Construit un libellé fiable
function makeStudentLabel(row: {
  id: string;
  full_name?: string | null;
  display_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  matricule?: string | null;
}) {
  const byNames =
    row.full_name ||
    row.display_name ||
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim();

  if (byNames && !isUuidLike(byNames)) return byNames;
  if (row.matricule && !isUuidLike(row.matricule)) return row.matricule;
  return row.id; // dernier recours (le SW masquera les UUID et montrera “Élève”)
}

// Récupère (id → {name, matricule})
async function fetchStudentIdents(
  srv: SupabaseClient,
  ids: string[]
): Promise<Record<string, { name: string; matricule: string | null }>> {
  const out: Record<string, { name: string; matricule: string | null }> = {};
  if (!ids.length) return out;

  const { data } = await srv
    .from("students")
    .select("id, full_name, display_name, first_name, last_name, matricule")
    .in("id", ids);

  for (const r of data || []) {
    const name = makeStudentLabel(r as any);
    out[r.id] = { name, matricule: (r as any).matricule ?? null };
  }
  return out;
}

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
  subject_name: string | null;
  items: Array<{ student_id: string; points: number; reason?: string | null }>;
  whenIso: string;
}) {
  const { srv, institution_id, class_label, rubric, subject_name, items, whenIso } = opts;
  if (!items?.length) return { queued: 0 };

  const studentIds = Array.from(new Set(items.map(i => i.student_id)));
  const idents = await fetchStudentIdents(srv, studentIds);

  // Liens élève → parent(s)
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

  const WAIT = (process.env.PUSH_WAIT_STATUS || "pending").trim();
  const rows: any[] = [];

  for (const it of items) {
    const parents = linksByStudent.get(it.student_id) || [];
    if (!parents.length) continue;

    const meta = idents[it.student_id] || { name: it.student_id, matricule: null };
    const studentName = meta.name;
    const title = `Sanction — ${studentName}`;
    const pieces = [
      subject_name || "Discipline",
      class_label || "",
      new Date(whenIso).toLocaleString("fr-FR", { hour12: false }),
      `−${it.points} pt${it.points > 1 ? "s" : ""}`
    ].filter(Boolean);
    const body = pieces.join(" • ");

    const payload = {
      kind: "conduct_penalty",
      rubric,
      points: it.points,
      reason: it.reason ?? null,
      class: { label: class_label },
      subject: { name: subject_name },
      student: { id: it.student_id, name: studentName, matricule: meta.matricule },
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
        channels: ["inapp", "push"], // jsonb côté DB → PostgREST/pg convertit proprement depuis un array JS
        payload,
        title,
        body,
        status: WAIT,
        send_after: whenIso,
      });
    }
  }

  if (!rows.length) return { queued: 0 };
  const { error, count } = await srv.from("notifications_queue").insert(rows, { count: "exact" });
  if (error) throw error;
  return { queued: count || rows.length };
}
