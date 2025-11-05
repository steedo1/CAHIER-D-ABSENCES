// src/lib/notifications.ts
import { SupabaseClient } from "@supabase/supabase-js";

/** ISO arrondi à la seconde, sans .SSS (aligne indexes/dédoublon) */
function isoNoMsZ(x: string) {
  const d = new Date(x);
  d.setMilliseconds(0);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Map student_id -> nom lisible (full/display > first+last > matricule > "Élève") */
async function fetchStudentNames(
  srv: SupabaseClient,
  ids: string[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!ids.length) return out;
  try {
    const { data } = await srv
      .from("students")
      .select("id, first_name, last_name, matricule, full_name, display_name")
      .in("id", ids);
    for (const r of data || []) {
      const name =
        r.full_name ||
        r.display_name ||
        [r.first_name, r.last_name].filter(Boolean).join(" ").trim() ||
        r.matricule ||
        "Élève";
      out[r.id] = name;
    }
  } catch {
    /* noop */
  }
  return out;
}

/** Choisit une colonne “parent” tolérante au schéma */
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

  // Liens élève → responsables (tolérant) + filtre notifications_enabled==true si présent
  const { data: sg } = await srv
    .from("student_guardians")
    .select("*")
    .in("student_id", studentIds);

  const linksByStudent = new Map<string, string[]>();
  for (const row of sg || []) {
    // si la colonne existe et que c'est false, on saute
    if ("notifications_enabled" in row && row.notifications_enabled === false) continue;

    const sid = String(row.student_id);
    const pid = pickParentId(row);
    if (!pid) continue;

    const arr = linksByStudent.get(sid) || [];
    arr.push(String(pid));
    linksByStudent.set(sid, Array.from(new Set(arr)));
  }

  const WAIT = (process.env.PUSH_WAIT_STATUS || "pending").trim();
  const rows: any[] = [];
  const occurred_at = isoNoMsZ(whenIso);

  // Anti-doublon intra-batch (clé locale seulement)
  const seen = new Set<string>();

  for (const it of items) {
    const parents = linksByStudent.get(it.student_id) || [];
    if (!parents.length) continue;

    const studentName = names[it.student_id] || "Élève";
    const title = `Sanction — ${studentName}`;
    const body = [
      subject_name || "Discipline",
      class_label || "",
      new Date(occurred_at).toLocaleString("fr-FR", { hour12: false }),
      `−${it.points} pt${it.points > 1 ? "s" : ""}`,
      it.reason ? String(it.reason) : "",
    ]
      .filter(Boolean)
      .join(" • ");

    const payload = {
      kind: "conduct_penalty",
      rubric,
      points: it.points,
      reason: it.reason ?? null,
      class: { label: class_label },
      subject: { name: subject_name },
      student: { id: it.student_id, name: studentName },
      occurred_at, // sans ms
      severity: it.points >= 5 ? "high" : it.points >= 3 ? "medium" : "low",
      title,
      body,
    };

    for (const parent_id of parents) {
      const key = `${parent_id}|${it.student_id}|${occurred_at}|${rubric}|${it.points}|${it.reason ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);

      rows.push({
        institution_id,
        student_id: it.student_id,
        parent_id,
        channels: ["inapp", "push"], // JSONB côté PG via supabase-js
        payload,
        title,
        body,
        status: WAIT,
        send_after: occurred_at,
        meta: { src: "api:queuePenaltyNotifications", v: "3" },
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
