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
  getTerrainRules,
  isAfternoonEpsCandidate,
  isEpsBlock,
  isEpsSubjectId,
  isOrdinaryFallbackRoom,
  isSharedSportsFieldRoom,
} from "./terrainRules";

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
  // EPS : un terrain est une zone pédagogique partageable.
  // On ne bloque plus un placement parce qu’un autre EPS occupe déjà ce terrain :
  // la capacité déclarée par l’établissement est contrôlée par le score et par
  // le diagnostic visuel. Cela évite de laisser EPS dehors pour une simple
  // surcharge pédagogique qui peut être coloriée et corrigée ensuite.
  if (isSharedSportsFieldRoom(roomId, context)) {
    return false;
  }

  return placements.some((placement) => {
    if (placement.roomId !== roomId || !periodsOverlap(placement, candidate)) {
      return false;
    }

    // Sécurité si un ancien placement EPS existe déjà dans le résultat.
    if (isSharedSportsFieldRoom(placement.roomId, context)) {
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
  if (!block.roomTypeRequired) {
    return true;
  }

  if (!candidate.roomId) {
    return false;
  }

  const room = context.rooms.find((item) => item.id === candidate.roomId);

  if (!room) {
    return false;
  }

  if (room.roomType === block.roomTypeRequired) {
    return true;
  }

  return (
    canUseOrdinaryRoomFallback(block.roomTypeRequired, context) &&
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

  // EPS hors plage favorable n’est plus un blocage absolu : le moteur
  // privilégie les bons créneaux par le score, puis colore la case si un
  // placement moins idéal est nécessaire pour garder le cours obligatoire.

  // EPS après-midi terminal : ce n’est plus un blocage absolu ici.
  // Le moteur le pénalise fortement et la grille colore la case si le placement
  // reste nécessaire. On évite ainsi de laisser un cours EPS obligatoire dehors
  // alors qu’aucun conflit classe/professeur/salle n’existe.
  void violatesAfternoonEpsTerminalRule;

  return true;
}