// src/lib/push/grades.ts
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

const WAIT_STATUS = (process.env.PUSH_WAIT_STATUS || "pending").trim();

type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";

type GradeEvaluationRow = {
  id: string;
  class_id: string;
  subject_id: string | null;
  subject_component_id: string | null;
  eval_date: string;
  eval_kind: EvalKind;
  scale: number;
  coeff: number;
  class: {
    id: string;
    label: string;
    level: string | null;
    institution_id: string;
  };
  subject: {
    id: string;
    name: string;
  } | null;
};

type StudentGradeRow = {
  id: string;
  student_id: string;
  score: number | null;
  student: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    full_name?: string | null;
    matricule?: string | null;
  };
};

type GuardianRow = {
  id: string;
  student_id: string;
  guardian_profile_id: string | null;
  parent_id: string | null;
  notifications_enabled: boolean;
};

function normFullName(s: {
  first_name: string | null;
  last_name: string | null;
  full_name?: string | null;
}): string {
  const explicit = (s.full_name || "").trim();
  if (explicit) return explicit;
  const last = (s.last_name || "").trim();
  const first = (s.first_name || "").trim();
  const full = [last, first].filter(Boolean).join(" ").trim();
  return full || "Élève";
}

function formatDateFr(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  try {
    return new Date(isoDate).toLocaleDateString("fr-FR");
  } catch {
    return isoDate;
  }
}

function evalKindLabel(kind: EvalKind): string {
  if (kind === "devoir") return "devoir";
  if (kind === "interro_ecrite") return "interrogation écrite";
  return "interrogation orale";
}

/**
 * Met en file d’attente des notifications de notes pour toutes les lignes
 * de student_grades d’une évaluation publiée.
 *
 * 👉 Pour score != null : notif "note reçue"
 * 👉 Pour score == null : notif "a manqué le [type] du [date]"
 *
 * Appelé uniquement quand on passe is_published de false → true
 * dans /api/grades/evaluations (PATCH).
 */
