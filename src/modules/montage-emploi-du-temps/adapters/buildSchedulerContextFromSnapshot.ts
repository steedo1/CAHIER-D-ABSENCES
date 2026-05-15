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


function timeToMinutes(value: unknown): number | null {
  const raw = clean(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function getDayLabel(weekday: number): string {
  return weekday === 1
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
              : "Dimanche";
}

function getPeriodBreakAfter(periodIndex: number, periodsRaw: AnyRecord[]): boolean {
  const byDay = new Map<number, AnyRecord[]>();

  for (const item of periodsRaw) {
    const weekday = toNumber(item.weekday, 0);
    const periodNo = toNumber(item.period_no, 0);
    if (weekday < 1 || weekday > 7 || periodNo <= 0) continue;
    byDay.set(weekday, [...(byDay.get(weekday) ?? []), item]);
  }

  for (const rows of byDay.values()) {
    const sorted = [...rows].sort((a, b) => toNumber(a.period_no, 0) - toNumber(b.period_no, 0));
    const currentPosition = sorted.findIndex((item) => toNumber(item.period_no, 0) === periodIndex);
    if (currentPosition < 0 || currentPosition >= sorted.length - 1) continue;

    const current = sorted[currentPosition];
    const next = sorted[currentPosition + 1];
    const currentEnd = timeToMinutes(current.end_time);
    const nextStart = timeToMinutes(next.start_time);

    if (inferHalfDay(current.start_time) !== inferHalfDay(next.start_time)) {
      return true;
    }

    if (currentEnd !== null && nextStart !== null && nextStart - currentEnd >= 10) {
      return true;
    }
  }

  return false;
}

function getClosedHalfDaysForWeekday(
  weekday: number,
  periodsRaw: AnyRecord[],
  globalHalfDays: HalfDay[],
): HalfDay[] {
  const opened = new Set<HalfDay>();

  for (const item of periodsRaw) {
    if (toNumber(item.weekday, 0) !== weekday) continue;
    opened.add(inferHalfDay(item.start_time));
  }

  return globalHalfDays.filter((halfDay) => !opened.has(halfDay));
}

function isHeavyCatalogSubject(catalogSubjectId: string): boolean {
  return ["maths", "pc", "svt", "francais", "hg", "philo"].includes(
    catalogSubjectId,
  );
}


function normalizeResourceRoomType(value: unknown): Room["roomType"] {
  const raw = clean(value, "ordinary")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (["sports_field", "sport_field", "terrain", "terrain_eps", "eps", "field", "sports", "sport"].includes(raw)) {
    return "sports_field";
  }

  if (["pc_lab", "labo_pc", "laboratoire_pc", "physique_chimie", "pc"].includes(raw)) {
    return "pc_lab";
  }

  if (["svt_lab", "labo_svt", "laboratoire_svt", "svt"].includes(raw)) {
    return "svt_lab";
  }

  if (["computer_lab", "salle_info", "informatique", "info", "tice"].includes(raw)) {
    return "computer_lab";
  }

  if (["multipurpose", "polyvalente", "salle_polyvalente"].includes(raw)) {
    return "multipurpose";
  }

  if (["administrative", "admin", "bureau"].includes(raw)) {
    return "administrative";
  }

  return "ordinary";
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

function inferRoomTypeForService(
  item: HoraclasseServiceMeta,
  catalogSubjectId: string,
): string | null {
  const explicit = clean(item.room_type_required);

  if (explicit) {
    return explicit;
  }

  const inferredSubjectId = inferCatalogSubjectId({
    code: item.subject_code,
    label: item.subject_label || item.catalog_subject_label,
    fallbackId: catalogSubjectId,
  });

  if (inferredSubjectId === "eps") {
    return "sports_field";
  }

  const fromCatalog = inferRoomTypeFromCatalogSubject(catalogSubjectId);
  if (fromCatalog) {
    return fromCatalog;
  }

  return inferRoomTypeFromCatalogSubject(inferredSubjectId);
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
      defaultRoomType: found
        ? inferRoomTypeForService(found, catalogSubjectId)
        : inferRoomTypeFromCatalogSubject(catalogSubjectId),
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

  const globalHalfDays = Array.from(
    new Set(periodsRaw.map((item) => inferHalfDay(item.start_time))),
  );

  const days: SessionDay[] = weekdays.map((weekday) => ({
    dayIndex: weekday,
    label: getDayLabel(weekday),
    isEnabled: true,
    closedHalfDays: getClosedHalfDaysForWeekday(weekday, periodsRaw, globalHalfDays),
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
      isBreakAfter: getPeriodBreakAfter(periodIndex, periodsRaw),
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
      roomType: normalizeResourceRoomType(room.resource_type || room.resourceType || room.room_type || room.roomType),
    }))
    .filter((room) => room.id && room.name);

  const rooms: Room[] = roomsFromSnapshot.length > 0 ? roomsFromSnapshot : defaultRoomsForClasses(classes);
  const roomIds = new Set(rooms.map((room) => room.id));
  const classIds = new Set(classes.map((schoolClass) => schoolClass.id));

  const savedRoomPreferences: ClassRoomPreference[] = asArray(snapshot.room_preferences || snapshot.roomPreferences)
    .map((item) => {
      const classId = clean(item.class_id || item.classId);
      const roomId = clean(item.resource_id || item.room_id || item.roomId);
      const rawUsage = clean(item.usage_type || item.usageType || "main");
      const usageType = rawUsage === "main" ? "main" : rawUsage === "specialized" ? "specialized" : "alternative";
      return {
        classId,
        roomId,
        priority: toNumber(item.priority, usageType === "main" ? 1 : 2),
        usageType: usageType as ClassRoomPreference["usageType"],
        isAllowed: item.is_allowed === false || item.isAllowed === false || rawUsage === "forbidden" ? false : true,
      };
    })
    .filter((item) => item.classId && item.roomId && item.isAllowed && classIds.has(item.classId) && roomIds.has(item.roomId));

  const roomPreferences: ClassRoomPreference[] = savedRoomPreferences.length > 0
    ? savedRoomPreferences
    : classes.map((schoolClass) => ({
        classId: schoolClass.id,
        roomId: rooms.find((room) => room.id === `room_${schoolClass.id}`)?.id || rooms[0]?.id || "",
        priority: 1,
        usageType: "main" as const,
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
      roomTypeRequired: inferRoomTypeForService(item, catalogSubjectId),
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
          ? ("preference" as const)
          : ("strict" as const),
      reason: item.reason ? clean(item.reason) : null,
    }))
    .filter((item) => item.teacherId && item.dayIndex >= 1 && item.dayIndex <= 7);

  if (classes.length === 0) diagnostics.push({ level: "error", message: "Aucune classe disponible." });
  if (periods.length === 0) diagnostics.push({ level: "error", message: "Aucun créneau officiel disponible." });
  if (roomsFromSnapshot.length === 0) diagnostics.push({ level: "warning", message: "Aucune salle HoraClasse configurée : le moteur utilisera des salles par défaut temporaires." });
  if (savedRoomPreferences.length === 0 && classes.length > 0) diagnostics.push({ level: "info", message: "Aucune affectation salle-classe enregistrée : le moteur appliquera une affectation automatique." });

  if (periods.length > 0 && Object.keys(periodIdByDayAndPeriod).length < periods.length * Math.max(1, days.length)) {
    diagnostics.push({
      level: "info",
      message: "Certains jours n’ont pas tous les créneaux : le moteur utilisera strictement les créneaux officiels disponibles jour par jour.",
    });
  }
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
    availablePeriodKeys: Object.keys(periodIdByDayAndPeriod),
  };

  return {
    context,
    diagnostics,
    periodIdByDayAndPeriod,
    serviceMetaByPlacementKey,
    canGenerate: diagnostics.filter((item) => item.level === "error").length === 0,
  };
}
