import type {
  CandidateSlot,
  HalfDay,
  LessonBlock,
  Placement,
  SchedulerContext,
  SessionPeriod,
} from "./types";
import { getPeriodsForCandidate } from "./hardRules";
import { getAceCandidatePenalty, hasAceSeparatedSameSubjectSameDay } from "./aceRules";
import {
  canUseOrdinaryRoomFallback,
  getCandidateTimeRange,
  getTerrainRules,
  getEpsMaxSimultaneousCoursesPerField,
  isAfternoonEpsCandidate,
  isEpsBlock,
  isEpsCandidateFavorable,
  isEpsSubjectId,
  isOrdinaryFallbackRoom,
} from "./terrainRules";


function placementsOverlapForCandidate(
  placement: Placement,
  candidate: CandidateSlot,
): boolean {
  if (placement.dayIndex !== candidate.dayIndex) {
    return false;
  }

  const placementStart = placement.startPeriodIndex;
  const placementEnd = placement.startPeriodIndex + Math.ceil(placement.durationUnits);
  const candidateStart = candidate.startPeriodIndex;
  const candidateEnd = candidate.startPeriodIndex + Math.ceil(candidate.durationUnits);

  return placementStart < candidateEnd && candidateStart < placementEnd;
}

function getRoomType(roomId: string | null | undefined, context: SchedulerContext): string | null {
  if (!roomId) {
    return null;
  }

  return context.rooms.find((room) => room.id === roomId)?.roomType ?? null;
}

export function countEpsPlacementsOnFieldForCandidate(
  roomId: string | null | undefined,
  candidate: CandidateSlot,
  placements: Placement[],
  context: SchedulerContext,
): number {
  if (!roomId || getRoomType(roomId, context) !== "sports_field") {
    return 0;
  }

  return placements.filter(
    (placement) =>
      placement.roomId === roomId &&
      isEpsBlock(
        {
          id: placement.lessonBlockId,
          serviceAssignmentId: "placement",
          classId: placement.classId,
          teacherId: placement.teacherId,
          subjectId: placement.subjectId,
          durationUnits: placement.durationUnits,
          blockOrder: 1,
          blockType: "eps",
          roomTypeRequired: "sports_field",
          status: "placed",
        },
        context,
      ) &&
      placementsOverlapForCandidate(placement, candidate),
  ).length;
}

export function getEpsFieldOverloadAmount(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): number {
  if (!isEpsBlock(block, context) || getRoomType(candidate.roomId, context) !== "sports_field") {
    return 0;
  }

  const capacity = getEpsMaxSimultaneousCoursesPerField(context);
  const projectedUsage = countEpsPlacementsOnFieldForCandidate(
    candidate.roomId,
    candidate,
    placements,
    context,
  ) + 1;

  return Math.max(0, projectedUsage - capacity);
}

function getSubject(block: LessonBlock, context: SchedulerContext) {
  return context.subjects.find((subject) => subject.id === block.subjectId);
}

function getPeriodByIndex(
  periodIndex: number,
  context: SchedulerContext,
): SessionPeriod | undefined {
  return context.periods.find((period) => period.periodIndex === periodIndex);
}

function getPlacementPeriods(
  placement: Placement,
  context: SchedulerContext,
): SessionPeriod[] {
  return getPeriodsForCandidate(
    {
      dayIndex: placement.dayIndex,
      startPeriodIndex: placement.startPeriodIndex,
      durationUnits: placement.durationUnits,
      roomId: placement.roomId ?? null,
    },
    context,
  );
}

function getPlacementPeriodsSet(
  placement: Placement,
  context: SchedulerContext,
): Set<number> {
  return new Set(
    getPlacementPeriods(placement, context).map((period) => period.periodIndex),
  );
}

function getCandidatePeriodsSet(
  candidate: CandidateSlot,
  context: SchedulerContext,
): Set<number> {
  return new Set(
    getPeriodsForCandidate(candidate, context).map(
      (period) => period.periodIndex,
    ),
  );
}

function getOccupiedPeriodsForClassDay(
  classId: string,
  dayIndex: number,
  placements: Placement[],
  context: SchedulerContext,
  candidate?: CandidateSlot,
): Set<number> {
  const occupied = new Set<number>();

  for (const placement of placements) {
    if (placement.classId !== classId || placement.dayIndex !== dayIndex) {
      continue;
    }

    for (const periodIndex of getPlacementPeriodsSet(placement, context)) {
      occupied.add(periodIndex);
    }
  }

  if (candidate) {
    for (const periodIndex of getCandidatePeriodsSet(candidate, context)) {
      occupied.add(periodIndex);
    }
  }

  return occupied;
}

