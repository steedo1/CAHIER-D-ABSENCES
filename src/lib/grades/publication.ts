// src/lib/grades/publication.ts
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { queueGradeNotificationsForEvaluation } from "@/lib/push/grades";

export type GradePublicationStatus =
  | "draft"
  | "submitted"
  | "changes_requested"
  | "published";

export type SmsDigestMode = "manual" | "automatic" | "disabled";

export type GradePublicationSettings = {
  institution_id: string;
  require_admin_validation: boolean;
  auto_push_on_publish: boolean;
  sms_digest_mode: SmsDigestMode;
};

export type GradePublicationAction =
  | "submitted"
  | "already_submitted"
  | "changes_requested"
  | "already_published"
  | "published"
  | "unpublished";

export type GradePublicationResult =
  | {
      ok: true;
      action: GradePublicationAction;
      evaluation_id: string;
      institution_id: string;
      publication_status: GradePublicationStatus;
      is_published: boolean;
      publication_version: number;
      official_rows?: number;
      push_queued?: boolean;
    }
  | {
      ok: false;
      error: string;
      status?: number;
      details?: any;
    };

type GradeEvaluationRow = {
  id: string;
  class_id: string;
  subject_id: string | null;
  subject_component_id: string | null;
  teacher_id: string | null;
  eval_date: string;
  eval_kind: string;
  scale: number;
  coeff: number;
  is_published: boolean;
  published_at: string | null;
  publication_status: GradePublicationStatus | string | null;
  publication_version: number | null;
};

type ClassRow = {
  id: string;
  institution_id: string | null;
  label?: string | null;
};

type StudentGradeRow = {
  evaluation_id: string;
  student_id: string;
  score: number | null;
};

function asPublicationStatus(value: unknown): GradePublicationStatus {
  const v = String(value || "").trim();

  if (
    v === "draft" ||
    v === "submitted" ||
    v === "changes_requested" ||
    v === "published"
  ) {
    return v;
  }

  return "draft";
}

function cleanSmsDigestMode(value: unknown): SmsDigestMode {
  const v = String(value || "").trim();

  if (v === "manual" || v === "automatic" || v === "disabled") {
    return v;
  }

  return "manual";
}

