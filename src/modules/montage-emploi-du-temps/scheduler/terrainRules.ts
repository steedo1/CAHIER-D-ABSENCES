import type {
  CandidateSlot,
  HalfDay,
  LessonBlock,
  Room,
  SchedulerContext,
  ScienceTandemMode,
  ScienceTandemScope,
  SessionPeriod,
  TerrainSchedulingRules,
} from "./types";

type RoomType = Room["roomType"];

export const DEFAULT_TERRAIN_RULES: TerrainSchedulingRules = {
  avoidBreakInsideMultiPeriodBlock: true,

  enablePcSvtTandem: false,
  pcSvtTandemScope: "disabled",
  pcSvtTandemMode: "parallel",
  pcSvtTandemClassIds: [],

  allowPcInOrdinaryRoomWhenNoLab: true,
  allowSvtInOrdinaryRoomWhenNoLab: true,
  allowEpsInOrdinaryRoomWhenNoField: true,
  allowComputerInOrdinaryRoomWhenNoLab: true,

  // Réalité terrain : les terrains EPS sont partageables, mais pas illimités.
  // Par défaut, un terrain peut accueillir 2 cours EPS au même créneau.
  treatSportsFieldAsSharedResource: true,
  epsMaxSimultaneousCoursesPerField: 2,

  // Règle terrain par défaut : EPS est fortement évité après 10h le matin
  // et avant 15h l’après-midi. Si aucune solution propre n’existe, le cours
  // reste placé mais la case est marquée à vérifier.
  epsHotHourMode: "strict",

  avoidStudentGaps: true,
  avoidTeacherGaps: true,
  avoidSingleHourReturn: true,
  avoidHeavySubjectsBackToBack: true,
  avoidSameSubjectSameDay: true,
  balanceHalfDays: true,
  preferMainClassRoom: true,
};

export function normalizeTerrainRules(
  rules?: Partial<TerrainSchedulingRules> | null,
): TerrainSchedulingRules {
  const scope: ScienceTandemScope =
    rules?.enablePcSvtTandem && rules.pcSvtTandemScope !== "disabled"
      ? rules.pcSvtTandemScope ?? "all_classes"
      : rules?.enablePcSvtTandem
        ? "all_classes"
        : "disabled";

  const rawTandemMode = rules?.pcSvtTandemMode;
  const pcSvtTandemMode: ScienceTandemMode =
    rawTandemMode === "rotation" || rawTandemMode === "parallel"
      ? rawTandemMode
      : DEFAULT_TERRAIN_RULES.pcSvtTandemMode;

  const rawEpsMode = rules?.epsHotHourMode;
  const epsHotHourMode =
    rawEpsMode === "disabled"
      ? "disabled"
      : rawEpsMode === "strict"
        ? "strict"
        : DEFAULT_TERRAIN_RULES.epsHotHourMode;

  return {
    ...DEFAULT_TERRAIN_RULES,
    ...rules,
    enablePcSvtTandem: Boolean(rules?.enablePcSvtTandem),
    pcSvtTandemScope: scope,
    pcSvtTandemMode,
    pcSvtTandemClassIds: Array.isArray(rules?.pcSvtTandemClassIds)
      ? rules.pcSvtTandemClassIds
      : [],
    epsMaxSimultaneousCoursesPerField: Math.max(1, Math.min(8, Math.round(
      Number(rules?.epsMaxSimultaneousCoursesPerField ?? DEFAULT_TERRAIN_RULES.epsMaxSimultaneousCoursesPerField),
    ) || DEFAULT_TERRAIN_RULES.epsMaxSimultaneousCoursesPerField)),
    epsHotHourMode,
  };
}

export function getTerrainRules(
  context: Pick<SchedulerContext, "terrainRules">,
): TerrainSchedulingRules {
  return normalizeTerrainRules(context.terrainRules);
}

export function withDefaultTerrainRules<T extends SchedulerContext>(
  context: T,
): T {
  return {
    ...context,
    terrainRules: normalizeTerrainRules(context.terrainRules),
  };
}

export function canUseOrdinaryRoomFallback(
  roomType: string | null | undefined,
  context: SchedulerContext,
): boolean {
  if (!roomType) {
    return true;
  }

  const rules = getTerrainRules(context);

  if (roomType === "pc_lab") {
    return rules.allowPcInOrdinaryRoomWhenNoLab;
  }

  if (roomType === "svt_lab") {
    return rules.allowSvtInOrdinaryRoomWhenNoLab;
  }

  if (roomType === "sports_field") {
    return rules.allowEpsInOrdinaryRoomWhenNoField;
  }

  if (roomType === "computer_lab") {
    return rules.allowComputerInOrdinaryRoomWhenNoLab;
  }

  return false;
}

export function isOrdinaryFallbackRoom(roomType: RoomType): boolean {
  return roomType === "ordinary" || roomType === "multipurpose";
}

export function isSharedSportsFieldRoom(
  roomId: string | null | undefined,
  context: SchedulerContext,
): boolean {
  if (!roomId) {
    return false;
  }

  if (!getTerrainRules(context).treatSportsFieldAsSharedResource) {
    return false;
  }

  return context.rooms.some(
    (room) => room.id === roomId && room.roomType === "sports_field",
  );
}