function getOccupiedPeriodsForTeacherDay(
  teacherId: string,
  dayIndex: number,
  placements: Placement[],
  context: SchedulerContext,
  candidate?: CandidateSlot,
): Set<number> {
  const occupied = new Set<number>();

  for (const placement of placements) {
    if (placement.teacherId !== teacherId || placement.dayIndex !== dayIndex) {
      continue;
    }

    for (const periodIndex of getPlacementPeriodsSet(placement, context)) {
      occupied.add(periodIndex);
    }
  }

  if (candidate) {
    for (const periodIndex of getCandidatePeriodsSet(candidate, context)) {
      occupied.add(periodIndex);
    }
  }

  return occupied;
}

function getTeachingPeriodIndexesForHalfDay(
  halfDay: HalfDay,
  context: SchedulerContext,
): number[] {
  return context.periods
    .filter((period) => period.isTeachingPeriod && period.halfDay === halfDay)
    .sort((a, b) => a.periodIndex - b.periodIndex)
    .map((period) => period.periodIndex);
}

function getHalfDays(context: SchedulerContext): HalfDay[] {
  return Array.from(
    new Set(
      context.periods
        .filter((period) => period.isTeachingPeriod)
        .map((period) => period.halfDay),
    ),
  );
}

function countGapsInsideHalfDay(
  occupied: Set<number>,
  halfDay: HalfDay,
  context: SchedulerContext,
): number {
  const teachingIndexes = getTeachingPeriodIndexesForHalfDay(halfDay, context);
  const occupiedPositions = teachingIndexes
    .map((periodIndex, position) => ({ periodIndex, position }))
    .filter((item) => occupied.has(item.periodIndex))
    .map((item) => item.position);

  if (occupiedPositions.length <= 1) {
    return 0;
  }

  const first = Math.min(...occupiedPositions);
  const last = Math.max(...occupiedPositions);
  let gaps = 0;

  for (let position = first; position <= last; position += 1) {
    const periodIndex = teachingIndexes[position];

    if (!occupied.has(periodIndex)) {
      gaps += 1;
    }
  }

  return gaps;
}

function countGapsInsideDay(
  occupied: Set<number>,
  context: SchedulerContext,
): number {
  return getHalfDays(context).reduce(
    (total, halfDay) => total + countGapsInsideHalfDay(occupied, halfDay, context),
    0,
  );
}

function countStudentGapsForClassDay(
  classId: string,
  dayIndex: number,
  placements: Placement[],
  context: SchedulerContext,
  candidate?: CandidateSlot,
): number {
  const occupied = getOccupiedPeriodsForClassDay(
    classId,
    dayIndex,
    placements,
    context,
    candidate,
  );

  return countGapsInsideDay(occupied, context);
}

function countTeacherGapsForTeacherDay(
  teacherId: string,
  dayIndex: number,
  placements: Placement[],
  context: SchedulerContext,
  candidate?: CandidateSlot,
): number {
  const occupied = getOccupiedPeriodsForTeacherDay(
    teacherId,
    dayIndex,
    placements,
    context,
    candidate,
  );

  return countGapsInsideDay(occupied, context);
}

export function countStudentGapsInPlacements(
  placements: Placement[],
  context: SchedulerContext,
): number {
  let total = 0;
  const enabledDayIndexes = context.days
    .filter((day) => day.isEnabled)
    .map((day) => day.dayIndex);

  for (const schoolClass of context.classes) {
    for (const dayIndex of enabledDayIndexes) {
      total += countStudentGapsForClassDay(
        schoolClass.id,
        dayIndex,
        placements,
        context,
      );
    }
  }

  return total;
}

export function countSingleHourReturnsInPlacements(
  placements: Placement[],
  context: SchedulerContext,
): number {
  let total = 0;
  const enabledDayIndexes = context.days
    .filter((day) => day.isEnabled)
    .map((day) => day.dayIndex);

  for (const schoolClass of context.classes) {
    for (const dayIndex of enabledDayIndexes) {
      for (const halfDay of getHalfDays(context)) {
        const occupied = getOccupiedPeriodsForClassDay(
          schoolClass.id,
          dayIndex,
          placements.filter((placement) => {
            if (placement.classId !== schoolClass.id || placement.dayIndex !== dayIndex) {
              return false;
            }

            const period = getPeriodByIndex(placement.startPeriodIndex, context);
            return period?.halfDay === halfDay;
          }),
          context,
        );

        if (occupied.size === 1) {
          total += 1;
        }
      }
    }
  }

  return total;
}

export function countProjectedStudentGaps(
  block: LessonBlock,
  candidate: CandidateSlot,
  placements: Placement[],
  context: SchedulerContext,
): number {
  return countStudentGapsForClassDay(
    block.classId,
    candidate.dayIndex,
    placements,
    context,
    candidate,
  );
}

