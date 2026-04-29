// src/lib/push/grades.ts
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { triggerPushDispatch } from "@/lib/push-dispatch";

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

type PublishedScoreRow = {
  id: string;
  evaluation_id: string;
  student_id: string;
  score: number | null;
  scale: number;
  coeff: number;
  publication_version: number;
  push_queued_at: string | null;
};

type StudentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name?: string | null;
  matricule?: string | null;
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

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Met en file d’attente des notifications de notes pour toutes les lignes
 * OFFICIELLES d’une évaluation publiée.
 *
 * Source officielle :
 *   public.grade_published_scores
 *
 * Règle métier :
 * - une note brouillon / soumise / correction demandée ne peut jamais partir en push ;
 * - seuls les snapshots officiels is_current=true sont notifiables ;
 * - les lignes déjà marquées push_queued_at ne sont pas renvoyées.
 */
export async function queueGradeNotificationsForEvaluation(
  evaluationId: string
): Promise<void> {
  const srv = getSupabaseServiceClient();
  const cleanEvaluationId = String(evaluationId || "").trim();

  if (!cleanEvaluationId) {
    console.warn("[push/grades] missing evaluationId");
    return;
  }

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
      is_published,
      publication_status,
      publication_version,
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
    .eq("id", cleanEvaluationId)
    .maybeSingle();

  if (evErr || !ev) {
    console.error("[push/grades] évaluation introuvable", {
      evaluationId: cleanEvaluationId,
      error: evErr,
    });
    return;
  }

  if ((ev as any).is_published !== true) {
    console.warn("[push/grades] évaluation non publiée — aucun push", {
      evaluationId: cleanEvaluationId,
      is_published: (ev as any).is_published,
      publication_status: (ev as any).publication_status,
    });
    return;
  }

  const rawClass: any = (ev as any).class;
  const rawSubject: any = (ev as any).subject;

  const klass = Array.isArray(rawClass) ? rawClass[0] : rawClass;
  const subj = Array.isArray(rawSubject) ? rawSubject[0] : rawSubject;

  if (!klass?.institution_id) {
    console.error("[push/grades] évaluation sans classe/institution liée", {
      evaluationId: cleanEvaluationId,
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
    scale: toFiniteNumber(ev.scale, 20),
    coeff: toFiniteNumber(ev.coeff, 1),
    class: {
      id: klass.id,
      label: klass.label || "Classe",
      level: klass.level ?? null,
      institution_id: klass.institution_id,
    },
    subject: subj ? { id: subj.id, name: subj.name } : null,
  };

  const institutionId = evalRow.class.institution_id;
  const classLabel = evalRow.class.label || "Classe";
  const subjectName = evalRow.subject?.name || "Note";
  const evalDateFr = formatDateFr(evalRow.eval_date);
  const evalKindText = evalKindLabel(evalRow.eval_kind);

  console.log("[push/grades] queue depuis snapshot officiel", {
    evaluationId: cleanEvaluationId,
    institutionId,
    classLabel,
    subjectName,
  });

  // 2️⃣ Récupérer les notes OFFICIELLES publiées de cette évaluation
  const { data: officialRowsRaw, error: officialErr } = await srv
    .from("grade_published_scores")
    .select(
      `
      id,
      evaluation_id,
      student_id,
      score,
      scale,
      coeff,
      publication_version,
      push_queued_at
    `
    )
    .eq("evaluation_id", cleanEvaluationId)
    .eq("is_current", true);

  if (officialErr) {
    console.error("[push/grades] erreur chargement grade_published_scores", {
      evaluationId: cleanEvaluationId,
      error: officialErr,
    });
    return;
  }

  const officialRows: PublishedScoreRow[] = (officialRowsRaw || []).map(
    (row: any) => ({
      id: String(row.id),
      evaluation_id: String(row.evaluation_id),
      student_id: String(row.student_id),
      score: toNumberOrNull(row.score),
      scale: toFiniteNumber(row.scale, evalRow.scale),
      coeff: toFiniteNumber(row.coeff, evalRow.coeff),
      publication_version: toFiniteNumber(row.publication_version, 1),
      push_queued_at: row.push_queued_at ?? null,
    })
  );

  if (!officialRows.length) {
    console.warn("[push/grades] aucun snapshot officiel pour cette évaluation", {
      evaluationId: cleanEvaluationId,
    });
    return;
  }

  const rowsToNotify = officialRows.filter((row) => !row.push_queued_at);

  if (!rowsToNotify.length) {
    console.log("[push/grades] push déjà mis en file pour ce snapshot", {
      evaluationId: cleanEvaluationId,
      totalOfficialRows: officialRows.length,
    });
    return;
  }

  const studentIds = Array.from(
    new Set(rowsToNotify.map((row) => row.student_id).filter(Boolean))
  );

  if (!studentIds.length) {
    console.log("[push/grades] aucune student_id exploitable — abort", {
      evaluationId: cleanEvaluationId,
    });
    return;
  }

  // 3️⃣ Récupérer les élèves séparément pour éviter de dépendre d’un nom de relation FK
  const { data: studentsRaw, error: studentsErr } = await srv
    .from("students")
    .select("id, first_name, last_name, full_name, matricule")
    .in("id", studentIds);

  if (studentsErr) {
    console.error("[push/grades] erreur chargement students", {
      evaluationId: cleanEvaluationId,
      error: studentsErr,
    });
    return;
  }

  const studentById = new Map<string, StudentRow>();

  for (const s of studentsRaw || []) {
    studentById.set(String((s as any).id), {
      id: String((s as any).id),
      first_name: (s as any).first_name ?? null,
      last_name: (s as any).last_name ?? null,
      full_name: (s as any).full_name ?? null,
      matricule: (s as any).matricule ?? null,
    });
  }

  // 4️⃣ Récupérer les responsables avec notifications activées
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
    console.error("[push/grades] erreur chargement student_guardians", {
      evaluationId: cleanEvaluationId,
      error: guardErr,
    });
    return;
  }

  const guardianRows: GuardianRow[] = (guardians || []).map((g: any) => ({
    id: String(g.id),
    student_id: String(g.student_id),
    guardian_profile_id: g.guardian_profile_id ?? g.parent_id ?? null,
    parent_id: g.parent_id ?? g.guardian_profile_id ?? null,
    notifications_enabled: g.notifications_enabled === true,
  }));

  const effectiveGuardians = guardianRows.filter(
    (g) => g.notifications_enabled && g.guardian_profile_id
  );

  if (!effectiveGuardians.length) {
    console.log("[push/grades] aucun responsable avec notifications activées", {
      evaluationId: cleanEvaluationId,
    });
    return;
  }

  // 5️⃣ Construire les lignes à insérer dans notifications_queue
  type QueueInsert = {
    institution_id: string;
    student_id: string;
    target_profile_id: string;
    channels: string[];
    payload: any;
    status: string;
    severity: "low" | "medium" | "high";
    title: string;
    body: string;
    official_score_id: string;
  };

  const rowsToInsert: QueueInsert[] = [];

  for (const official of rowsToNotify) {
    const guardiansForStudent = effectiveGuardians.filter(
      (g) => g.student_id === official.student_id
    );

    if (!guardiansForStudent.length) continue;

    const student =
      studentById.get(official.student_id) ||
      ({
        id: official.student_id,
        first_name: null,
        last_name: null,
        full_name: "Élève",
        matricule: null,
      } satisfies StudentRow);

    const studentName = normFullName(student);
    const matricule = student.matricule || null;

    const score = official.score;
    const scale = official.scale;
    const coeff = official.coeff;

    const isMissed = score == null;

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
        id: official.student_id,
        name: studentName,
        matricule,
      },
      evaluation: {
        id: evalRow.id,
        date: evalRow.eval_date,
        kind: evalRow.eval_kind,
        scale,
        coeff,
      },
      publication: {
        score_id: official.id,
        version: official.publication_version,
        source: "grade_published_scores",
      },
      score,
      missed: isMissed,
    };

    for (const guardian of guardiansForStudent) {
      const profileId = guardian.guardian_profile_id as string;

      rowsToInsert.push({
        institution_id: institutionId,
        student_id: official.student_id,
        target_profile_id: profileId,
        channels: ["inapp", "push"],
        payload: payloadBase,
        status: WAIT_STATUS,
        severity: "medium",
        title,
        body,
        official_score_id: official.id,
      });
    }
  }

  if (!rowsToInsert.length) {
    console.log("[push/grades] pas de combinaison note officielle + parent", {
      evaluationId: cleanEvaluationId,
    });
    return;
  }

  const filteredRows = rowsToInsert.filter(
    (row) => !!row.target_profile_id && !!row.student_id && !!row.official_score_id
  );

  if (!filteredRows.length) {
    console.log("[push/grades] toutes les lignes de notif sont invalides", {
      evaluationId: cleanEvaluationId,
    });
    return;
  }

  // 6️⃣ Insertion dans notifications_queue
  const { error: insertErr } = await srv
    .from("notifications_queue")
    .insert(
      filteredRows.map((row) => ({
        institution_id: row.institution_id,
        student_id: row.student_id,
        parent_id: null,
        profile_id: row.target_profile_id,
        channels: row.channels,
        payload: row.payload,
        title: row.title,
        body: row.body,
        status: row.status,
        attempts: 0,
        last_error: null,
        meta: JSON.stringify({
          source: "grades",
          official_source: "grade_published_scores",
          evaluation_id: cleanEvaluationId,
          official_score_id: row.official_score_id,
        }),
        severity: row.severity,
      }))
    );

  if (insertErr) {
    console.error("[push/grades] erreur insert notifications_queue", {
      evaluationId: cleanEvaluationId,
      error: insertErr,
    });
    return;
  }

  // 7️⃣ Marquer uniquement les snapshots qui ont réellement généré au moins une notif
  const notifiedScoreIds = Array.from(
    new Set(filteredRows.map((row) => row.official_score_id).filter(Boolean))
  );

  if (notifiedScoreIds.length) {
    const { error: markErr } = await srv
      .from("grade_published_scores")
      .update({ push_queued_at: new Date().toISOString() })
      .in("id", notifiedScoreIds);

    if (markErr) {
      console.warn("[push/grades] impossible de marquer push_queued_at", {
        evaluationId: cleanEvaluationId,
        error: markErr,
      });
    }
  }

  console.log("[push/grades] notifications de notes officielles mises en file", {
    evaluationId: cleanEvaluationId,
    officialRows: notifiedScoreIds.length,
    notifications: filteredRows.length,
  });

  // 8️⃣ Déclenchement immédiat du worker /api/push/dispatch
  try {
    const ok = await triggerPushDispatch({
      reason: `grades:evaluation:${cleanEvaluationId}`,
      timeoutMs: 800,
      retries: 1,
    });

    console.log("[push/grades] triggerPushDispatch", {
      evaluationId: cleanEvaluationId,
      ok,
    });
  } catch (err: any) {
    console.warn("[push/grades] triggerPushDispatch_failed", {
      evaluationId: cleanEvaluationId,
      error: String(err?.message || err),
    });
  }
}