export function getSportsFieldRooms(context: SchedulerContext): Room[] {
  return context.rooms.filter((room) => room.roomType === "sports_field");
}

export function getEpsMaxSimultaneousCoursesPerField(
  context: SchedulerContext,
): number {
  return getTerrainRules(context).epsMaxSimultaneousCoursesPerField;
}

export function getTotalEpsFieldCapacity(context: SchedulerContext): number {
  const fieldCount = getSportsFieldRooms(context).length;
  return fieldCount * getEpsMaxSimultaneousCoursesPerField(context);
}

export function isPcSvtSubject(subjectId: string): boolean {
  const normalized = subjectId.toLowerCase();

  return normalized === "pc" || normalized === "svt";
}

export function isPcSvtTandemEnabledForClass(
  classId: string,
  context: SchedulerContext,
): boolean {
  const rules = getTerrainRules(context);

  if (!rules.enablePcSvtTandem) {
    return false;
  }

  if (rules.pcSvtTandemScope === "all_classes") {
    return true;
  }

  if (rules.pcSvtTandemScope === "selected_classes") {
    return rules.pcSvtTandemClassIds.includes(classId);
  }

  return false;
}

export function getPcSvtTandemMode(context: SchedulerContext): ScienceTandemMode {
  return getTerrainRules(context).pcSvtTandemMode;
}

export function blockBelongsToPcSvtTandem(
  block: LessonBlock,
  context: SchedulerContext,
): boolean {
  return (
    isPcSvtSubject(block.subjectId) &&
    isPcSvtTandemEnabledForClass(block.classId, context)
  );
}

export function isSchoolHalfDayClosed(
  dayIndex: number,
  halfDay: HalfDay,
  context: SchedulerContext,
): boolean {
  const day = context.days.find((item) => item.dayIndex === dayIndex);

  if (!day || !day.isEnabled) {
    return true;
  }

  if (Array.isArray(day.closedHalfDays)) {
    return day.closedHalfDays.includes(halfDay);
  }

  // Sécurité terrain : si l’ancien projet n’a pas encore ce réglage,
  // on applique le comportement ivoirien le plus courant : mercredi après-midi fermé.
  return day.dayIndex === 3 && halfDay === "afternoon";
}

function getPeriodsForRawCandidate(
  candidate: CandidateSlot,
  context: SchedulerContext,
): SessionPeriod[] {
  const teachingPeriods = context.periods
    .filter((period) => period.isTeachingPeriod)
    .sort((a, b) => a.periodIndex - b.periodIndex);

  const startIndex = teachingPeriods.findIndex(
    (period) => period.periodIndex === candidate.startPeriodIndex,
  );

  if (startIndex < 0) {
    return [];
  }

  return teachingPeriods.slice(
    startIndex,
    startIndex + Math.max(1, Math.ceil(candidate.durationUnits)),
  );
}

export function candidateHitsClosedSchoolPeriod(
  candidate: CandidateSlot,
  context: SchedulerContext,
): boolean {
  const periods = getPeriodsForRawCandidate(candidate, context);

  if (periods.length === 0) {
    return true;
  }

  return periods.some((period) =>
    isSchoolHalfDayClosed(candidate.dayIndex, period.halfDay, context),
  );
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function isEpsSubjectId(subjectId: string, context: SchedulerContext): boolean {
  const subject = context.subjects.find((item) => item.id === subjectId);
  const values = [
    subjectId,
    subject?.id,
    subject?.code,
    subject?.name,
    subject?.shortName,
  ].map(normalizeText);

  return values.some((value) => value === "eps" || value.includes("education physique"));
}

export function isEpsBlock(block: LessonBlock, context: SchedulerContext): boolean {
  if (block.blockType === "eps" || block.roomTypeRequired === "sports_field") {
    return true;
  }

  return isEpsSubjectId(block.subjectId, context);
}

function timeToMinutes(time: string): number {
  const [hoursRaw, minutesRaw] = time.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }

  return hours * 60 + minutes;
}

export function getCandidateTimeRange(
  candidate: CandidateSlot,
  context: SchedulerContext,
): { start: number; end: number; periods: SessionPeriod[] } | null {
  const periods = getPeriodsForRawCandidate(candidate, context);

  if (periods.length === 0) {
    return null;
  }

  return {
    start: timeToMinutes(periods[0].startTime),
    end: timeToMinutes(periods[periods.length - 1].endTime),
    periods,
  };
}

export function isAfternoonEpsCandidate(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
): boolean {
  if (!isEpsBlock(block, context)) {
    return false;
  }

  const range = getCandidateTimeRange(candidate, context);

  return Boolean(range && range.start >= 15 * 60);
}

export function isEpsCandidateFavorable(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
): boolean {
  if (!isEpsBlock(block, context)) {
    return true;
  }

  const range = getCandidateTimeRange(candidate, context);

  if (!range) {
    return false;
  }

  const ten = 10 * 60;
  const fifteen = 15 * 60;
  const eighteen = 18 * 60;

  // Terrain : EPS favorable le matin avant 10h.
  if (range.end <= ten) {
    return true;
  }

  // Terrain : l’après-midi, on accepte seulement les créneaux qui commencent
  // à 15h ou après. Un EPS placé avant 15h l’après-midi est refusé.
  return range.start >= fifteen && range.end <= eighteen;
}