export function createsStudentGap(
  block: LessonBlock,
  candidate: CandidateSlot,
  placements: Placement[],
  context: SchedulerContext,
): boolean {
  const before = countStudentGapsForClassDay(
    block.classId,
    candidate.dayIndex,
    placements,
    context,
  );
  const after = countProjectedStudentGaps(block, candidate, placements, context);

  return after > before;
}

export function createsTeacherGap(
  block: LessonBlock,
  candidate: CandidateSlot,
  placements: Placement[],
  context: SchedulerContext,
): boolean {
  const before = countTeacherGapsForTeacherDay(
    block.teacherId,
    candidate.dayIndex,
    placements,
    context,
  );
  const after = countTeacherGapsForTeacherDay(
    block.teacherId,
    candidate.dayIndex,
    placements,
    context,
    candidate,
  );

  return after > before;
}

export function createsSingleHourReturn(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): boolean {
  const candidatePeriods = getPeriodsForCandidate(candidate, context);

  if (candidatePeriods.length === 0) {
    return false;
  }

  const halfDay = candidatePeriods[0].halfDay;

  const totalInHalfDay = placements.filter((placement) => {
    if (
      placement.classId !== block.classId ||
      placement.dayIndex !== candidate.dayIndex
    ) {
      return false;
    }

    const period = getPeriodByIndex(placement.startPeriodIndex, context);

    return period?.halfDay === halfDay;
  }).length;

  return totalInHalfDay === 0 && candidate.durationUnits <= 1;
}

export function overloadsHalfDay(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): boolean {
  const candidatePeriods = getPeriodsForCandidate(candidate, context);

  if (candidatePeriods.length === 0) {
    return false;
  }

  const halfDay = candidatePeriods[0].halfDay;

  let occupiedUnits = candidate.durationUnits;

  for (const placement of placements) {
    if (
      placement.classId !== block.classId ||
      placement.dayIndex !== candidate.dayIndex
    ) {
      continue;
    }

    const period = getPeriodByIndex(placement.startPeriodIndex, context);

    if (period?.halfDay === halfDay) {
      occupiedUnits += placement.durationUnits;
    }
  }

  return occupiedUnits > 4;
}

export function createsHeavySubjectSequence(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): boolean {
  const subject = getSubject(block, context);

  if (!subject?.isHeavy) {
    return false;
  }

  const candidateStart = candidate.startPeriodIndex;
  const candidateEnd = candidate.startPeriodIndex + Math.ceil(candidate.durationUnits);

  const adjacentPlacements = placements.filter((placement) => {
    if (
      placement.classId !== block.classId ||
      placement.dayIndex !== candidate.dayIndex
    ) {
      return false;
    }

    const placementStart = placement.startPeriodIndex;
    const placementEnd =
      placement.startPeriodIndex + Math.ceil(placement.durationUnits);

    return placementEnd === candidateStart || placementStart === candidateEnd;
  });

  return adjacentPlacements.some((placement) => {
    const adjacentSubject = context.subjects.find(
      (item) => item.id === placement.subjectId,
    );

    return Boolean(adjacentSubject?.isHeavy);
  });
}

function getCandidateEndPeriodIndex(candidate: CandidateSlot): number {
  return candidate.startPeriodIndex + Math.ceil(candidate.durationUnits);
}

function getPlacementEndPeriodIndex(placement: Placement): number {
  return placement.startPeriodIndex + Math.ceil(placement.durationUnits);
}

function touchesOrContinuesSameSubject(
  placement: Placement,
  candidate: CandidateSlot,
): boolean {
  const placementEnd = getPlacementEndPeriodIndex(placement);
  const candidateEnd = getCandidateEndPeriodIndex(candidate);

  return placementEnd === candidate.startPeriodIndex || candidateEnd === placement.startPeriodIndex;
}

export function repeatsSubjectSameDay(
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

  if (sameSubjectPlacements.length === 0) {
    return false;
  }

  // Deux blocs successifs d’une même matière constituent souvent un vrai bloc
  // pédagogique de 2h ou plus. On ne doit pas pénaliser ce cas comme une
  // “matière répétée”. On pénalise seulement les reprises séparées.
  return !sameSubjectPlacements.some((placement) =>
    touchesOrContinuesSameSubject(placement, candidate),
  );
}

export function usesAlternativeRoom(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
): boolean {
  if (!candidate.roomId) {
    return false;
  }

  return context.roomPreferences.some(
    (preference) =>
      preference.classId === block.classId &&
      preference.roomId === candidate.roomId &&
      preference.usageType === "alternative",
  );
}