function err(
  error: string,
  status = 400,
  details?: any
): GradePublicationResult {
  return { ok: false, error, status, details };
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Paramètres par défaut :
 * - validation admin désactivée pour ne pas casser les écoles existantes ;
 * - push automatique activé après publication ;
 * - SMS digest manuel.
 */
export async function getGradePublicationSettings(
  institutionId: string
): Promise<GradePublicationSettings> {
  const srv = getSupabaseServiceClient();

  const fallback: GradePublicationSettings = {
    institution_id: institutionId,
    require_admin_validation: false,
    auto_push_on_publish: true,
    sms_digest_mode: "manual",
  };

  if (!institutionId) return fallback;

  const { data, error } = await srv
    .from("institution_grade_publication_settings")
    .select(
      "institution_id, require_admin_validation, auto_push_on_publish, sms_digest_mode"
    )
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (error || !data) {
    return fallback;
  }

  return {
    institution_id: institutionId,
    require_admin_validation: data.require_admin_validation === true,
    auto_push_on_publish: data.auto_push_on_publish !== false,
    sms_digest_mode: cleanSmsDigestMode(data.sms_digest_mode),
  };
}

async function loadEvaluationContext(evaluationId: string): Promise<
  | {
      ok: true;
      evaluation: GradeEvaluationRow;
      classRow: ClassRow;
      institutionId: string;
    }
  | {
      ok: false;
      error: string;
      status: number;
      details?: any;
    }
> {
  const srv = getSupabaseServiceClient();

  if (!evaluationId) {
    return {
      ok: false,
      error: "MISSING_EVALUATION_ID",
      status: 400,
    };
  }

  const { data: evaluation, error: evalErr } = await srv
    .from("grade_evaluations")
    .select(
      `
      id,
      class_id,
      subject_id,
      subject_component_id,
      teacher_id,
      eval_date,
      eval_kind,
      scale,
      coeff,
      is_published,
      published_at,
      publication_status,
      publication_version
    `
    )
    .eq("id", evaluationId)
    .maybeSingle();

  if (evalErr) {
    return {
      ok: false,
      error: "EVALUATION_LOAD_ERROR",
      status: 500,
      details: evalErr,
    };
  }

  if (!evaluation) {
    return {
      ok: false,
      error: "EVALUATION_NOT_FOUND",
      status: 404,
    };
  }

  const ev = evaluation as GradeEvaluationRow;

  const { data: classRow, error: classErr } = await srv
    .from("classes")
    .select("id, institution_id, label")
    .eq("id", ev.class_id)
    .maybeSingle();

  if (classErr) {
    return {
      ok: false,
      error: "CLASS_LOAD_ERROR",
      status: 500,
      details: classErr,
    };
  }

  if (!classRow?.institution_id) {
    return {
      ok: false,
      error: "CLASS_INSTITUTION_NOT_FOUND",
      status: 400,
    };
  }

  return {
    ok: true,
    evaluation: ev,
    classRow: classRow as ClassRow,
    institutionId: String(classRow.institution_id),
  };
}

async function logGradePublicationEvent(params: {
  institutionId: string;
  evaluationId: string;
  actorProfileId?: string | null;
  action: string;
  comment?: string | null;
}) {
  const srv = getSupabaseServiceClient();

  try {
    await srv.from("grade_publication_events").insert({
      institution_id: params.institutionId,
      evaluation_id: params.evaluationId,
      actor_profile_id: params.actorProfileId || null,
      action: params.action,
      comment: params.comment || null,
    });
  } catch (e) {
    console.warn("[grades/publication] log event failed", {
      action: params.action,
      evaluationId: params.evaluationId,
      error: e,
    });
  }
}

/**
 * Crée la copie officielle des notes publiées.
 *
 * Important :
 * - student_grades reste la table de saisie ;
 * - grade_published_scores devient la source officielle parents / push / SMS / bulletins.
 */
export async function createOfficialSnapshotForEvaluation(params: {
  evaluationId: string;
  actorProfileId?: string | null;
  forceNewVersion?: boolean;
}): Promise<
  | {
      ok: true;
      evaluation: GradeEvaluationRow;
      institutionId: string;
      publicationVersion: number;
      officialRows: number;
    }
  | {
      ok: false;
      error: string;
      status?: number;
      details?: any;
    }
> {
  const srv = getSupabaseServiceClient();

  const ctx = await loadEvaluationContext(params.evaluationId);

  if (!ctx.ok) {
    return {
      ok: false,
      error: ctx.error,
      status: ctx.status,
      details: ctx.details,
    };
  }

  const { evaluation, institutionId } = ctx;

  const { data: currentRows, error: currentErr } = await srv
    .from("grade_published_scores")
    .select("id")
    .eq("evaluation_id", evaluation.id)
    .eq("is_current", true)
    .limit(1);

  if (currentErr) {
    return {
      ok: false,
      error: "CURRENT_SNAPSHOT_CHECK_ERROR",
      status: 500,
      details: currentErr,
    };
  }

  const alreadyHasCurrent =
    Array.isArray(currentRows) && currentRows.length > 0;

  if (alreadyHasCurrent && !params.forceNewVersion) {
    return {
      ok: true,
      evaluation,
      institutionId,
      publicationVersion: Number(evaluation.publication_version || 1),
      officialRows: 0,
    };
  }

  const { data: grades, error: gradesErr } = await srv
    .from("student_grades")
    .select("evaluation_id, student_id, score")
    .eq("evaluation_id", evaluation.id);

  if (gradesErr) {
    return {
      ok: false,
      error: "STUDENT_GRADES_LOAD_ERROR",
      status: 500,
      details: gradesErr,
    };
  }

  const gradeRows = (grades || []) as StudentGradeRow[];

  const nextVersion = Math.max(
    Number(evaluation.publication_version || 0) + 1,
    1
  );
  const publishedAt = nowIso();

  const { error: oldSnapshotErr } = await srv
    .from("grade_published_scores")
    .update({ is_current: false })
    .eq("evaluation_id", evaluation.id)
    .eq("is_current", true);

  if (oldSnapshotErr) {
    return {
      ok: false,
      error: "OLD_SNAPSHOT_ARCHIVE_ERROR",
      status: 500,
      details: oldSnapshotErr,
    };
  }

  if (gradeRows.length > 0) {
    const rows = gradeRows.map((g) => ({
      institution_id: institutionId,
      class_id: evaluation.class_id,
      evaluation_id: evaluation.id,
      student_id: g.student_id,
      subject_id: evaluation.subject_id,
      subject_component_id: evaluation.subject_component_id,
      teacher_id: evaluation.teacher_id,
      eval_date: evaluation.eval_date,
      eval_kind: evaluation.eval_kind,
      score: g.score,
      scale: evaluation.scale,
      coeff: evaluation.coeff,
      publication_version: nextVersion,
      is_current: true,
      published_at: publishedAt,
      published_by: params.actorProfileId || evaluation.teacher_id || null,
    }));

    const { error: insertErr } = await srv
      .from("grade_published_scores")
      .insert(rows);

    if (insertErr) {
      return {
        ok: false,
        error: "OFFICIAL_SNAPSHOT_INSERT_ERROR",
        status: 500,
        details: insertErr,
      };
    }
  }

  return {
    ok: true,
    evaluation,
    institutionId,
    publicationVersion: nextVersion,
    officialRows: gradeRows.length,
  };
}

/**
 * Mode validation admin :
 * l'enseignant soumet, mais rien ne part aux parents.
 */
export async function submitEvaluationForPublication(params: {
  evaluationId: string;
  actorProfileId: string;
  comment?: string | null;
}): Promise<GradePublicationResult> {
  const srv = getSupabaseServiceClient();

  const ctx = await loadEvaluationContext(params.evaluationId);

  if (!ctx.ok) return err(ctx.error, ctx.status, ctx.details);

  const { evaluation, institutionId } = ctx;

  const currentStatus = asPublicationStatus(evaluation.publication_status);

  if (evaluation.is_published || currentStatus === "published") {
    return {
      ok: true,
      action: "already_published",
      evaluation_id: evaluation.id,
      institution_id: institutionId,
      publication_status: "published",
      is_published: true,
      publication_version: Number(evaluation.publication_version || 1),
      push_queued: false,
    };
  }

  if (currentStatus === "submitted") {
    return {
      ok: true,
      action: "already_submitted",
      evaluation_id: evaluation.id,
      institution_id: institutionId,
      publication_status: "submitted",
      is_published: false,
      publication_version: Number(evaluation.publication_version || 0),
      push_queued: false,
    };
  }

  const { error: updateErr } = await srv
    .from("grade_evaluations")
    .update({
      publication_status: "submitted",
      submitted_at: nowIso(),
      submitted_by: params.actorProfileId,
      reviewed_at: null,
      reviewed_by: null,
      review_comment: null,
      is_published: false,
    })
    .eq("id", evaluation.id);

  if (updateErr) {
    return err("SUBMIT_PUBLICATION_ERROR", 500, updateErr);
  }

  await logGradePublicationEvent({
    institutionId,
    evaluationId: evaluation.id,
    actorProfileId: params.actorProfileId,
    action: currentStatus === "changes_requested" ? "resubmitted" : "submitted",
    comment: params.comment || null,
  });

  return {
    ok: true,
    action: "submitted",
    evaluation_id: evaluation.id,
    institution_id: institutionId,
    publication_status: "submitted",
    is_published: false,
    publication_version: Number(evaluation.publication_version || 0),
    push_queued: false,
  };
}

/**
 * Admin : demander une correction AVANT publication.
 *
 * Sécurité :
 * - si l’évaluation est déjà publiée, on ne la repasse pas brutalement en non publiée ici.
 * - la correction après publication aura son workflow séparé.
 */
export async function requestChangesForEvaluation(params: {
  evaluationId: string;
  actorProfileId: string;
  comment: string;
}): Promise<GradePublicationResult> {
  const srv = getSupabaseServiceClient();

  const cleanComment = String(params.comment || "").trim();

  if (!cleanComment) {
    return err("MISSING_REVIEW_COMMENT", 400);
  }

  const ctx = await loadEvaluationContext(params.evaluationId);

  if (!ctx.ok) return err(ctx.error, ctx.status, ctx.details);

  const { evaluation, institutionId } = ctx;
  const currentStatus = asPublicationStatus(evaluation.publication_status);

  if (evaluation.is_published || currentStatus === "published") {
    return err("ALREADY_PUBLISHED_USE_CORRECTION_WORKFLOW", 409);
  }

  const { error: updateErr } = await srv
    .from("grade_evaluations")
    .update({
      publication_status: "changes_requested",
      reviewed_at: nowIso(),
      reviewed_by: params.actorProfileId,
      review_comment: cleanComment,
      is_published: false,
    })
    .eq("id", evaluation.id);

  if (updateErr) {
    return err("REQUEST_CHANGES_ERROR", 500, updateErr);
  }

  await logGradePublicationEvent({
    institutionId,
    evaluationId: evaluation.id,
    actorProfileId: params.actorProfileId,
    action: "changes_requested",
    comment: cleanComment,
  });

  return {
    ok: true,
    action: "changes_requested",
    evaluation_id: evaluation.id,
    institution_id: institutionId,
    publication_status: "changes_requested",
    is_published: false,
    publication_version: Number(evaluation.publication_version || 0),
    push_queued: false,
  };
}

/**
 * Publication officielle :
 * - crée le snapshot ;
 * - met l’évaluation en published ;
 * - déclenche les push si le paramètre établissement l’autorise.
 */
export async function publishEvaluationOfficially(params: {
  evaluationId: string;
  actorProfileId: string;
  comment?: string | null;
  forceNewVersion?: boolean;
  queuePush?: boolean;
}): Promise<GradePublicationResult> {
  const srv = getSupabaseServiceClient();

  const ctx = await loadEvaluationContext(params.evaluationId);

  if (!ctx.ok) return err(ctx.error, ctx.status, ctx.details);

  const { evaluation, institutionId } = ctx;

  const settings = await getGradePublicationSettings(institutionId);
  const currentStatus = asPublicationStatus(evaluation.publication_status);

  const alreadyPublished =
    evaluation.is_published === true && currentStatus === "published";

  if (alreadyPublished && !params.forceNewVersion) {
    return {
      ok: true,
      action: "already_published",
      evaluation_id: evaluation.id,
      institution_id: institutionId,
      publication_status: "published",
      is_published: true,
      publication_version: Number(evaluation.publication_version || 1),
      official_rows: 0,
      push_queued: false,
    };
  }

  const snapshot = await createOfficialSnapshotForEvaluation({
    evaluationId: evaluation.id,
    actorProfileId: params.actorProfileId,
    forceNewVersion: params.forceNewVersion || !alreadyPublished,
  });

  if (!snapshot.ok) {
    return err(snapshot.error, snapshot.status || 500, snapshot.details);
  }

  const publishedAt = nowIso();

  const { error: updateErr } = await srv
    .from("grade_evaluations")
    .update({
      publication_status: "published",
      publication_version: snapshot.publicationVersion,
      is_published: true,
      published_at: publishedAt,
      reviewed_at: publishedAt,
      reviewed_by: params.actorProfileId,
      review_comment: params.comment || null,
    })
    .eq("id", evaluation.id);

  if (updateErr) {
    return err("PUBLISH_EVALUATION_UPDATE_ERROR", 500, updateErr);
  }

  await logGradePublicationEvent({
    institutionId,
    evaluationId: evaluation.id,
    actorProfileId: params.actorProfileId,
    action: alreadyPublished ? "republished" : "approved_published",
    comment: params.comment || null,
  });

  let pushQueued = false;

  const shouldQueuePush =
    params.queuePush !== false && settings.auto_push_on_publish === true;

  if (shouldQueuePush) {
    try {
      await queueGradeNotificationsForEvaluation(evaluation.id);
      pushQueued = true;
    } catch (pushErr) {
      console.error("[grades/publication] push queue failed", {
        evaluationId: evaluation.id,
        error: pushErr,
      });

      await logGradePublicationEvent({
        institutionId,
        evaluationId: evaluation.id,
        actorProfileId: params.actorProfileId,
        action: "push_queue_failed",
        comment: String((pushErr as any)?.message || pushErr || ""),
      });
    }
  }

  return {
    ok: true,
    action: "published",
    evaluation_id: evaluation.id,
    institution_id: institutionId,
    publication_status: "published",
    is_published: true,
    publication_version: snapshot.publicationVersion,
    official_rows: snapshot.officialRows,
    push_queued: pushQueued,
  };
}

/**
 * Repasse une évaluation publiée en brouillon.
 *
 * Important :
 * - archive les snapshots officiels courants ;
 * - ne supprime pas l'historique ;
 * - ne déclenche aucun push ;
 * - garde publication_version pour conserver la trace.
 */
export async function unpublishEvaluationOfficially(params: {
  evaluationId: string;
  actorProfileId: string;
  comment?: string | null;
}): Promise<GradePublicationResult> {
  const srv = getSupabaseServiceClient();

  const ctx = await loadEvaluationContext(params.evaluationId);

  if (!ctx.ok) return err(ctx.error, ctx.status, ctx.details);

  const { evaluation, institutionId } = ctx;

  const { error: archiveErr } = await srv
    .from("grade_published_scores")
    .update({ is_current: false })
    .eq("evaluation_id", evaluation.id)
    .eq("is_current", true);

  if (archiveErr) {
    return err("UNPUBLISH_ARCHIVE_SNAPSHOT_ERROR", 500, archiveErr);
  }

  const { error: updateErr } = await srv
    .from("grade_evaluations")
    .update({
      publication_status: "draft",
      is_published: false,
      published_at: null,
      reviewed_at: nowIso(),
      reviewed_by: params.actorProfileId,
      review_comment: params.comment || null,
    })
    .eq("id", evaluation.id);

  if (updateErr) {
    return err("UNPUBLISH_EVALUATION_ERROR", 500, updateErr);
  }

  await logGradePublicationEvent({
    institutionId,
    evaluationId: evaluation.id,
    actorProfileId: params.actorProfileId,
    action: "unpublished",
    comment: params.comment || "Évaluation repassée en brouillon.",
  });

  return {
    ok: true,
    action: "unpublished",
    evaluation_id: evaluation.id,
    institution_id: institutionId,
    publication_status: "draft",
    is_published: false,
    publication_version: Number(evaluation.publication_version || 0),
    official_rows: 0,
    push_queued: false,
  };
}

/**
 * À utiliser côté enseignant quand il clique sur le bouton.
 *
 * Si l’école exige validation admin :
 * - l’enseignant soumet seulement.
 *
 * Si l’école autorise publication directe :
 * - l’enseignant publie officiellement.
 */
export async function handleTeacherPublicationIntent(params: {
  evaluationId: string;
  actorProfileId: string;
  comment?: string | null;
}): Promise<GradePublicationResult> {
  const ctx = await loadEvaluationContext(params.evaluationId);

  if (!ctx.ok) return err(ctx.error, ctx.status, ctx.details);

  const settings = await getGradePublicationSettings(ctx.institutionId);

  if (settings.require_admin_validation) {
    return submitEvaluationForPublication({
      evaluationId: params.evaluationId,
      actorProfileId: params.actorProfileId,
      comment: params.comment || null,
    });
  }

  return publishEvaluationOfficially({
    evaluationId: params.evaluationId,
    actorProfileId: params.actorProfileId,
    comment: params.comment || null,
    forceNewVersion: false,
    queuePush: true,
  });
}