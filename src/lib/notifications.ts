// src/lib/notifications.ts

import { SupabaseClient } from "@supabase/supabase-js";

/** ISO arrondi à la seconde, sans .SSS (aligne indexes/dédoublon) */
function isoNoMsZ(x: string) {
  const d = new Date(x);
  d.setMilliseconds(0);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Heuristique: première chaîne non vide */
function firstNonEmpty(...vals: (string | null | undefined)[]) {
  for (const v of vals) {
    const s = (v ?? "").toString().trim();
    if (s) return s;
  }
  return "";
}

/** Construit un nom lisible à partir d’un enregistrement quelconque de “student” */
function computeStudentName(r: any): string {
  // Variantes possibles courantes (FR/EN)
  const full      = (r?.full_name ?? r?.fullname ?? r?.student_full_name ?? r?.display_name ?? r?.student_display_name ?? r?.name ?? r?.student_name) as string | undefined;
  const first     = (r?.first_name ?? r?.firstname ?? r?.given_name ?? r?.prenom) as string | undefined;
  const last      = (r?.last_name ?? r?.lastname ?? r?.family_name ?? r?.nom) as string | undefined;
  const pair      = [first, last].filter(Boolean).join(" ").trim();
  const matricule = (r?.matricule ?? r?.student_code ?? r?.code ?? r?.register_id) as string | undefined;

  return firstNonEmpty(full, pair, matricule, "Élève");
}

/** Map student_id -> nom lisible, sans supposer le schéma exact */
export async function fetchStudentNames(
  srv: SupabaseClient,
  ids: string[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const wanted = Array.from(new Set((ids || []).filter(Boolean)));
  if (!wanted.length) return out;

  const put = (id: string, row: any) => {
    if (!id || out[id]) return;
    out[id] = computeStudentName(row);
  };

  // 1) Essai direct sur students (toutes colonnes)
  try {
    const { data, error } = await srv
      .from("students")
      .select("*")
      .in("id", wanted);

    if (!error) for (const r of data || []) put(String(r.id), r);
  } catch { /* ignore */ }

  // 2) Fallback via class_enrollments → students!inner(*) (si certains manquent)
  const missing = wanted.filter((id) => !out[id]);
  if (missing.length) {
    try {
      const { data, error } = await srv
        .from("class_enrollments")
        .select("student_id, students!inner(*)")
        .in("student_id", missing);

      if (!error) {
        for (const r of data || []) {
          const st = (r as any).students || {};
          put(String((r as any).student_id), st);
        }
      }
    } catch { /* ignore */ }
  }

  // 3) Sécurisation finale
  for (const id of wanted) if (!out[id]) out[id] = "Élève";
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

  const { data: sg } = await srv
    .from("student_guardians")
    .select("*")
    .in("student_id", studentIds);

  const linksByStudent = new Map<string, string[]>();
  for (const row of sg || []) {
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
    ].filter(Boolean).join(" • ");

    const payload = {
      kind: "conduct_penalty",
      rubric,
      points: it.points,
      reason: it.reason ?? null,
      class: { label: class_label },
      subject: { name: subject_name },
      student: { id: it.student_id, name: studentName },
      occurred_at,
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
        channels: ["inapp", "push"],
        payload,
        title,
        body,
        status: WAIT,
        send_after: occurred_at,
        meta: { src: "api:queuePenaltyNotifications", v: "4" },
      });
    }
  }

  if (!rows.length) return { queued: 0 };
  const { error, count } = await srv.from("notifications_queue").insert(rows, { count: "exact" });
  if (error) throw error;
  return { queued: count || rows.length };
}