function getMainRoomIdsForClass(
  classId: string,
  context: SchedulerContext,
): string[] {
  return context.roomPreferences
    .filter(
      (preference) =>
        preference.classId === classId &&
        preference.usageType === "main" &&
        preference.isAllowed,
    )
    .map((preference) => preference.roomId);
}

function getClassesSharingMainRoom(
  classId: string,
  context: SchedulerContext,
): string[] {
  const mainRoomIds = getMainRoomIdsForClass(classId, context);

  if (mainRoomIds.length === 0) {
    return [classId];
  }

  const classIds = new Set<string>();

  for (const preference of context.roomPreferences) {
    if (
      preference.usageType === "main" &&
      preference.isAllowed &&
      mainRoomIds.includes(preference.roomId)
    ) {
      classIds.add(preference.classId);
    }
  }

  return Array.from(classIds);
}

function countHalfDayPlacements(
  classId: string,
  halfDay: string,
  placements: Placement[],
  context: SchedulerContext,
): number {
  let count = 0;

  for (const placement of placements) {
    if (placement.classId !== classId) {
      continue;
    }

    const period = getPeriodByIndex(placement.startPeriodIndex, context);

    if (period?.halfDay === halfDay) {
      count += 1;
    }
  }

  return count;
}

export function unbalancesSharedRoomRotation(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): boolean {
  const sharedClasses = getClassesSharingMainRoom(block.classId, context);

  if (sharedClasses.length <= 1) {
    return false;
  }

  const candidatePeriods = getPeriodsForCandidate(candidate, context);

  if (candidatePeriods.length === 0) {
    return false;
  }

  const candidateHalfDay = candidatePeriods[0].halfDay;

  const currentClassCount =
    countHalfDayPlacements(
      block.classId,
      candidateHalfDay,
      placements,
      context,
    ) + 1;

  const otherCounts = sharedClasses
    .filter((classId) => classId !== block.classId)
    .map((classId) =>
      countHalfDayPlacements(classId, candidateHalfDay, placements, context),
    );

  if (otherCounts.length === 0) {
    return false;
  }

  const averageOtherCount =
    otherCounts.reduce((total, value) => total + value, 0) / otherCounts.length;

  return currentClassCount > averageOtherCount + 2;
}

function getClassDayUnits(
  classId: string,
  dayIndex: number,
  placements: Placement[],
  context: SchedulerContext,
): number {
  return getOccupiedPeriodsForClassDay(classId, dayIndex, placements, context).size;
}

function getTeacherDayUnits(
  teacherId: string,
  dayIndex: number,
  placements: Placement[],
): number {
  return placements
    .filter((placement) => placement.teacherId === teacherId && placement.dayIndex === dayIndex)
    .reduce((total, placement) => total + placement.durationUnits, 0);
}

function getClassHalfDayUnits(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): number {
  const candidatePeriods = getPeriodsForCandidate(candidate, context);
  const halfDay = candidatePeriods[0]?.halfDay;

  if (!halfDay) {
    return 0;
  }

  const occupied = new Set<number>();

  for (const placement of placements) {
    if (placement.classId !== block.classId || placement.dayIndex !== candidate.dayIndex) {
      continue;
    }

    const period = getPeriodByIndex(placement.startPeriodIndex, context);

    if (period?.halfDay !== halfDay) {
      continue;
    }

    for (const periodIndex of getPlacementPeriodsSet(placement, context)) {
      occupied.add(periodIndex);
    }
  }

  return occupied.size;
}

function getEmptyHalfDayEdgePenalty(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): number {
  const candidatePeriods = getPeriodsForCandidate(candidate, context);
  const halfDay = candidatePeriods[0]?.halfDay;

  if (!halfDay || candidatePeriods.length === 0) {
    return 0;
  }

  // Si la classe a déjà des cours dans cette demi-journée, le calcul des trous
  // suffit. Si la demi-journée est encore vide, on évite de commencer au milieu,
  // car cela crée souvent des heures creuses plus tard.
  if (getClassHalfDayUnits(block, candidate, context, placements) > 0) {
    return 0;
  }

  const teachingIndexes = getTeachingPeriodIndexesForHalfDay(halfDay, context);
  const candidatePositions = candidatePeriods
    .map((period) => teachingIndexes.indexOf(period.periodIndex))
    .filter((position) => position >= 0);

  if (candidatePositions.length === 0) {
    return 0;
  }

  const firstCandidatePosition = Math.min(...candidatePositions);
  const lastCandidatePosition = Math.max(...candidatePositions);
  const distanceFromStart = firstCandidatePosition;
  const distanceFromEnd = teachingIndexes.length - 1 - lastCandidatePosition;

  return Math.min(distanceFromStart, distanceFromEnd);
}

