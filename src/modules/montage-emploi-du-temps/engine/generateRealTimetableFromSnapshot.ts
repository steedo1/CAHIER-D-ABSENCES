import { generateTimetable } from "../scheduler/generateTimetable";
import type { Placement } from "../scheduler/types";
import { buildSchedulerContextFromSnapshot } from "../adapters/buildSchedulerContextFromSnapshot";
import { clean, type HoraclasseServiceMeta } from "../adapters/horaclasseModelHelpers";

type AnyRecord = Record<string, any>;

function findById<T extends { id: string }>(items: T[], id: string): T | null {
  return items.find((item) => item.id === id) || null;
}

function makeServiceKey(classId: string, teacherId: string, catalogSubjectId: string) {
  return `${classId}:${teacherId}:${catalogSubjectId}`;
}

function getMeta(
  placement: Placement,
  metaByKey: Record<string, HoraclasseServiceMeta>,
): HoraclasseServiceMeta | null {
  return metaByKey[makeServiceKey(placement.classId, placement.teacherId, placement.subjectId)] || null;
}

function expandPlacementForMonCahier(
  placement: Placement,
  build: ReturnType<typeof buildSchedulerContextFromSnapshot>,
) {
  const schoolClass = findById(build.context.classes, placement.classId);
  const teacher = findById(build.context.teachers, placement.teacherId);
  const subject = findById(build.context.subjects, placement.subjectId);
  const meta = getMeta(placement, build.serviceMetaByPlacementKey);

  const durationSlots = Math.max(1, Math.ceil(Number(placement.durationUnits || 1)));
  const rows: AnyRecord[] = [];

  for (let offset = 0; offset < durationSlots; offset += 1) {
    const periodIndex = placement.startPeriodIndex + offset;
    const period = build.context.periods.find((item) => item.periodIndex === periodIndex);
    const periodId = build.periodIdByDayAndPeriod[`${placement.dayIndex}:${periodIndex}`] || null;

    rows.push({
      id: `${placement.id}_${offset + 1}`,
      block_id: placement.id,
      lesson_block_id: placement.lessonBlockId,
      class_id: placement.classId,
      class_label: schoolClass?.shortName || schoolClass?.name || meta?.class_label || placement.classId,
      teacher_id: placement.teacherId,
      teacher_name: teacher?.shortName || teacher?.fullName || meta?.teacher_name || placement.teacherId,

      // subject_id doit rester l'id institution_subjects pour publication dans teacher_timetables.
      subject_id: meta?.subject_id || placement.subjectId,
      subject_label: meta?.subject_label || subject?.shortName || subject?.name || placement.subjectId,
      scheduler_subject_id: placement.subjectId,
      catalog_subject_id: meta?.catalog_subject_id || placement.subjectId,

      period_id: periodId,
      weekday: placement.dayIndex,
      period_no: periodIndex,
      period_label: period?.label || `Séance ${periodIndex}`,
      start_time: period?.startTime || null,
      end_time: period?.endTime || null,
      duration_units: placement.durationUnits,
      duration_slot_index: offset + 1,
      duration_slots: durationSlots,
      room_id: placement.roomId || null,

      source: "horaclasse_real_scheduler",
      tandem_group_id: placement.tandemGroupId || null,
      tandem_role: placement.tandemRole || null,
      tandem_mode: placement.tandemMode || null,
    });
  }

  return rows;
}

export function generateRealTimetableFromSnapshot(sourceSnapshot: unknown) {
  const build = buildSchedulerContextFromSnapshot(sourceSnapshot);

  if (!build.canGenerate) {
    return {
      status: "blocked_missing_configuration",
      generated_at: new Date().toISOString(),
      summary: {
        assignments_count: 0,
        unplaced_count: 0,
        score: 0,
      },
      assignments: [],
      unplaced: [],
      diagnostics: build.diagnostics,
    };
  }

  const result = generateTimetable(build.context);

  const assignments = result.placements.flatMap((placement) =>
    expandPlacementForMonCahier(placement, build),
  );

  const unplaced = result.unplacedBlocks.map((block) => {
    const schoolClass = findById(build.context.classes, block.classId);
    const teacher = findById(build.context.teachers, block.teacherId);
    const subject = findById(build.context.subjects, block.subjectId);

    return {
      id: block.id,
      class_id: block.classId,
      class_label: schoolClass?.shortName || schoolClass?.name || block.classId,
      teacher_id: block.teacherId,
      teacher_name: teacher?.shortName || teacher?.fullName || block.teacherId,
      subject_id: block.subjectId,
      subject_label: subject?.shortName || subject?.name || block.subjectId,
      duration_units: block.durationUnits,
      reason: "Bloc non placé par le moteur HoraClasse.",
    };
  });

  const missingPeriodRows = assignments.filter((item) => !clean(item.period_id)).length;
  const diagnostics = [
    ...build.diagnostics,
    ...result.warnings.map((warning) => ({
      level:
        warning.severity === "critical" || warning.severity === "error"
          ? "error"
          : warning.severity === "warning"
            ? "warning"
            : "info",
      message: warning.message,
      warning_type: warning.warningType,
    })),
  ];

  if (missingPeriodRows > 0) {
    diagnostics.push({
      level: "error",
      message: `${missingPeriodRows} ligne(s) générée(s) sans period_id Mon Cahier. Publication bloquée.`,
    });
  }

  return {
    status: "generated_real_scheduler",
    generated_at: new Date().toISOString(),
    summary: {
      classes_count: build.context.classes.length,
      subjects_count: build.context.subjects.length,
      teachers_count: build.context.teachers.length,
      periods_count: build.context.periods.length,
      service_assignments_count: build.context.serviceAssignments.length,
      placements_count: result.placements.length,
      assignments_count: assignments.length,
      unplaced_count: unplaced.length,
      score: result.globalScore,
    },
    assignments,
    unplaced,
    diagnostics,
  } satisfies AnyRecord;
}