export async function queueGradeNotificationsForEvaluation(
  evaluationId: string
): Promise<void> {
  const srv = getSupabaseServiceClient();

  // 1️⃣ Récupérer l’évaluation + classe + institution + matière
  const { data: ev, error: evErr } = await srv
    .from("grade_evaluations")
    .select(
      `
      id,
      class_id,
      subject_id,
      subject_component_id,
      eval_date,
      eval_kind,
      scale,
      coeff,
      class:classes!grade_evaluations_class_id_fkey (
        id,
        label,
        level,
        institution_id
      ),
      subject:subjects!grade_evaluations_subject_id_fkey (
        id,
        name
      )
    `
    )
    .eq("id", evaluationId)
    .maybeSingle();

  if (evErr || !ev) {
    console.error("[push/grades] évaluation introuvable", {
      evaluationId,
      error: evErr,
    });
    return;
  }

  // ⚠️ Les relations Supabase sont typées comme des tableaux côté TS
  const rawClass: any = (ev as any).class;
  const rawSubject: any = (ev as any).subject;

  const klass = Array.isArray(rawClass) ? rawClass[0] : rawClass;
  const subj = Array.isArray(rawSubject) ? rawSubject[0] : rawSubject;

  if (!klass) {
    console.error("[push/grades] évaluation sans classe liée", {
      evaluationId,
      ev,
    });
    return;
  }

  const evalRow: GradeEvaluationRow = {
    id: ev.id,
    class_id: ev.class_id,
    subject_id: ev.subject_id,
    subject_component_id: ev.subject_component_id,
    eval_date: ev.eval_date,
    eval_kind: ev.eval_kind,
    scale: ev.scale,
    coeff: ev.coeff,
    class: {
      id: klass.id,
      label: klass.label,
      level: klass.level ?? null,
      institution_id: klass.institution_id,
    },
    subject: subj ? { id: subj.id, name: subj.name } : null,
  };

  const institutionId = evalRow.class.institution_id;
  const classLabel = evalRow.class.label;
  const subjectName = evalRow.subject?.name || "Note";
  const evalDateFr = formatDateFr(evalRow.eval_date);
  const evalKindText = evalKindLabel(evalRow.eval_kind);

  console.log("[push/grades] queue pour évaluation", {
    evaluationId,
    institutionId,
    classLabel,
    subjectName,
  });

  // 2️⃣ Récupérer toutes les lignes student_grades de cette évaluation
  //    ⚠️ y compris celles où score est NULL
  const { data: grades, error: gradesErr } = await srv
    .from("student_grades")
    .select(
      `
      id,
      student_id,
      score,
      student:students!student_grades_student_id_fkey (
        id,
        first_name,
        last_name,
        full_name,
        matricule
      )
    `
    )
    .eq("evaluation_id", evaluationId);

  if (gradesErr) {
    console.error("[push/grades] erreur chargement notes", gradesErr, {
      evaluationId,
    });
    return;
  }

  const gradeRows: StudentGradeRow[] = (grades || []).map((g: any) => ({
    id: g.id,
    student_id: g.student_id,
    score: g.score,
    student: {
      id: g.student?.id,
      first_name: g.student?.first_name ?? null,
      last_name: g.student?.last_name ?? null,
      full_name: g.student?.full_name ?? null,
      matricule: g.student?.matricule ?? null,
    },
  }));

  if (!gradeRows.length) {
    console.log(
      "[push/grades] aucune ligne student_grades pour cette évaluation — rien à notifier",
      { evaluationId }
    );
    return;
  }

  const studentIds = Array.from(
    new Set(gradeRows.map((g) => g.student_id).filter(Boolean))
  );

  if (!studentIds.length) {
    console.log(
      "[push/grades] aucune student_id exploitable dans les notes — abort",
      { evaluationId }
    );
    return;
  }

  // 3️⃣ Récupérer les responsables avec notifications activées
  const { data: guardians, error: guardErr } = await srv
    .from("student_guardians")
    .select(
      `
      id,
      student_id,
      guardian_profile_id,
      parent_id,
      notifications_enabled
    `
    )
    .in("student_id", studentIds)
    .eq("notifications_enabled", true);

  if (guardErr) {
    console.error(
      "[push/grades] erreur chargement student_guardians",
      guardErr,
      { evaluationId }
    );
    return;
  }

  const guardianRows: GuardianRow[] = (guardians || []).map((g: any) => ({
    id: g.id,
    student_id: g.student_id,
    guardian_profile_id: g.guardian_profile_id ?? g.parent_id ?? null,
    parent_id: g.parent_id ?? g.guardian_profile_id ?? null,
    notifications_enabled: !!g.notifications_enabled,
  }));

  // On garde uniquement ceux qui ont vraiment un profil parent
  const effectiveGuardians = guardianRows.filter(
    (g) => g.notifications_enabled && g.guardian_profile_id
  );

  if (!effectiveGuardians.length) {
    console.log(
      "[push/grades] aucun responsable avec notifications activées",
      { evaluationId }
    );
    return;
  }

  // 4️⃣ Construire les lignes à insérer dans notifications_queue
  type QueueInsert = {
    institution_id: string;
    student_id: string;
    parent_id: string;
    channels: string[];
    payload: any;
    status: string;
    severity: "low" | "medium" | "high";
    title: string;
    body: string;
  };

  const rowsToInsert: QueueInsert[] = [];

  for (const grade of gradeRows) {
    const guardiansForStudent = effectiveGuardians.filter(
      (g) => g.student_id === grade.student_id
    );
    if (!guardiansForStudent.length) continue;

    const studentName = normFullName(grade.student);
    const matricule = grade.student.matricule || null;

    const score = grade.score; // peut être null
    const scale = evalRow.scale;

    const isMissed = score == null;

    // Texte court pour le push
    let title: string;
    let body: string;

    if (isMissed) {
      title = `Évaluation manquée — ${studentName}`;
      body = `${subjectName} • ${classLabel} • ${evalKindText} du ${evalDateFr} manqué`;
    } else {
      title = `Nouvelle note — ${studentName}`;
      body = `${subjectName} • ${classLabel} • ${score}/${scale}`;
    }

    const payloadBase = {
      kind: "grade" as const,
      severity: "medium" as const,
      title,
      body,
      class: {
        id: evalRow.class_id,
        label: classLabel,
        level: evalRow.class.level,
      },
      subject: evalRow.subject
        ? { id: evalRow.subject.id, name: evalRow.subject.name }
        : null,
      student: {
        id: grade.student_id,
        name: studentName,
        matricule,
      },
      evaluation: {
        id: evalRow.id,
        date: evalRow.eval_date,
        kind: evalRow.eval_kind,
        scale,
        coeff: evalRow.coeff,
      },
      score: score, // number | null
      missed: isMissed, // true si score null
    };

    for (const g of guardiansForStudent) {
      const parentId = g.guardian_profile_id as string;

      rowsToInsert.push({
        institution_id: institutionId,
        student_id: grade.student_id,
        parent_id: parentId,
        channels: ["inapp", "push"],
        payload: payloadBase,
        status: WAIT_STATUS,
        severity: "medium",
        title,
        body,
      });
    }
  }

  if (!rowsToInsert.length) {
    console.log(
      "[push/grades] pas de combinaison (note + parent) à notifier",
      { evaluationId }
    );
    return;
  }

  // ⚖️ Sécurité : on ne garde que les lignes qui respectent le schéma "notif parent"
  //   → parent_id non nul, student_id non nul, profile_id = NULL
  const filteredRows = rowsToInsert.filter(
    (row) => !!row.parent_id && !!row.student_id
  );

  if (!filteredRows.length) {
    console.log(
      "[push/grades] toutes les lignes de notif sont invalides (sans parent_id ou student_id) — rien à insérer",
      { evaluationId }
    );
    return;
  }

  // 5️⃣ Insertion en masse dans notifications_queue
  const { error: insertErr } = await srv
    .from("notifications_queue")
    .insert(
      filteredRows.map((row) => ({
        institution_id: row.institution_id,
        student_id: row.student_id,
        parent_id: row.parent_id,
        profile_id: null, // ✅ IMPORTANT pour respecter notifications_queue_target_ck
        channels: row.channels,
        payload: row.payload,
        title: row.title,
        body: row.body,
        status: row.status,
        attempts: 0,
        last_error: null,
        meta: JSON.stringify({
          source: "grades",
          evaluation_id: evaluationId,
        }),
        severity: row.severity,
      }))
    );

  if (insertErr) {
    console.error(
      "[push/grades] erreur lors de l’insert notifications_queue",
      insertErr,
      { evaluationId }
    );
    return;
  }

  console.log("[push/grades] notifications de notes mises en file", {
    evaluationId,
    count: filteredRows.length,
  });
}