function filterWhenPossible(
  candidates: CandidateSlot[],
  predicate: (candidate: CandidateSlot) => boolean,
): CandidateSlot[] {
  const filtered = candidates.filter(predicate);
  return filtered.length > 0 ? filtered : candidates;
}

function keepLowestGapCandidates(
  block: LessonBlock,
  candidates: CandidateSlot[],
  placements: Placement[],
  context: SchedulerContext,
): CandidateSlot[] {
  if (candidates.length <= 1) {
    return candidates;
  }

  const scored = candidates.map((candidate) => ({
    candidate,
    gaps: countProjectedStudentGaps(block, candidate, placements, context),
  }));
  const minGaps = Math.min(...scored.map((item) => item.gaps));

  return scored
    .filter((item) => item.gaps === minGaps)
    .map((item) => item.candidate);
}

export type CandidateScoringOptions = {
  seed?: number;
};

function hashText(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash >>> 0);
}

function getEnabledDayIndexes(context: SchedulerContext): number[] {
  return context.days
    .filter((day) => day.isEnabled)
    .map((day) => day.dayIndex)
    .sort((a, b) => a - b);
}

function getPreferredDayPenalty(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  seed: number,
): number {
  const dayIndexes = getEnabledDayIndexes(context);

  if (dayIndexes.length <= 1) {
    return 0;
  }

  const targetPosition =
    hashText(`${seed}:${block.classId}:${block.subjectId}:${block.blockOrder}`) %
    dayIndexes.length;
  const candidatePosition = dayIndexes.indexOf(candidate.dayIndex);

  if (candidatePosition < 0) {
    return 0;
  }

  const linearDistance = Math.abs(candidatePosition - targetPosition);
  const circularDistance = Math.min(
    linearDistance,
    dayIndexes.length - linearDistance,
  );

  return circularDistance * 10;
}

function countSubjectPlacedForClass(
  block: LessonBlock,
  placements: Placement[],
): number {
  return placements.filter(
    (placement) =>
      placement.classId === block.classId &&
      placement.subjectId === block.subjectId,
  ).length;
}

function getProjectedClassDayLoadPenalty(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): number {
  const dayIndexes = getEnabledDayIndexes(context);

  if (dayIndexes.length === 0) {
    return 0;
  }

  const dayLoads = dayIndexes.map((dayIndex) => {
    const current = getClassDayUnits(block.classId, dayIndex, placements, context);
    return dayIndex === candidate.dayIndex
      ? current + candidate.durationUnits
      : current;
  });

  const total = dayLoads.reduce((sum, value) => sum + value, 0);
  const average = total / dayLoads.length;
  const candidateLoad =
    dayLoads[dayIndexes.indexOf(candidate.dayIndex)] ?? candidate.durationUnits;

  return Math.max(0, candidateLoad - average) * 55;
}


function getTeachingPeriodIndexes(context: SchedulerContext): number[] {
  return context.periods
    .filter((period) => period.isTeachingPeriod)
    .sort((a, b) => a.periodIndex - b.periodIndex)
    .map((period) => period.periodIndex);
}

function getCandidatePrimaryHalfDay(
  candidate: CandidateSlot,
  context: SchedulerContext,
): HalfDay | null {
  return getPeriodsForCandidate(candidate, context)[0]?.halfDay ?? null;
}

function getCandidateStartPosition(
  candidate: CandidateSlot,
  context: SchedulerContext,
): number {
  const teachingIndexes = getTeachingPeriodIndexes(context);
  const position = teachingIndexes.indexOf(candidate.startPeriodIndex);
  return position >= 0 ? position : teachingIndexes.length;
}

function classHasCourseOnDay(
  classId: string,
  dayIndex: number,
  placements: Placement[],
): boolean {
  return placements.some(
    (placement) => placement.classId === classId && placement.dayIndex === dayIndex,
  );
}

function classHasCourseInHalfDay(
  classId: string,
  dayIndex: number,
  halfDay: HalfDay,
  placements: Placement[],
  context: SchedulerContext,
): boolean {
  return placements.some((placement) => {
    if (placement.classId !== classId || placement.dayIndex !== dayIndex) {
      return false;
    }

    return getPeriodByIndex(placement.startPeriodIndex, context)?.halfDay === halfDay;
  });
}

function isLateCandidate(candidate: CandidateSlot, context: SchedulerContext): boolean {
  const halfDay = getCandidatePrimaryHalfDay(candidate, context);
  const range = getCandidateTimeRange(candidate, context);

  return halfDay === "evening" || Boolean(range && range.start >= 15 * 60);
}

