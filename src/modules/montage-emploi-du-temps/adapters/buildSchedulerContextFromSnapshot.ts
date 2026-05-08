import type {
  ClassRoomPreference,
  HalfDay,
  Room,
  SchedulerContext,
  ServiceAssignment,
  SessionDay,
  SessionPeriod,
  Subject,
  Teacher,
  TeacherUnavailability,
  TerrainSchedulingRules,
} from "../scheduler/types";
import { DEFAULT_TERRAIN_RULES, normalizeTerrainRules } from "../scheduler/terrainRules";
import {
  buildSchoolClasses,
  clean,
  defaultRoomsForClasses,
  inferCatalogSubjectId,
  inferRoomTypeFromCatalogSubject,
  toNumber,
  type HoraclasseServiceMeta,
} from "./horaclasseModelHelpers";

type AnyRecord = Record<string, any>;

export type SchedulerBuildDiagnostic = {
  level: "info" | "warning" | "error";
  message: string;
};

export type SchedulerBuildResult = {
  context: SchedulerContext;
  diagnostics: SchedulerBuildDiagnostic[];
  periodIdByDayAndPeriod: Record<string, string>;
  serviceMetaByPlacementKey: Record<string, HoraclasseServiceMeta>;
  canGenerate: boolean;
};

function asArray<T = AnyRecord>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function inferHalfDay(startTime: unknown): HalfDay {
  const raw = clean(startTime);
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "morning";
  const hour = Number(match[1]);
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function isHeavyCatalogSubject(catalogSubjectId: string): boolean {
  return ["maths", "pc", "svt", "francais", "hg", "philo"].includes(
    catalogSubjectId,
  );
}

function buildTerrainRules(raw: unknown): TerrainSchedulingRules {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return DEFAULT_TERRAIN_RULES;
  }

  return normalizeTerrainRules(raw as Partial<TerrainSchedulingRules>);
}

function makeServiceKey(classId: string, teacherId: string, catalogSubjectId: string) {
  return `${classId}:${teacherId}:${catalogSubjectId}`;
}

