// src/lib/push/grades.ts
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

const WAIT_STATUS = (process.env.PUSH_WAIT_STATUS || "pending").trim();

type GradeFlatMarkRow = {
  institution_id: string;
  evaluation_id: string;
  class_id: string;
  class_label: string | null;
  class_level: string | null;
  subject_id: string | null;
  subject_name: string | null;
  eval_date: string; // "YYYY-MM-DD"
  academic_year: string | null;
  eval_scale: number;
  eval_coeff: number;
  student_id: string;
  last_name: string | null;
  first_name: string | null;
  matricule: string | null;
  raw_score: number | null;
  mark_20: number | null;
};

function formatDateFr(d: string) {
  try {
    return new Date(d).toLocaleDateString("fr-FR");
  } catch {
    return d;
  }
}

function formatScore(score: number, scale: number) {
  if (score === null || score === undefined) return "—";
  const isInt = Math.abs(score - Math.round(score)) < 1e-6;
  const s = isInt
    ? String(Math.round(score))
    : score.toFixed(2).replace(".", ",");
  return `${s}/${scale}`;
}

function buildStudentName(row: GradeFlatMarkRow) {
  const last = (row.last_name || "").trim();
  const first = (row.first_name || "").trim();
  const full = [last, first].filter(Boolean).join(" ").trim();
  return full || "Élève";
}

type NotificationInsertRow = {
  institution_id: string;
  student_id: string;
  channels: string[];
  payload: any;
  status: string;
  severity: "info";
};

/**
 * Enfile dans notifications_queue une notif "grade" pour
 * TOUTES les notes (raw_score non null) d'une évaluation.
 */
export async function queueGradeNotificationsForEvaluation(
  evaluationId: string
) {
  const srv = getSupabaseServiceClient();

  const { data, error } = await srv
    .from("grade_flat_marks")
    .select(
      [
        "institution_id",
        "evaluation_id",
        "class_id",
        "class_label",
        "class_level",
        "subject_id",
        "subject_name",
        "eval_date",
        "academic_year",
        "eval_scale",
        "eval_coeff",
        "student_id",
        "last_name",
        "first_name",
        "matricule",
        "raw_score",
        "mark_20",
      ].join(",")
    )
    .eq("evaluation_id", evaluationId)
    .not("raw_score", "is", null); // uniquement les élèves qui ont une note

  if (error) {
    console.error("[push/grades] flat_marks_select_error", {
      evaluationId,
      error: error.message,
    });
    return;
  }

  // ✅ On cast explicitement ce qui vient de Supabase en notre type métier
  const rows = (data ?? []) as unknown as GradeFlatMarkRow[];

  if (!rows.length) {
    console.info("[push/grades] no_marks_for_eval", { evaluationId });
    return;
  }

  const notifications: NotificationInsertRow[] = rows.map((row) => {
    const studentName = buildStudentName(row);
    const subjectName = (row.subject_name || "Note").trim();
    const classLabel = (row.class_label || "").trim();
    const dateFr = formatDateFr(row.eval_date);
    const scoreStr =
      row.raw_score != null
        ? formatScore(row.raw_score, row.eval_scale)
        : "—";

    const body = `${subjectName} • ${classLabel} • ${dateFr} — ${scoreStr}`;
    const title = `Note publiée — ${studentName}`;

    const payload = {
      body,
      title,
      kind: "grade" as const,
      type: "grade" as const,
      student: {
        id: row.student_id,
        name: studentName,
        matricule: row.matricule,
      },
      class: {
        id: row.class_id,
        label: row.class_label,
        level: row.class_level,
      },
      subject: {
        id: row.subject_id,
        name: row.subject_name,
      },
      evaluation: {
        id: row.evaluation_id,
        date: row.eval_date,
        scale: row.eval_scale,
        coeff: row.eval_coeff,
      },
      academic_year: row.academic_year,
      raw_score: row.raw_score,
      mark_20: row.mark_20,
    };

    return {
      institution_id: row.institution_id,
      student_id: row.student_id,
      channels: ["inapp", "push"],
      payload,
      status: WAIT_STATUS,
      severity: "info",
    };
  });

  const { error: insErr } = await srv
    .from("notifications_queue")
    .insert(notifications as any);

  if (insErr) {
    console.error("[push/grades] queue_insert_error", {
      evaluationId,
      error: insErr.message,
    });
  } else {
    console.info("[push/grades] queued_grade_notifications", {
      evaluationId,
      count: notifications.length,
    });
  }
}