function startsEmptyClassDayOutsideMorning(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): boolean {
  if (classHasCourseOnDay(block.classId, candidate.dayIndex, placements)) {
    return false;
  }

  const halfDay = getCandidatePrimaryHalfDay(candidate, context);
  const range = getCandidateTimeRange(candidate, context);

  // On n'interdit pas l'après-midi. On évite surtout de créer une journée qui
  // commence en fin de journée ou en soirée.
  return halfDay === "evening" || Boolean(range && range.start >= 16 * 60);
}

function getProjectedClassDaySpreadPenalty(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): number {
  const teachingIndexes = getTeachingPeriodIndexes(context);
  const occupied = getOccupiedPeriodsForClassDay(
    block.classId,
    candidate.dayIndex,
    placements,
    context,
    candidate,
  );
  const positions = Array.from(occupied)
    .map((periodIndex) => teachingIndexes.indexOf(periodIndex))
    .filter((position) => position >= 0)
    .sort((a, b) => a - b);

  if (positions.length <= 1) {
    return getCandidateStartPosition(candidate, context) * 130;
  }

  const first = positions[0];
  const last = positions[positions.length - 1];
  const span = last - first + 1;
  const holesInsideDay = Math.max(0, span - positions.length);

  // Même sans double vacation, le moteur doit compacter les cours de la classe.
  // Les grands écarts entre matin/après-midi/soir créent les trous visibles sur les fiches.
  // On pénalise les trous plus que l'heure de début afin de ne pas bourrer mécaniquement les matinées.
  return holesInsideDay * 7200 + Math.max(0, span - 5) * 760 + last * 25;
}

function getLateDayPenalty(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): number {
  const halfDay = getCandidatePrimaryHalfDay(candidate, context);
  const range = getCandidateTimeRange(candidate, context);
  let penalty = getCandidateStartPosition(candidate, context) * 35;

  if (halfDay === "afternoon") {
    penalty += 120;
  }

  if (halfDay === "evening") {
    penalty += 28000;
  }

  if (range) {
    if (range.start >= 16 * 60) penalty += 18000;
    else if (range.start >= 15 * 60) penalty += 5200;
    else if (range.start >= 14 * 60) penalty += 420;
  }

  if (halfDay && !classHasCourseOnDay(block.classId, candidate.dayIndex, placements)) {
    // Une journée peut commencer l'après-midi si cela évite des trous.
    // En revanche, commencer une journée en fin de journée reste un très mauvais choix.
    if (halfDay === "afternoon") penalty += 180;
    if (halfDay === "evening") penalty += 24000;
  }

  if (
    halfDay === "evening" &&
    !classHasCourseInHalfDay(block.classId, candidate.dayIndex, halfDay, placements, context)
  ) {
    penalty += 22000;
  }

  return penalty;
}

function getLowestClassDaySpreadCandidates(
  block: LessonBlock,
  candidates: CandidateSlot[],
  placements: Placement[],
  context: SchedulerContext,
): CandidateSlot[] {
  if (candidates.length <= 1) {
    return candidates;
  }

  const scored = candidates.map((candidate) => ({
    candidate,
    spread: getProjectedClassDaySpreadPenalty(block, candidate, context, placements),
  }));
  const minSpread = Math.min(...scored.map((item) => item.spread));

  return scored
    .filter((item) => item.spread === minSpread)
    .map((item) => item.candidate);
}

function createsIsolatedHalfDay(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): boolean {
  const candidatePeriods = getPeriodsForCandidate(candidate, context);
  const halfDay = candidatePeriods[0]?.halfDay;

  if (!halfDay) {
    return false;
  }

  let projectedHalfDayUnits = candidate.durationUnits;

  for (const placement of placements) {
    if (placement.classId !== block.classId || placement.dayIndex !== candidate.dayIndex) {
      continue;
    }

    const period = getPeriodByIndex(placement.startPeriodIndex, context);

    if (period?.halfDay === halfDay) {
      projectedHalfDayUnits += placement.durationUnits;
    }
  }

  return candidate.durationUnits <= 1 && projectedHalfDayUnits <= 1;
}


function getSpecializedRoomFallbackPenalty(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
): number {
  if (!block.roomTypeRequired || !candidate.roomId) {
    return 0;
  }

  const room = context.rooms.find((item) => item.id === candidate.roomId);
  const specializedRoomExists = context.rooms.some(
    (item) => item.roomType === block.roomTypeRequired,
  );

  if (!room || room.roomType === block.roomTypeRequired || !specializedRoomExists) {
    return 0;
  }

  if (
    canUseOrdinaryRoomFallback(block.roomTypeRequired, context) &&
    isOrdinaryFallbackRoom(room.roomType)
  ) {
    // Le fallback est accepté, mais il doit rester un vrai dernier recours
    // seulement quand la ressource spécialisée existe réellement. Si un
    // établissement n’a pas de labo, la salle ordinaire est son fonctionnement normal.
    return 90000;
  }

  return 0;
}

