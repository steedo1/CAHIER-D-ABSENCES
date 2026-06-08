import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { buildSchedulerContextFromSnapshot } from "@/modules/montage-emploi-du-temps/adapters/buildSchedulerContextFromSnapshot";
import { computeGlobalScore, validateSchedule } from "@/modules/montage-emploi-du-temps/scheduler/validateSchedule";
import type { LessonBlock, Placement } from "@/modules/montage-emploi-du-temps/scheduler/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyRecord = Record<string, any>;

type DraftEditAction =
  | {
      action: "move";
      block_id: string;
      weekday: number;
      period_no: number;
      room_id?: string | null;
    }
  | {
      action: "place_unplaced";
      unplaced_id: string;
      weekday: number;
      period_no: number;
      room_id?: string | null;
    }
  | {
      action: "unplace";
      block_id: string;
      reason?: string | null;
    }
  | {
      action: "delete";
      block_id: string;
    }
  | {
      action: "add";
      class_id: string;
      teacher_id: string;
      subject_id: string;
      weekday: number;
      period_no: number;
      duration_units?: number | null;
      room_id?: string | null;
    };

async function guardAdmin() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "unauthorized", message: "Utilisateur non connecté." },
        { status: 401 },
      ),
    };
  }

  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "profile_failed", message: meErr.message },
        { status: 400 },
      ),
    };
  }

  const institutionId = me?.institution_id ? String(me.institution_id) : "";

  if (!institutionId) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "no_institution", message: "Aucune institution associée à ce compte." },
        { status: 400 },
      ),
    };
  }

  const { data: roleRow, error: roleErr } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (roleErr) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "role_failed", message: roleErr.message },
        { status: 400 },
      ),
    };
  }

  if (!["admin", "super_admin"].includes(String(roleRow?.role || ""))) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "forbidden", message: "Droits insuffisants." },
        { status: 403 },
      ),
    };
  }

  return { ok: true as const, srv, userId: user.id, institutionId };
}

function clean(value: unknown, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function makeManualId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getBlockKey(item: AnyRecord) {
  return clean(item.block_id || item.lesson_block_id || item.id);
}

function getSchedulerSubjectId(item: AnyRecord) {
  return clean(item.catalog_subject_id || item.scheduler_subject_id || item.subject_id);
}

function getInstitutionSubjectId(item: AnyRecord, schedulerSubjectId: string, serviceMeta?: AnyRecord | null) {
  return clean(serviceMeta?.subject_id || item.subject_id, schedulerSubjectId);
}

function makeServiceKey(classId: string, teacherId: string, schedulerSubjectId: string) {
  return `${classId}:${teacherId}:${schedulerSubjectId}`;
}

function findServiceMeta(
  build: ReturnType<typeof buildSchedulerContextFromSnapshot>,
  classId: string,
  teacherId: string,
  schedulerSubjectId: string,
) {
  return build.serviceMetaByPlacementKey[
    makeServiceKey(classId, teacherId, schedulerSubjectId)
  ] as AnyRecord | undefined;
}

function getPeriodRows(sourceSnapshot: unknown): AnyRecord[] {
  const snapshot = (sourceSnapshot || {}) as AnyRecord;
  return Array.isArray(snapshot.periods) ? (snapshot.periods as AnyRecord[]) : [];
}

function getPeriodMeta(sourceSnapshot: unknown, weekday: number, periodNo: number) {
  return getPeriodRows(sourceSnapshot).find(
    (item) => toNumber(item.weekday, 0) === weekday && toNumber(item.period_no, 0) === periodNo,
  );
}

function getUniqueBlockRows(assignments: AnyRecord[]) {
  const byKey = new Map<string, AnyRecord[]>();

  for (const item of assignments) {
    const key = getBlockKey(item);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) || []), item]);
  }

  return Array.from(byKey.entries()).map(([key, rows]) => {
    const sorted = [...rows].sort(
      (a, b) => toNumber(a.period_no, 0) - toNumber(b.period_no, 0),
    );
    return { key, rows: sorted, first: sorted[0] || {} };
  });
}