export function buildSchedulerContextFromSnapshot(
  sourceSnapshot: unknown,
): SchedulerBuildResult {
  const snapshot = (sourceSnapshot || {}) as AnyRecord;
  const diagnostics: SchedulerBuildDiagnostic[] = [];

  const classes = buildSchoolClasses(asArray(snapshot.classes));
  const serviceMeta: HoraclasseServiceMeta[] = asArray(snapshot.service_assignments);

  const catalogSubjectIds = Array.from(
    new Set(
      serviceMeta
        .map((item) => clean(item.catalog_subject_id))
        .filter(Boolean),
    ),
  );

  const subjects: Subject[] = catalogSubjectIds.map((catalogSubjectId) => {
    const found = serviceMeta.find((item) => item.catalog_subject_id === catalogSubjectId);
    return {
      id: catalogSubjectId,
      code: clean(found?.subject_code || catalogSubjectId).toUpperCase(),
      name: clean(found?.catalog_subject_label || found?.subject_label || catalogSubjectId),
      shortName: clean(found?.catalog_subject_label || found?.subject_label || catalogSubjectId),
      isHeavy: isHeavyCatalogSubject(catalogSubjectId),
      defaultRoomType: inferRoomTypeFromCatalogSubject(catalogSubjectId),
    };
  });

  const teachers: Teacher[] = asArray(snapshot.teachers).map((item) => ({
    id: clean(item.id),
    fullName: clean(item.display_name || item.fullName || item.name, "Enseignant"),
    shortName: clean(item.display_name || item.fullName || item.name, "Enseignant"),
    maxWeeklyUnits: item.max_weekly_units ?? null,
  }));

  const periodsRaw = asArray(snapshot.periods);
  const weekdays = Array.from(
    new Set(
      periodsRaw
        .map((item) => toNumber(item.weekday, 0))
        .filter((weekday) => weekday >= 1 && weekday <= 7),
    ),
  ).sort((a, b) => a - b);

  const days: SessionDay[] = weekdays.map((weekday) => ({
    dayIndex: weekday,
    label:
      weekday === 1
        ? "Lundi"
        : weekday === 2
          ? "Mardi"
          : weekday === 3
            ? "Mercredi"
            : weekday === 4
              ? "Jeudi"
              : weekday === 5
                ? "Vendredi"
                : weekday === 6
                  ? "Samedi"
                  : "Dimanche",
    isEnabled: true,
    closedHalfDays: [],
  }));

  const periodByIndex = new Map<number, AnyRecord>();
  for (const period of periodsRaw) {
    const periodIndex = toNumber(period.period_no, 0);
    if (periodIndex <= 0) continue;
    if (!periodByIndex.has(periodIndex)) periodByIndex.set(periodIndex, period);
  }

  const periods: SessionPeriod[] = Array.from(periodByIndex.entries())
    .sort(([a], [b]) => a - b)
    .map(([periodIndex, period]) => ({
      periodIndex,
      label: clean(period.label, `Séance ${periodIndex}`),
      startTime: clean(period.start_time, "00:00"),
      endTime: clean(period.end_time, "00:00"),
      halfDay: inferHalfDay(period.start_time),
      isTeachingPeriod: true,
      isBreakAfter: false,
    }));

  const periodIdByDayAndPeriod: Record<string, string> = {};
  for (const period of periodsRaw) {
    const weekday = toNumber(period.weekday, 0);
    const periodIndex = toNumber(period.period_no, 0);
    const id = clean(period.id);
    if (weekday > 0 && periodIndex > 0 && id) {
      periodIdByDayAndPeriod[`${weekday}:${periodIndex}`] = id;
    }
  }

  const roomsFromSnapshot: Room[] = asArray(snapshot.rooms)
    .map((room) => ({
      id: clean(room.id),
      name: clean(room.name, "Salle"),
      roomType: clean(room.room_type || room.roomType || "ordinary") as Room["roomType"],
    }))
    .filter((room) => room.id && room.name);

  const rooms: Room[] = roomsFromSnapshot.length > 0 ? roomsFromSnapshot : defaultRoomsForClasses(classes);

  const roomPreferences: ClassRoomPreference[] = classes.map((schoolClass) => ({
    classId: schoolClass.id,
    roomId: rooms.find((room) => room.id === `room_${schoolClass.id}`)?.id || rooms[0]?.id || "",
    priority: 1,
    usageType: "main",
    isAllowed: true,
  })).filter((item) => item.roomId);

  const serviceAssignments: ServiceAssignment[] = [];
  const serviceMetaByPlacementKey: Record<string, HoraclasseServiceMeta> = {};

  for (const item of serviceMeta) {
    const classId = clean(item.class_id);
    const teacherId = clean(item.teacher_id);
    const catalogSubjectId = clean(item.catalog_subject_id) || inferCatalogSubjectId({
      code: item.subject_code,
      label: item.subject_label,
      fallbackId: item.subject_id,
    });
    const weeklyUnits = toNumber(item.weekly_units, 0);
    const splitPattern = clean(item.split_pattern);

    if (!classId || !teacherId || !catalogSubjectId) continue;

    if (!weeklyUnits || !splitPattern) {
      diagnostics.push({
        level: "error",
        message: `Service incomplet : ${clean(item.class_label, "Classe")} — ${clean(item.subject_label, "Matière")} — ${clean(item.teacher_name, "Enseignant")}.`,
      });
      continue;
    }

    const id = `service_${classId}_${catalogSubjectId}_${teacherId}`;
    serviceAssignments.push({
      id,
      classId,
      teacherId,
      subjectId: catalogSubjectId,
      weeklyUnits,
      splitPattern,
      roomTypeRequired: item.room_type_required ?? inferRoomTypeFromCatalogSubject(catalogSubjectId),
    });

    serviceMetaByPlacementKey[makeServiceKey(classId, teacherId, catalogSubjectId)] = item;
  }

  const teacherUnavailability: TeacherUnavailability[] = asArray(snapshot.teacher_unavailability)
    .map((item) => ({
      teacherId: clean(item.teacher_id || item.teacherId),
      dayIndex: toNumber(item.weekday ?? item.dayIndex, 0),
      periodIndex:
        item.period_no || item.periodIndex
          ? toNumber(item.period_no ?? item.periodIndex, 0)
          : null,
      halfDay: item.half_day || item.halfDay || null,
      constraintType:
        item.constraint_type === "preference" || item.constraintType === "preference"
          ? "preference"
          : "strict",
      reason: item.reason ? clean(item.reason) : null,
    }))
    .filter((item) => item.teacherId && item.dayIndex >= 1 && item.dayIndex <= 7);

  if (classes.length === 0) diagnostics.push({ level: "error", message: "Aucune classe disponible." });
  if (periods.length === 0) diagnostics.push({ level: "error", message: "Aucun créneau officiel disponible." });
  if (serviceAssignments.length === 0) {
    diagnostics.push({
      level: "error",
      message: "Aucun service HoraClasse prêt. Vérifie Référentiel & services puis Affectation professeurs.",
    });
  }

  const context: SchedulerContext = {
    days,
    periods,
    classes,
    rooms,
    teachers,
    subjects,
    serviceAssignments,
    roomPreferences,
    teacherUnavailability,
    terrainRules: buildTerrainRules(snapshot.terrain_rules),
  };

  return {
    context,
    diagnostics,
    periodIdByDayAndPeriod,
    serviceMetaByPlacementKey,
    canGenerate: diagnostics.filter((item) => item.level === "error").length === 0,
  };
}