function createsAfternoonEpsTerminalProblem(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): boolean {
  const candidateRange = getCandidateTimeRange(candidate, context);

  if (!candidateRange) {
    return false;
  }

  if (isAfternoonEpsCandidate(block, candidate, context)) {
    return placements.some((placement) => {
      if (placement.classId !== block.classId || placement.dayIndex !== candidate.dayIndex) {
        return false;
      }

      const placementRange = getCandidateTimeRange(
        {
          dayIndex: placement.dayIndex,
          startPeriodIndex: placement.startPeriodIndex,
          durationUnits: placement.durationUnits,
          roomId: placement.roomId ?? null,
        },
        context,
      );

      return Boolean(placementRange && placementRange.start >= candidateRange.end);
    });
  }

  return placements.some((placement) => {
    if (placement.classId !== block.classId || placement.dayIndex !== candidate.dayIndex) {
      return false;
    }

    if (!isEpsSubjectId(placement.subjectId, context)) {
      return false;
    }

    const epsRange = getCandidateTimeRange(
      {
        dayIndex: placement.dayIndex,
        startPeriodIndex: placement.startPeriodIndex,
        durationUnits: placement.durationUnits,
        roomId: placement.roomId ?? null,
      },
      context,
    );

    return Boolean(epsRange && epsRange.start >= 15 * 60 && candidateRange.start >= epsRange.end);
  });
}

export function scoreCandidate(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
  options: CandidateScoringOptions = {},
): number {
  let score = 0;

  const rules = getTerrainRules(context);
  const seed = options.seed ?? 0;

  score += getSpecializedRoomFallbackPenalty(block, candidate, context);
  score += getAceCandidatePenalty(block, candidate, context, placements);
  score += getLateDayPenalty(block, candidate, context, placements);
  score += getProjectedClassDaySpreadPenalty(block, candidate, context, placements);

  // Répartition réelle : éviter l’effet “je remplis le premier jour disponible”.
  score += getProjectedClassDayLoadPenalty(block, candidate, context, placements);
  score += getClassDayUnits(block.classId, candidate.dayIndex, placements, context) * 70;
  score += getClassHalfDayUnits(block, candidate, context, placements) * 44;
  score += getTeacherDayUnits(block.teacherId, candidate.dayIndex, placements) * 18;
  score += getPreferredDayPenalty(block, candidate, context, seed);

  // Plus une matière a déjà été placée pour la classe, plus on force son étalement.
  score += countSubjectPlacedForClass(block, placements) * 8;

  if (rules.avoidStudentGaps) {
    const currentGaps = countStudentGapsForClassDay(
      block.classId,
      candidate.dayIndex,
      placements,
      context,
    );
    const projectedGaps = countProjectedStudentGaps(
      block,
      candidate,
      placements,
      context,
    );

    score += projectedGaps * 9000;
    score += getEmptyHalfDayEdgePenalty(block, candidate, context, placements) * 850;

    if (projectedGaps > currentGaps) {
      score += (projectedGaps - currentGaps) * 45000;
    }
  }

  if (rules.avoidTeacherGaps && createsTeacherGap(block, candidate, placements, context)) {
    score += 650;
  }

  if (
    rules.avoidSingleHourReturn &&
    createsSingleHourReturn(block, candidate, context, placements)
  ) {
    score += 9000;
  }

  if (
    rules.avoidSingleHourReturn &&
    candidate.durationUnits <= 1 &&
    createsIsolatedHalfDay(block, candidate, context, placements)
  ) {
    score += 18000;
  }

  if (rules.balanceHalfDays && overloadsHalfDay(block, candidate, context, placements)) {
    score += 220;
  }

  if (
    rules.avoidHeavySubjectsBackToBack &&
    createsHeavySubjectSequence(block, candidate, context, placements)
  ) {
    score += 210;
  }

  if (rules.avoidSameSubjectSameDay && repeatsSubjectSameDay(block, candidate, placements)) {
    score += 2400;
  }

  if (rules.preferMainClassRoom && unbalancesSharedRoomRotation(block, candidate, context, placements)) {
    score += 160;
  }

  if (rules.preferMainClassRoom && usesAlternativeRoom(block, candidate, context)) {
    score += 35;
  }

  if (isEpsBlock(block, context)) {
    const overloadAmount = getEpsFieldOverloadAmount(block, candidate, context, placements);

    if (overloadAmount > 0) {
      // Un terrain EPS est partageable, mais selon la capacité déclarée par
      // l’établissement. Le dépassement reste possible en dernier recours afin
      // de ne pas supprimer le cours, mais il devient très coûteux et visible.
      score += overloadAmount * 95000;
    }

    const sameFieldUsage = countEpsPlacementsOnFieldForCandidate(
      candidate.roomId,
      candidate,
      placements,
      context,
    );

    // Répartir les cours EPS sur Terrain 1, Terrain 2, etc. au lieu de tout
    // entasser sur le premier terrain trouvé.
    score += sameFieldUsage * 1200;
  }

  if (
    isEpsBlock(block, context) &&
    rules.epsHotHourMode !== "disabled" &&
    !isEpsCandidateFavorable(block, candidate, context)
  ) {
    score += rules.epsHotHourMode === "strict" ? 60000 : 12000;
  }

  if (
    isEpsBlock(block, context) &&
    rules.epsHotHourMode !== "disabled" &&
    isEpsCandidateFavorable(block, candidate, context)
  ) {
    score -= 2500;
  }

  if (createsAfternoonEpsTerminalProblem(block, candidate, context, placements)) {
    score += 70000;
  }

  return score;
}