function assignmentBlockToPlacement(block: { key: string; first: AnyRecord; rows: AnyRecord[] }): Placement {
  const first = block.first;
  const schedulerSubjectId = getSchedulerSubjectId(first);
  const duration = Math.max(
    1,
    Math.ceil(
      toNumber(first.duration_slots, 0) ||
        toNumber(first.duration_units, 0) ||
        block.rows.length ||
        1,
    ),
  );

  return {
    id: block.key,
    lessonBlockId: clean(first.lesson_block_id, block.key),
    classId: clean(first.class_id),
    teacherId: clean(first.teacher_id),
    subjectId: schedulerSubjectId,
    roomId: clean(first.room_id) || null,
    dayIndex: toNumber(first.weekday, 0),
    startPeriodIndex: toNumber(first.period_no, 0),
    durationUnits: duration,
    placedBy: "manual",
    tandemGroupId: clean(first.tandem_group_id) || null,
    tandemRole:
      first.tandem_role === "pc" || first.tandem_role === "svt"
        ? first.tandem_role
        : null,
    tandemMode:
      first.tandem_mode === "parallel" || first.tandem_mode === "rotation"
        ? first.tandem_mode
        : null,
  };
}

function unplacedToLessonBlock(item: AnyRecord): LessonBlock {
  const duration = Math.max(
    1,
    Math.ceil(toNumber(item.duration_units, 0) || toNumber(item.duration_slots, 0) || 1),
  );

  return {
    id: clean(item.lesson_block_id || item.block_id || item.id, makeManualId("unplaced")),
    serviceAssignmentId: clean(item.service_assignment_id, "manual"),
    classId: clean(item.class_id),
    teacherId: clean(item.teacher_id),
    subjectId: getSchedulerSubjectId(item),
    durationUnits: duration,
    blockOrder: toNumber(item.block_order, 1) || 1,
    blockType: duration >= 2 ? "double" : "normal",
    roomTypeRequired: clean(item.room_type_required) || null,
    status: "unplaced",
  };
}

function getPlacementLabels(
  placement: Placement,
  build: ReturnType<typeof buildSchedulerContextFromSnapshot>,
  serviceMeta?: AnyRecord | null,
) {
  const schoolClass = build.context.classes.find((item) => item.id === placement.classId);
  const teacher = build.context.teachers.find((item) => item.id === placement.teacherId);
  const subject = build.context.subjects.find((item) => item.id === placement.subjectId);

  return {
    classLabel: schoolClass?.shortName || schoolClass?.name || clean(serviceMeta?.class_label, placement.classId),
    teacherName: teacher?.shortName || teacher?.fullName || clean(serviceMeta?.teacher_name, placement.teacherId),
    subjectLabel:
      clean(serviceMeta?.subject_label) ||
      clean(serviceMeta?.catalog_subject_label) ||
      subject?.shortName ||
      subject?.name ||
      placement.subjectId,
  };
}

