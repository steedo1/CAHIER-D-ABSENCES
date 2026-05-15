import type {
  CandidateSlot,
  LessonBlock,
  Placement,
  SchedulerContext,
  SessionPeriod,
} from "./types";
import {
  canUseOrdinaryRoomFallback,
  candidateHitsClosedSchoolPeriod,
  getCandidateTimeRange,
  getEffectiveRoomTypeRequired,
  getEpsMaxSimultaneousCoursesPerField,
  getTerrainRules,
  isAfternoonEpsCandidate,
  isEpsBlock,
  isEpsCandidateFavorable,
  isEpsSubjectId,
  isOrdinaryFallbackRoom,
  isSharedSportsFieldRoom,
} from "./terrainRules";
import { parseSplitPattern } from "./utils";

function durationToPeriodCount(durationUnits: number): number {
  return Math.ceil(durationUnits);
}

export function getPeriodsForCandidate(
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

  const periodCount = durationToPeriodCount(candidate.durationUnits);

  return teachingPeriods.slice(startIndex, startIndex + periodCount);
}

export function canFitDuration(
  startPeriodIndex: number,
  durationUnits: number,
  context: SchedulerContext,
): boolean {
  const candidate: CandidateSlot = {
    dayIndex: 0,
    startPeriodIndex,
    durationUnits,
  };

  const periods = getPeriodsForCandidate(candidate, context);
  const expectedCount = durationToPeriodCount(durationUnits);

  if (periods.length !== expectedCount) {
    return false;
  }

  const firstHalfDay = periods[0]?.halfDay;

  return periods.every(
    (period) => period.isTeachingPeriod && period.halfDay === firstHalfDay,
  );
}

function getPlacementEndPeriodIndex(placement: Placement): number {
  return placement.startPeriodIndex + durationToPeriodCount(placement.durationUnits);
}

function getCandidateEndPeriodIndex(candidate: CandidateSlot): number {
  return candidate.startPeriodIndex + durationToPeriodCount(candidate.durationUnits);
}

function getMaxContiguousUnitsForSubject(block: LessonBlock, context: SchedulerContext): number {
  const values = context.serviceAssignments
    .filter((assignment) => assignment.classId === block.classId && assignment.subjectId === block.subjectId)
    .flatMap((assignment) => {
      try {
        return parseSplitPattern(assignment.splitPattern);
      } catch {
        return [];
      }
    })
    .filter((value) => Number.isFinite(value) && value > 0);

  return Math.max(block.durationUnits, ...values, 1);
}

function sameSubjectIntervalsWithCandidate(
  block: LessonBlock,
  candidate: CandidateSlot,
  placements: Placement[],
): Array<{ start: number; end: number; isCandidate: boolean }> {
  const intervals = placements
    .filter(
      (placement) =>
        placement.classId === block.classId &&
        placement.subjectId === block.subjectId &&
        placement.dayIndex === candidate.dayIndex,
    )
    .map((placement) => ({
      start: placement.startPeriodIndex,
      end: getPlacementEndPeriodIndex(placement),
      isCandidate: false,
    }));

  intervals.push({
    start: candidate.startPeriodIndex,
    end: getCandidateEndPeriodIndex(candidate),
    isCandidate: true,
  });

  return intervals.sort((a, b) => a.start - b.start);
}

export function violatesSameSubjectSplitPattern(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): boolean {
  const sameSubjectAlreadyPlaced = placements.some(
    (placement) =>
      placement.classId === block.classId &&
      placement.subjectId === block.subjectId &&
      placement.dayIndex === candidate.dayIndex,
  );

  if (!sameSubjectAlreadyPlaced) {
    return false;
  }

  const intervals = sameSubjectIntervalsWithCandidate(block, candidate, placements);
  const maxContiguousUnits = getMaxContiguousUnitsForSubject(block, context);
  const groups: Array<{ start: number; end: number; hasCandidate: boolean }> = [];

  for (const interval of intervals) {
    const last = groups[groups.length - 1];

    if (!last || interval.start > last.end) {
      groups.push({ start: interval.start, end: interval.end, hasCandidate: interval.isCandidate });
      continue;
    }

    last.end = Math.max(last.end, interval.end);
    last.hasCandidate = last.hasCandidate || interval.isCandidate;
  }

  // Deux séances séparées de la même matière le même jour ne sont pas acceptées.
  if (groups.length > 1) {
    return true;
  }

  const candidateGroup = groups.find((group) => group.hasCandidate);
  if (!candidateGroup) {
    return false;
  }

  // Même lorsque les séances se touchent, on refuse de dépasser le plus grand
  // morceau prévu par le découpage. Exemple : 2+1+1 autorise 2h, pas 3h d’affilée.
  return candidateGroup.end - candidateGroup.start > Math.ceil(maxContiguousUnits);
}