export function chooseBestCandidate(
  block: LessonBlock,
  candidates: CandidateSlot[],
  context: SchedulerContext,
  placements: Placement[],
  options: CandidateScoringOptions = {},
): CandidateSlot | null {
  if (candidates.length === 0) {
    return null;
  }

  const rules = getTerrainRules(context);
  let viable = [...candidates];

  // Ces filtres ne bloquent jamais inutilement : ils s’appliquent seulement
  // lorsqu’une alternative existe. Cela transforme les règles terrain en vrai
  // comportement moteur, sans devenir des normes administratives rigides.
  viable = filterWhenPossible(
    viable,
    (candidate) => !startsEmptyClassDayOutsideMorning(block, candidate, context, placements),
  );

  viable = filterWhenPossible(
    viable,
    (candidate) => !isLateCandidate(candidate, context),
  );

  // Règle ACE prioritaire : une matière peut former un bloc consécutif,
  // mais elle ne doit pas revenir plus tard dans la même journée si une
  // autre position existe. Ce filtre passe avant le compactage, sinon le
  // moteur peut choisir un créneau “compact” mais pédagogiquement faux.
  viable = filterWhenPossible(
    viable,
    (candidate) => !hasAceSeparatedSameSubjectSameDay(block, candidate, placements),
  );

  viable = getLowestClassDaySpreadCandidates(block, viable, placements, context);

  if (isEpsBlock(block, context) && rules.epsHotHourMode !== "disabled") {
    viable = filterWhenPossible(
      viable,
      (candidate) => isEpsCandidateFavorable(block, candidate, context),
    );
  }

  if (rules.avoidSameSubjectSameDay) {
    viable = filterWhenPossible(
      viable,
      (candidate) => !repeatsSubjectSameDay(block, candidate, placements),
    );
  }

  if (rules.avoidStudentGaps) {
    viable = filterWhenPossible(
      viable,
      (candidate) => !createsStudentGap(block, candidate, placements, context),
    );

    viable = keepLowestGapCandidates(block, viable, placements, context);

    viable = filterWhenPossible(
      viable,
      (candidate) =>
        getEmptyHalfDayEdgePenalty(block, candidate, context, placements) === 0,
    );
  }

  if (rules.avoidSingleHourReturn) {
    viable = filterWhenPossible(
      viable,
      (candidate) => !createsSingleHourReturn(block, candidate, context, placements),
    );

    viable = filterWhenPossible(
      viable,
      (candidate) =>
        candidate.durationUnits > 1 ||
        !createsIsolatedHalfDay(block, candidate, context, placements),
    );
  }

  if (rules.avoidHeavySubjectsBackToBack) {
    viable = filterWhenPossible(
      viable,
      (candidate) => !createsHeavySubjectSequence(block, candidate, context, placements),
    );
  }

  const scored = viable
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(block, candidate, context, placements, options),
    }))
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }

      if (a.candidate.startPeriodIndex !== b.candidate.startPeriodIndex) {
        return a.candidate.startPeriodIndex - b.candidate.startPeriodIndex;
      }

      const seed = options.seed ?? 0;
      const aHash = hashText(
        `${seed}:${block.id}:${a.candidate.dayIndex}:${a.candidate.startPeriodIndex}:${a.candidate.roomId ?? ""}`,
      );
      const bHash = hashText(
        `${seed}:${block.id}:${b.candidate.dayIndex}:${b.candidate.startPeriodIndex}:${b.candidate.roomId ?? ""}`,
      );

      return aHash - bHash;
    });

  return scored[0].candidate;
}