function expandPlacementForProject(
  placement: Placement,
  sourceSnapshot: unknown,
  build: ReturnType<typeof buildSchedulerContextFromSnapshot>,
  previousRows: AnyRecord[] = [],
) {
  const firstPrevious = previousRows[0] || {};
  const serviceMeta = findServiceMeta(
    build,
    placement.classId,
    placement.teacherId,
    placement.subjectId,
  );
  const labels = getPlacementLabels(placement, build, serviceMeta);
  const durationSlots = Math.max(1, Math.ceil(Number(placement.durationUnits || 1)));
  const rows: AnyRecord[] = [];

  for (let offset = 0; offset < durationSlots; offset += 1) {
    const periodIndex = placement.startPeriodIndex + offset;
    const period = build.context.periods.find((item) => item.periodIndex === periodIndex);
    const periodFromSnapshot = getPeriodMeta(sourceSnapshot, placement.dayIndex, periodIndex);
    const periodId = build.periodIdByDayAndPeriod[`${placement.dayIndex}:${periodIndex}`] || null;

    rows.push({
      id: `${placement.id}_${offset + 1}`,
      block_id: placement.id,
      lesson_block_id: placement.lessonBlockId,
      class_id: placement.classId,
      class_label: labels.classLabel,
      teacher_id: placement.teacherId,
      teacher_name: labels.teacherName,
      subject_id: getInstitutionSubjectId(firstPrevious, placement.subjectId, serviceMeta),
      subject_label: labels.subjectLabel,
      scheduler_subject_id: placement.subjectId,
      catalog_subject_id: clean(serviceMeta?.catalog_subject_id || firstPrevious.catalog_subject_id, placement.subjectId),
      period_id: periodId,
      weekday: placement.dayIndex,
      period_no: periodIndex,
      period_label: period?.label || clean(periodFromSnapshot?.label, `Séance ${periodIndex}`),
      start_time: period?.startTime || clean(periodFromSnapshot?.start_time) || null,
      end_time: period?.endTime || clean(periodFromSnapshot?.end_time) || null,
      duration_units: placement.durationUnits,
      duration_slot_index: offset + 1,
      duration_slots: durationSlots,
      room_id: placement.roomId || null,
      room_label: clean(firstPrevious.room_label) || null,
      source: "horaclasse_manual_editor",
      tandem_group_id: placement.tandemGroupId || null,
      tandem_role: placement.tandemRole || null,
      tandem_mode: placement.tandemMode || null,
      manually_edited: true,
    });
  }

  return rows;
}

function makeUnplacedFromRows(rows: AnyRecord[], reason?: string | null): AnyRecord | null {
  const first = rows[0];
  if (!first) return null;

  return {
    id: clean(first.lesson_block_id || first.block_id, makeManualId("unplaced")),
    block_id: clean(first.block_id || first.lesson_block_id),
    lesson_block_id: clean(first.lesson_block_id || first.block_id),
    class_id: clean(first.class_id),
    class_label: clean(first.class_label, "Classe"),
    teacher_id: clean(first.teacher_id),
    teacher_name: clean(first.teacher_name, "Enseignant"),
    subject_id: getSchedulerSubjectId(first),
    scheduler_subject_id: getSchedulerSubjectId(first),
    catalog_subject_id: getSchedulerSubjectId(first),
    subject_label: clean(first.subject_label, "Matière"),
    duration_units: Math.max(1, Math.ceil(toNumber(first.duration_units, 0) || rows.length || 1)),
    reason: reason || "Séance retirée du brouillon par l’admin.",
    source: "horaclasse_manual_editor",
  };
}

function dedupeUnplaced(items: AnyRecord[]) {
  const map = new Map<string, AnyRecord>();

  for (const item of items) {
    const key = clean(item.id || item.lesson_block_id || item.block_id);
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
  }

  return Array.from(map.values());
}