export function periodsOverlap(
  placement: Placement,
  candidate: CandidateSlot,
): boolean {
  if (placement.dayIndex !== candidate.dayIndex) {
    return false;
  }

  const placementStart = placement.startPeriodIndex;
  const placementEnd = getPlacementEndPeriodIndex(placement);
  const candidateStart = candidate.startPeriodIndex;
  const candidateEnd = getCandidateEndPeriodIndex(candidate);

  return placementStart < candidateEnd && candidateStart < placementEnd;
}

export function hasClassConflict(
  classId: string,
  candidate: CandidateSlot,
  placements: Placement[],
): boolean {
  return placements.some(
    (placement) =>
      placement.classId === classId && periodsOverlap(placement, candidate),
  );
}

export function hasTeacherConflict(
  teacherId: string,
  candidate: CandidateSlot,
  placements: Placement[],
): boolean {
  return placements.some(
    (placement) =>
      placement.teacherId === teacherId && periodsOverlap(placement, candidate),
  );
}

export function hasRoomConflict(
  roomId: string,
  candidate: CandidateSlot,
  placements: Placement[],
  context: SchedulerContext,
): boolean {
  if (isSharedSportsFieldRoom(roomId, context)) {
    const capacity = getEpsMaxSimultaneousCoursesPerField(context);
    const overlappingEpsOnField = placements.filter(
      (placement) =>
        placement.roomId === roomId &&
        periodsOverlap(placement, candidate) &&
        isEpsSubjectId(placement.subjectId, context),
    ).length;

    return overlappingEpsOnField >= capacity;
  }

  return placements.some((placement) => {
    if (placement.roomId !== roomId || !periodsOverlap(placement, candidate)) {
      return false;
    }

    return true;
  });
}

export function teacherIsStrictlyUnavailable(
  teacherId: string,
  candidate: CandidateSlot,
  context: SchedulerContext,
): boolean {
  const candidatePeriods = getPeriodsForCandidate(candidate, context);

  return context.teacherUnavailability.some((unavailability) => {
    if (unavailability.teacherId !== teacherId) {
      return false;
    }

    if (unavailability.constraintType !== "strict") {
      return false;
    }

    if (unavailability.dayIndex !== candidate.dayIndex) {
      return false;
    }

    if (typeof unavailability.periodIndex === "number") {
      return candidatePeriods.some(
        (period) => period.periodIndex === unavailability.periodIndex,
      );
    }

    if (unavailability.halfDay) {
      return candidatePeriods.some(
        (period) => period.halfDay === unavailability.halfDay,
      );
    }

    return false;
  });
}

export function breakCutsBlock(
  candidate: CandidateSlot,
  context: SchedulerContext,
): boolean {
  const periods = getPeriodsForCandidate(candidate, context);

  if (periods.length <= 1) {
    return false;
  }

  return periods.slice(0, -1).some((period) => period.isBreakAfter);
}

export function roomMatchesRequirement(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
): boolean {
  const requiredRoomType = getEffectiveRoomTypeRequired(block, context);

  if (!requiredRoomType) {
    return true;
  }

  if (!candidate.roomId) {
    return false;
  }

  const room = context.rooms.find((item) => item.id === candidate.roomId);

  if (!room) {
    return false;
  }

  if (room.roomType === requiredRoomType) {
    return true;
  }

  return (
    canUseOrdinaryRoomFallback(requiredRoomType, context) &&
    isOrdinaryFallbackRoom(room.roomType)
  );
}


function violatesAfternoonEpsTerminalRule(
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

export function respectsHardRules(
  block: LessonBlock,
  candidate: CandidateSlot,
  context: SchedulerContext,
  placements: Placement[],
): boolean {
  const terrainRules = getTerrainRules(context);

  if (candidateHitsClosedSchoolPeriod(candidate, context)) {
    return false;
  }

  if (hasClassConflict(block.classId, candidate, placements)) {
    return false;
  }

  if (hasTeacherConflict(block.teacherId, candidate, placements)) {
    return false;
  }

  if (candidate.roomId && hasRoomConflict(candidate.roomId, candidate, placements, context)) {
    return false;
  }

  if (teacherIsStrictlyUnavailable(block.teacherId, candidate, context)) {
    return false;
  }

  if (
    terrainRules.avoidBreakInsideMultiPeriodBlock &&
    breakCutsBlock(candidate, context)
  ) {
    return false;
  }

  if (!roomMatchesRequirement(block, candidate, context)) {
    return false;
  }

  if (
    terrainRules.avoidSameSubjectSameDay &&
    violatesSameSubjectSplitPattern(block, candidate, context, placements)
  ) {
    return false;
  }

  // ACE / terrain : en mode strict, EPS ne doit pas tomber dans les heures chaudes.
  // Si aucune place favorable n'existe, le bloc restera non placé et apparaîtra en
  // diagnostic au lieu de produire un emploi du temps absurde (EPS 10h-12h).
  if (
    terrainRules.epsHotHourMode === "strict" &&
    isEpsBlock(block, context) &&
    !isEpsCandidateFavorable(block, candidate, context)
  ) {
    return false;
  }

  if (violatesAfternoonEpsTerminalRule(block, candidate, context, placements)) {
    return false;
  }

  return true;
}