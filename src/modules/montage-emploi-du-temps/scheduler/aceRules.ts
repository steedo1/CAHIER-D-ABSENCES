import type {
  CandidateSlot,
  LessonBlock,
  Placement,
  SchedulerContext,
  SchoolClass,
  Subject,
} from "./types";

export type AceSubjectFamily =
  | "eps"
  | "pc"
  | "svt"
  | "maths"
  | "francais"
  | "histoire_geo"
  | "philo"
  | "anglais"
  | "lv2"
  | "arts_musique"
  | "edhc"
  | "informatique"
  | "autre";

type PeriodWindow = {
  start: number;
  end: number;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getSubject(subjectId: string, context: SchedulerContext): Subject | null {
  return context.subjects.find((subject) => subject.id === subjectId) ?? null;
}

function getClass(classId: string, context: SchedulerContext): SchoolClass | null {
  return context.classes.find((schoolClass) => schoolClass.id === classId) ?? null;
}

function subjectHaystack(subjectId: string, context: SchedulerContext): string {
  const subject = getSubject(subjectId, context);
  return normalizeText(
    [subjectId, subject?.code, subject?.name, subject?.shortName].join(" "),
  );
}

export function getAceSubjectFamily(
  subjectId: string,
  context: SchedulerContext,
): AceSubjectFamily {
  const text = subjectHaystack(subjectId, context);

  if (/(^| )eps( |$)|education physique|sport/.test(text)) return "eps";
  if (/(^| )pc( |$)|phys|chim/.test(text)) return "pc";
  if (/(^| )svt( |$)|science vie|science terre|bio/.test(text)) return "svt";
  if (/math|tice/.test(text)) return "maths";
  if (/franc|lettre moderne|lett mod|l mod/.test(text)) return "francais";
  if (/hist|geo|h g|hg/.test(text)) return "histoire_geo";
  if (/philo/.test(text)) return "philo";
  if (/angl|anglais/.test(text)) return "anglais";
  if (/allemand|espagnol|lv2|all |esp /.test(`${text} `)) return "lv2";
  if (/edhc|education aux droits|droit humain|civique/.test(text)) return "edhc";
  if (/art|plast|musique|mus /.test(`${text} `)) return "arts_musique";
  if (/info|informatique|entreprenariat|entrepreneuriat/.test(text)) return "informatique";

  return "autre";
}

export function isAceScienceFamily(family: AceSubjectFamily): boolean {
  return family === "pc" || family === "svt";
}

export function isAceLightFamily(family: AceSubjectFamily): boolean {
  return family === "arts_musique" || family === "edhc" || family === "informatique";
}

export function isAceHeavyFamily(family: AceSubjectFamily): boolean {
  return (
    family === "maths" ||
    family === "francais" ||
    family === "histoire_geo" ||
    family === "pc" ||
    family === "svt" ||
    family === "philo"
  );
}

function getNormalizedLevel(block: LessonBlock, context: SchedulerContext): string {
  const schoolClass = getClass(block.classId, context);
  return normalizeText([schoolClass?.levelCode, schoolClass?.name, schoolClass?.shortName].join(" "));
}

export function isAceSensitiveLowerLevelBlock(
  block: LessonBlock,
  context: SchedulerContext,
): boolean {
  const level = getNormalizedLevel(block, context);
  return /(^| )(6|6e|6eme|sixieme|5|5e|5eme|cinquieme)( |$)/.test(level);
}

export function getAceSubjectPlacementPriority(
  block: LessonBlock,
  context: SchedulerContext,
): number {
  const family = getAceSubjectFamily(block.subjectId, context);

  // Ordre pratique ACE : EPS, P.C/SVT, blocs forts, LV2, anglais,
  // puis matières de complément. Plus le nombre est petit, plus le bloc passe tôt.
  if (family === "eps") return 0;
  if (isAceScienceFamily(family)) return block.blockType === "tp" || block.blockType === "tandem" ? 1 : 2;
  if (block.durationUnits >= 2 && (family === "francais" || family === "histoire_geo" || family === "maths")) return 3;
  if (block.durationUnits >= 2 && family === "philo") return 4;
  if (family === "lv2") return 5;
  if (family === "anglais") return 6;
  if (family === "francais" || family === "histoire_geo" || family === "maths" || family === "philo") return 7;
  if (family === "arts_musique") return 8;
  if (family === "edhc") return 9;
  return 10;
}

export function getAceDifficultyBoost(
  block: LessonBlock,
  context: SchedulerContext,
): number {
  const priority = getAceSubjectPlacementPriority(block, context);
  const family = getAceSubjectFamily(block.subjectId, context);
  let boost = Math.max(0, 420 - priority * 38);

  if (block.durationUnits >= 2) boost += 60;
  if (block.blockType === "tp" || block.blockType === "tandem") boost += 110;
  if (family === "eps") boost += 160;
  if (isAceScienceFamily(family) && block.roomTypeRequired) boost += 80;

  return boost;
}

function getPeriodEndIndex(value: { startPeriodIndex: number; durationUnits: number }): number {
  return value.startPeriodIndex + Math.ceil(value.durationUnits);
}

function touchesSameSubject(placement: Placement, candidate: CandidateSlot): boolean {
  return (
    getPeriodEndIndex(placement) === candidate.startPeriodIndex ||
    getPeriodEndIndex(candidate) === placement.startPeriodIndex
  );
}

export function hasAceSeparatedSameSubjectSameDay(
  block: LessonBlock,
  candidate: CandidateSlot,
  placements: Placement[],
): boolean {
  const sameSubjectPlacements = placements.filter(
    (placement) =>
      placement.classId === block.classId &&
      placement.subjectId === block.subjectId &&
      placement.dayIndex === candidate.dayIndex,
  );

  if (sameSubjectPlacements.length === 0) return false;
  return !sameSubjectPlacements.some((placement) => touchesSameSubject(placement, candidate));
}

function placementFamily(placement: Placement, context: SchedulerContext): AceSubjectFamily {
  return getAceSubjectFamily(placement.subjectId, context);
}

function hasAdjacentHeavyPlacement(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): boolean {
  return placements.some((placement) => {
    if (placement.classId !== block.classId || placement.dayIndex !== candidate.dayIndex) return false;
    if (!touchesSameSubject(placement, candidate)) return false;
    return isAceHeavyFamily(placementFamily(placement, context));
  });
}

function createsThreeHeavyCoursesInARow(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): boolean {
  const family = getAceSubjectFamily(block.subjectId, context);
  if (!isAceHeavyFamily(family)) return false;

  const windows: PeriodWindow[] = placements
    .filter((placement) => placement.classId === block.classId && placement.dayIndex === candidate.dayIndex)
    .filter((placement) => isAceHeavyFamily(placementFamily(placement, context)))
    .map((placement) => ({ start: placement.startPeriodIndex, end: getPeriodEndIndex(placement) }));

  windows.push({ start: candidate.startPeriodIndex, end: getPeriodEndIndex(candidate) });

  const sorted = windows.sort((a, b) => a.start - b.start);
  let currentStart = sorted[0]?.start ?? 0;
  let currentEnd = sorted[0]?.end ?? 0;

  for (let index = 1; index < sorted.length; index += 1) {
    const item = sorted[index];
    if (item.start <= currentEnd) {
      currentEnd = Math.max(currentEnd, item.end);
      continue;
    }
    if (currentEnd - currentStart >= 3) return true;
    currentStart = item.start;
    currentEnd = item.end;
  }

  return currentEnd - currentStart >= 3;
}

function getCandidateHalfDay(candidate: CandidateSlot, context: SchedulerContext): string | null {
  return context.periods.find((period) => period.periodIndex === candidate.startPeriodIndex)?.halfDay ?? null;
}

function countClassHalfDayUnits(
  classId: string,
  dayIndex: number,
  halfDay: string,
  placements: Placement[],
  context: SchedulerContext,
): number {
  const occupied = new Set<number>();

  for (const placement of placements) {
    if (placement.classId !== classId || placement.dayIndex !== dayIndex) continue;
    const placementHalfDay = getCandidateHalfDay(
      {
        dayIndex: placement.dayIndex,
        startPeriodIndex: placement.startPeriodIndex,
        durationUnits: placement.durationUnits,
        roomId: placement.roomId ?? null,
      },
      context,
    );
    if (placementHalfDay !== halfDay) continue;
    for (let offset = 0; offset < Math.ceil(placement.durationUnits); offset += 1) {
      occupied.add(placement.startPeriodIndex + offset);
    }
  }

  return occupied.size;
}

export function getAceCandidatePenalty(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): number {
  const family = getAceSubjectFamily(block.subjectId, context);
  let penalty = 0;

  if (hasAceSeparatedSameSubjectSameDay(block, candidate, placements)) {
    // Deux heures consécutives restent normales ; seule la reprise séparée est pénalisée.
    penalty += 125000;
  }

  if (createsThreeHeavyCoursesInARow(block, candidate, context, placements)) {
    penalty += isAceSensitiveLowerLevelBlock(block, context) ? 5200 : 1800;
  }

  const halfDay = getCandidateHalfDay(candidate, context);
  if (
    halfDay &&
    candidate.durationUnits <= 1 &&
    isAceHeavyFamily(family) &&
    countClassHalfDayUnits(block.classId, candidate.dayIndex, halfDay, placements, context) === 0
  ) {
    penalty += 2600;
  }

  if (isAceLightFamily(family) && hasAdjacentHeavyPlacement(block, candidate, context, placements)) {
    // AP/Mus/EDHC/Informatique servent bien d'aération entre matières lourdes.
    penalty -= 260;
  }

  return penalty;
}

export function getAceTeacherLevelWarnings(
  placements: Placement[],
  context: SchedulerContext,
): Array<{ teacherId: string; levelCount: number; levels: string[] }> {
  const levelsByTeacher = new Map<string, Set<string>>();
  const exemptFamilies = new Set<AceSubjectFamily>(["edhc", "arts_musique"]);

  for (const placement of placements) {
    const family = getAceSubjectFamily(placement.subjectId, context);
    if (exemptFamilies.has(family)) continue;

    const schoolClass = getClass(placement.classId, context);
    const level = schoolClass?.levelCode || schoolClass?.shortName || schoolClass?.name;
    if (!level) continue;

    const existing = levelsByTeacher.get(placement.teacherId) ?? new Set<string>();
    existing.add(level);
    levelsByTeacher.set(placement.teacherId, existing);
  }

  return Array.from(levelsByTeacher.entries())
    .map(([teacherId, levels]) => ({ teacherId, levelCount: levels.size, levels: Array.from(levels).sort() }))
    .filter((item) => item.levelCount > 3);
}