function applyDraftAction(
  project: AnyRecord,
  action: DraftEditAction,
  build: ReturnType<typeof buildSchedulerContextFromSnapshot>,
) {
  const engineResult =
    project.engine_result && typeof project.engine_result === "object"
      ? ({ ...(project.engine_result as AnyRecord) } as AnyRecord)
      : {};
  const assignments = Array.isArray(engineResult.assignments)
    ? [...(engineResult.assignments as AnyRecord[])]
    : [];
  const unplaced = Array.isArray(engineResult.unplaced)
    ? [...(engineResult.unplaced as AnyRecord[])]
    : [];

  if (action.action === "move") {
    const blockId = clean(action.block_id);
    const block = getUniqueBlockRows(assignments).find((item) => item.key === blockId);
    if (!block) throw new Error("Séance introuvable dans le brouillon.");

    const placement = assignmentBlockToPlacement(block);
    placement.dayIndex = toNumber(action.weekday, 0);
    placement.startPeriodIndex = toNumber(action.period_no, 0);
    placement.roomId = clean(action.room_id) || placement.roomId || null;

    return {
      assignments: [
        ...assignments.filter((item) => getBlockKey(item) !== blockId),
        ...expandPlacementForProject(placement, project.source_snapshot, build, block.rows),
      ],
      unplaced,
    };
  }

  if (action.action === "place_unplaced") {
    const unplacedId = clean(action.unplaced_id);
    const item = unplaced.find(
      (row) => clean(row.id || row.lesson_block_id || row.block_id) === unplacedId,
    );
    if (!item) throw new Error("Bloc non placé introuvable.");

    const schedulerSubjectId = getSchedulerSubjectId(item);
    const lessonBlockId = clean(item.lesson_block_id || item.block_id || item.id, unplacedId);
    const placement: Placement = {
      id: clean(item.block_id, `manual_${lessonBlockId}`),
      lessonBlockId,
      classId: clean(item.class_id),
      teacherId: clean(item.teacher_id),
      subjectId: schedulerSubjectId,
      roomId: clean(action.room_id) || clean(item.room_id) || null,
      dayIndex: toNumber(action.weekday, 0),
      startPeriodIndex: toNumber(action.period_no, 0),
      durationUnits: Math.max(1, Math.ceil(toNumber(item.duration_units, 0) || 1)),
      placedBy: "manual",
    };

    return {
      assignments: [
        ...assignments,
        ...expandPlacementForProject(placement, project.source_snapshot, build, [item]),
      ],
      unplaced: unplaced.filter(
        (row) => clean(row.id || row.lesson_block_id || row.block_id) !== unplacedId,
      ),
    };
  }

  if (action.action === "unplace") {
    const blockId = clean(action.block_id);
    const rows = assignments.filter((item) => getBlockKey(item) === blockId);
    if (rows.length === 0) throw new Error("Séance introuvable dans le brouillon.");
    const nextUnplaced = makeUnplacedFromRows(rows, action.reason);

    return {
      assignments: assignments.filter((item) => getBlockKey(item) !== blockId),
      unplaced: dedupeUnplaced(nextUnplaced ? [...unplaced, nextUnplaced] : unplaced),
    };
  }

  if (action.action === "delete") {
    const blockId = clean(action.block_id);
    return {
      assignments: assignments.filter((item) => getBlockKey(item) !== blockId),
      unplaced,
    };
  }

  if (action.action === "add") {
    const classId = clean(action.class_id);
    const teacherId = clean(action.teacher_id);
    const schedulerSubjectId = clean(action.subject_id);

    if (!classId || !teacherId || !schedulerSubjectId) {
      throw new Error("Classe, matière et enseignant sont obligatoires.");
    }

    const lessonBlockId = makeManualId("manual_block");
    const placement: Placement = {
      id: lessonBlockId,
      lessonBlockId,
      classId,
      teacherId,
      subjectId: schedulerSubjectId,
      roomId: clean(action.room_id) || null,
      dayIndex: toNumber(action.weekday, 0),
      startPeriodIndex: toNumber(action.period_no, 0),
      durationUnits: Math.max(1, Math.ceil(toNumber(action.duration_units, 1) || 1)),
      placedBy: "manual",
    };

    return {
      assignments: [
        ...assignments,
        ...expandPlacementForProject(placement, project.source_snapshot, build),
      ],
      unplaced,
    };
  }

  return { assignments, unplaced };
}

function getDiagnosticType(item: AnyRecord): string {
  return String(
    item.warning_type || item.warningType || item.type || item.code || item.kind || "unknown",
  );
}

const STRICT_BLOCKING_WARNING_TYPES = new Set([
  "class_conflict",
  "teacher_conflict",
  "room_conflict",
  "assignment_class_conflict",
  "assignment_teacher_conflict",
  "school_closed_period",
  "break_cut_block",
  "room_requirement_mismatch",
  "eps_not_on_field",
  "eps_field_over_capacity",
  "unplaced_block",
  "student_gap",
  "single_hour_return",
  "same_subject_same_day",
  "same_subject_overlong_block",
  "teacher_unavailability_violation",
  "institution_rule_hard_violation",
  "institution_coverage_hard_violation",
]);

function isStrictBlockingDiagnostic(item: AnyRecord): boolean {
  const level = String(item.level || item.severity || "").toLowerCase();
  const warningType = getDiagnosticType(item);

  return (
    level === "critical" ||
    level === "error" ||
    STRICT_BLOCKING_WARNING_TYPES.has(warningType)
  );
}

function countDuplicateAssignmentKeys(
  assignments: AnyRecord[],
  buildKey: (item: AnyRecord) => string,
): number {
  const seen = new Set<string>();
  let duplicates = 0;

  for (const item of assignments) {
    const key = buildKey(item);
    if (!key) continue;
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
  }

  return duplicates;
}

function countDiagnosticsByType(items: AnyRecord[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const warningType = getDiagnosticType(item);
    acc[warningType] = (acc[warningType] || 0) + 1;
    return acc;
  }, {});
}

function rebuildEngineResult(
  project: AnyRecord,
  assignments: AnyRecord[],
  unplaced: AnyRecord[],
  build: ReturnType<typeof buildSchedulerContextFromSnapshot>,
) {
  const placements = getUniqueBlockRows(assignments).map(assignmentBlockToPlacement);
  const unplacedBlocks = unplaced.map(unplacedToLessonBlock);
  const warnings = validateSchedule(placements, unplacedBlocks, build.context, unplacedBlocks);
  const score = computeGlobalScore(warnings, placements, build.context);

  const diagnostics: AnyRecord[] = [
    ...build.diagnostics,
    ...warnings.map((warning) => ({
      level:
        warning.severity === "critical" || warning.severity === "error"
          ? "error"
          : warning.severity === "warning"
            ? "warning"
            : "info",
      message: warning.message,
      warning_type: warning.warningType,
      class_id: warning.classId ?? null,
      teacher_id: warning.teacherId ?? null,
      room_id: warning.roomId ?? null,
      lesson_block_id: warning.lessonBlockId ?? null,
    })),
  ];

  const missingPeriodRows = assignments.filter((item) => !clean(item.period_id)).length;
  const duplicateClassRows = countDuplicateAssignmentKeys(
    assignments,
    (item) => `${item.class_id || ""}:${item.weekday || ""}:${item.period_no || ""}`,
  );
  const duplicateTeacherRows = countDuplicateAssignmentKeys(
    assignments,
    (item) => `${item.teacher_id || ""}:${item.weekday || ""}:${item.period_no || ""}`,
  );
  const duplicateRoomRows = countDuplicateAssignmentKeys(
    assignments.filter((item) => clean(item.room_id)),
    (item) => `${item.room_id || ""}:${item.weekday || ""}:${item.period_no || ""}`,
  );

  if (missingPeriodRows > 0) {
    diagnostics.push({
      level: "error",
      warning_type: "missing_period_id",
      message: `${missingPeriodRows} ligne(s) du brouillon n’ont pas de period_id Mon Cahier. Publication bloquée.`,
    });
  }

  if (duplicateClassRows > 0) {
    diagnostics.push({
      level: "error",
      warning_type: "assignment_class_conflict",
      message: `${duplicateClassRows} conflit(s) classe détecté(s) après correction manuelle.`,
    });
  }

  if (duplicateTeacherRows > 0) {
    diagnostics.push({
      level: "error",
      warning_type: "assignment_teacher_conflict",
      message: `${duplicateTeacherRows} conflit(s) professeur détecté(s) après correction manuelle.`,
    });
  }

  if (duplicateRoomRows > 0) {
    diagnostics.push({
      level: "warning",
      warning_type: "assignment_room_overlap",
      message: `${duplicateRoomRows} chevauchement(s) de salle détecté(s). À vérifier si la salle est partageable.`,
    });
  }

  const blockingDiagnostics = diagnostics.filter(isStrictBlockingDiagnostic);
  const publicationAllowed = blockingDiagnostics.length === 0 && unplaced.length === 0;
  const previousSummary =
    project.engine_result && typeof project.engine_result === "object"
      ? ((project.engine_result as AnyRecord).summary || {})
      : {};

  return {
    ...(project.engine_result && typeof project.engine_result === "object"
      ? (project.engine_result as AnyRecord)
      : {}),
    status: publicationAllowed ? "generated_real_scheduler" : "generated_with_manual_edits",
    generated_at:
      clean((project.engine_result as AnyRecord | null)?.generated_at) || new Date().toISOString(),
    manually_updated_at: new Date().toISOString(),
    summary: {
      ...previousSummary,
      classes_count: build.context.classes.length,
      subjects_count: build.context.subjects.length,
      teachers_count: build.context.teachers.length,
      periods_count: build.context.periods.length,
      placements_count: placements.length,
      assignments_count: assignments.length,
      unplaced_count: unplaced.length,
      score,
      blocking_diagnostics_count: blockingDiagnostics.length,
      diagnostics_count: diagnostics.length,
      diagnostics_by_type: countDiagnosticsByType(diagnostics),
      strict_blocking_types: Array.from(new Set(blockingDiagnostics.map(getDiagnosticType))).sort(),
      publication_allowed: publicationAllowed,
      admin_manual_publication_required: true,
      manual_edits: true,
      duplicate_class_rows: duplicateClassRows,
      duplicate_teacher_rows: duplicateTeacherRows,
      duplicate_room_rows: duplicateRoomRows,
      missing_period_rows: missingPeriodRows,
    },
    assignments,
    unplaced,
    diagnostics,
  };
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const guard = await guardAdmin();
    if (!guard.ok) return guard.response;

    const { id } = await context.params;
    const projectId = clean(id);

    if (!projectId) {
      return NextResponse.json(
        { ok: false, error: "missing_project_id", message: "Identifiant manquant." },
        { status: 400 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as DraftEditAction;
    const action = clean((body as AnyRecord).action);

    if (!action) {
      return NextResponse.json(
        { ok: false, error: "missing_action", message: "Action de modification manquante." },
        { status: 400 },
      );
    }

    const { data: project, error: fetchError } = await guard.srv
      .from("montage_timetable_projects")
      .select("id,institution_id,name,status,source_snapshot,engine_input,engine_result,diagnostics,created_at,updated_at,published_at")
      .eq("id", projectId)
      .eq("institution_id", guard.institutionId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json(
        { ok: false, error: "project_fetch_failed", message: fetchError.message },
        { status: 400 },
      );
    }

    if (!project) {
      return NextResponse.json(
        { ok: false, error: "project_not_found", message: "Brouillon introuvable." },
        { status: 404 },
      );
    }

    if (String(project.status || "") === "published" || project.published_at) {
      return NextResponse.json(
        {
          ok: false,
          error: "project_already_published",
          message: "Cet emploi du temps est déjà publié. Crée ou régénère un brouillon avant modification.",
        },
        { status: 409 },
      );
    }

    const build = buildSchedulerContextFromSnapshot(project.source_snapshot);
    if (!build.canGenerate) {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_snapshot",
          message: "Le brouillon ne peut pas être modifié : les données sources sont incomplètes.",
          diagnostics: build.diagnostics,
        },
        { status: 409 },
      );
    }

    const edited = applyDraftAction(project, body, build);
    const nextEngineResult = rebuildEngineResult(
      project,
      edited.assignments,
      edited.unplaced,
      build,
    );
    const publicationAllowed = Boolean(nextEngineResult.summary?.publication_allowed);
    const nextStatus = publicationAllowed ? "ready" : "draft";

    const { data: updated, error: updateError } = await guard.srv
      .from("montage_timetable_projects")
      .update({
        status: nextStatus,
        published_at: null,
        engine_result: nextEngineResult,
        diagnostics: nextEngineResult.diagnostics || [],
      })
      .eq("id", projectId)
      .eq("institution_id", guard.institutionId)
      .select("id,institution_id,name,status,source_snapshot,engine_input,engine_result,diagnostics,created_at,updated_at,published_at")
      .single();

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: "project_update_failed", message: updateError.message },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      item: updated,
      result: nextEngineResult,
      message: publicationAllowed
        ? "Brouillon corrigé : aucune anomalie bloquante détectée. L’admin peut publier quand il le souhaite."
        : `Brouillon enregistré : ${nextEngineResult.summary?.blocking_diagnostics_count || 0} anomalie(s) bloquante(s) et ${nextEngineResult.summary?.unplaced_count || 0} bloc(s) non placé(s) restent à corriger.`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message: error instanceof Error ? error.message : "Erreur serveur pendant la modification du brouillon.",
      },
      { status: 500 },
    );
  }
}
