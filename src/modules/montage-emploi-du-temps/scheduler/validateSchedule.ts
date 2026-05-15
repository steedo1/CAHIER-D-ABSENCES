import type {
  CandidateSlot,
  GenerationWarning,
  HalfDay,
  LessonBlock,
  Placement,
  SchedulerContext,
  SessionPeriod,
} from "./types";
import { breakCutsBlock, roomMatchesRequirement } from "./hardRules";
import { getAceTeacherLevelWarnings } from "./aceRules";
import {
  canUseOrdinaryRoomFallback,
  candidateHitsClosedSchoolPeriod,
  getCandidateTimeRange,
  getEpsMaxSimultaneousCoursesPerField,
  getTerrainRules,
  isEpsBlock,
  isEpsCandidateFavorable,
  isEpsSubjectId,
  isOrdinaryFallbackRoom,
  isSharedSportsFieldRoom,
} from "./terrainRules";
import { isPcSvtTandemPlacementPair } from "./tandemScience";
import { createId, parseSplitPattern } from "./utils";

function placementOverlaps(a: Placement, b: Placement): boolean {
  if (a.dayIndex !== b.dayIndex) {
    return false;
  }

  const aStart = a.startPeriodIndex;
  const aEnd = a.startPeriodIndex + Math.ceil(a.durationUnits);

  const bStart = b.startPeriodIndex;
  const bEnd = b.startPeriodIndex + Math.ceil(b.durationUnits);

  return aStart < bEnd && bStart < aEnd;
}


function getRoomLabel(roomId: string | null | undefined, context: SchedulerContext): string {
  if (!roomId) {
    return "Espace non renseigné";
  }

  return context.rooms.find((room) => room.id === roomId)?.name ?? roomId;
}

function getDayLabel(dayIndex: number, context: SchedulerContext): string {
  return context.days.find((day) => day.dayIndex === dayIndex)?.label ?? `jour ${dayIndex}`;
}

function getPeriodLabel(periodIndex: number, context: SchedulerContext): string {
  const period = context.periods.find((item) => item.periodIndex === periodIndex);
  return period ? `${period.startTime}-${period.endTime}` : `créneau ${periodIndex}`;
}

function makeWarning(
  severity: GenerationWarning["severity"],
  warningType: string,
  message: string,
  extra?: Partial<GenerationWarning>,
): GenerationWarning {
  return {
    id: createId("warning"),
    severity,
    warningType,
    message,
    ...extra,
  };
}

function getBlockForPlacement(
  placement: Placement,
  context: SchedulerContext,
  lessonBlocks: LessonBlock[] = [],
): LessonBlock {
  // Le bloc généré contient la vraie exigence de salle pour ce fragment précis.
  const generatedBlock = lessonBlocks.find(
    (block) => block.id === placement.lessonBlockId,
  );

  if (generatedBlock) {
    return {
      ...generatedBlock,
      durationUnits: placement.durationUnits,
      status: "placed",
    };
  }

  const assignment = context.serviceAssignments.find(
    (item) =>
      item.classId === placement.classId &&
      item.teacherId === placement.teacherId &&
      item.subjectId === placement.subjectId,
  );

  return {
    id: placement.lessonBlockId,
    serviceAssignmentId: assignment?.id ?? "manual",
    classId: placement.classId,
    teacherId: placement.teacherId,
    subjectId: placement.subjectId,
    durationUnits: placement.durationUnits,
    blockOrder: 1,
    blockType: placement.durationUnits >= 2 ? "double" : "normal",
    roomTypeRequired: assignment?.roomTypeRequired ?? null,
    status: "placed",
  };
}

function getCandidateForPlacement(placement: Placement): CandidateSlot {
  return {
    dayIndex: placement.dayIndex,
    startPeriodIndex: placement.startPeriodIndex,
    durationUnits: placement.durationUnits,
    roomId: placement.roomId ?? null,
  };
}


function placementCandidate(placement: Placement): CandidateSlot {
  return {
    dayIndex: placement.dayIndex,
    startPeriodIndex: placement.startPeriodIndex,
    durationUnits: placement.durationUnits,
    roomId: placement.roomId ?? null,
  };
}

function hasCourseAfterAfternoonEps(
  epsPlacement: Placement,
  placements: Placement[],
  context: SchedulerContext,
): boolean {
  if (!isEpsSubjectId(epsPlacement.subjectId, context)) {
    return false;
  }

  const epsRange = getCandidateTimeRange(placementCandidate(epsPlacement), context);

  if (!epsRange || epsRange.start < 15 * 60) {
    return false;
  }

  return placements.some((placement) => {
    if (
      placement.id === epsPlacement.id ||
      placement.classId !== epsPlacement.classId ||
      placement.dayIndex !== epsPlacement.dayIndex
    ) {
      return false;
    }

    const range = getCandidateTimeRange(placementCandidate(placement), context);

    return Boolean(range && range.start >= epsRange.end);
  });
}

function getPeriodByIndex(
  periodIndex: number,
  context: SchedulerContext,
): SessionPeriod | undefined {
  return context.periods.find((period) => period.periodIndex === periodIndex);
}

function getClassLabel(classId: string | null | undefined, context: SchedulerContext): string {
  if (!classId) {
    return "Classe inconnue";
  }

  const schoolClass = context.classes.find((item) => item.id === classId);
  return schoolClass?.shortName || schoolClass?.name || classId;
}

function getSubjectLabel(subjectId: string | null | undefined, context: SchedulerContext): string {
  if (!subjectId) {
    return "Matière inconnue";
  }

  const subject = context.subjects.find((item) => item.id === subjectId);
  return subject?.shortName || subject?.name || subjectId;
}

function getTeacherLabel(teacherId: string | null | undefined, context: SchedulerContext): string {
  if (!teacherId) {
    return "Professeur non renseigné";
  }

  const teacher = context.teachers.find((item) => item.id === teacherId);
  return teacher?.shortName || teacher?.fullName || teacherId;
}

function describePlacement(placement: Placement, context: SchedulerContext): string {
  return `${getClassLabel(placement.classId, context)} — ${getSubjectLabel(placement.subjectId, context)} — ${getTeacherLabel(placement.teacherId, context)}`;
}

function describeBlock(block: LessonBlock, context: SchedulerContext): string {
  return `${getClassLabel(block.classId, context)} — ${getSubjectLabel(block.subjectId, context)} — ${getTeacherLabel(block.teacherId, context)}`;
}

function getPlacementPeriodIndexes(placement: Placement): number[] {
  const indexes: number[] = [];

  for (let offset = 0; offset < Math.ceil(placement.durationUnits); offset += 1) {
    indexes.push(placement.startPeriodIndex + offset);
  }

  return indexes;
}

function getPlacementEndPeriodIndex(placement: Placement): number {
  return placement.startPeriodIndex + Math.ceil(placement.durationUnits);
}

function getMaxContiguousUnitsForClassSubject(
  classId: string,
  subjectId: string,
  context: SchedulerContext,
): number {
  const values = context.serviceAssignments
    .filter((assignment) => assignment.classId === classId && assignment.subjectId === subjectId)
    .flatMap((assignment) => {
      try {
        return parseSplitPattern(assignment.splitPattern);
      } catch {
        return [];
      }
    })
    .filter((value) => Number.isFinite(value) && value > 0);

  return Math.max(...values, 1);
}

function getContinuousGroupSpan(group: Placement[]): number {
  if (group.length === 0) return 0;
  const start = Math.min(...group.map((placement) => placement.startPeriodIndex));
  const end = Math.max(...group.map(getPlacementEndPeriodIndex));
  return end - start;
}


function groupContinuousPlacements(placements: Placement[]): Placement[][] {
  const sorted = [...placements].sort(
    (a, b) => a.startPeriodIndex - b.startPeriodIndex,
  );
  const groups: Placement[][] = [];
  let currentGroup: Placement[] = [];
  let currentEnd = -1;

  for (const placement of sorted) {
    const placementEnd = getPlacementEndPeriodIndex(placement);

    if (currentGroup.length === 0 || placement.startPeriodIndex > currentEnd) {
      currentGroup = [placement];
      groups.push(currentGroup);
      currentEnd = placementEnd;
      continue;
    }

    currentGroup.push(placement);
    currentEnd = Math.max(currentEnd, placementEnd);
  }

  return groups;
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

function getTeachingPeriodIndexesForHalfDay(
  halfDay: HalfDay,
  context: SchedulerContext,
): number[] {
  return context.periods
    .filter((period) => period.isTeachingPeriod && period.halfDay === halfDay)
    .sort((a, b) => a.periodIndex - b.periodIndex)
    .map((period) => period.periodIndex);
}

function countGapsInsideHalfDay(
  periodIndexes: number[],
  halfDay: HalfDay,
  context: SchedulerContext,
): number {
  const occupied = new Set(periodIndexes);
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
  periodIndexes: number[],
  context: SchedulerContext,
): number {
  return getHalfDays(context).reduce(
    (total, halfDay) => total + countGapsInsideHalfDay(periodIndexes, halfDay, context),
    0,
  );
}

type ClassGapDetail = {
  classId: string;
  dayIndex: number;
  halfDay: HalfDay;
  gapCount: number;
};

function getClassGapDetails(
  placements: Placement[],
  context: SchedulerContext,
): ClassGapDetail[] {
  const details: ClassGapDetail[] = [];
  const enabledDayIndexes = context.days
    .filter((day) => day.isEnabled)
    .map((day) => day.dayIndex);

  for (const schoolClass of context.classes) {
    for (const dayIndex of enabledDayIndexes) {
      const dayPlacements = placements.filter(
        (placement) =>
          placement.classId === schoolClass.id && placement.dayIndex === dayIndex,
      );

      for (const halfDay of getHalfDays(context)) {
        const periodIndexes = dayPlacements
          .filter((placement) => getPeriodByIndex(placement.startPeriodIndex, context)?.halfDay === halfDay)
          .flatMap(getPlacementPeriodIndexes);
        const gapCount = countGapsInsideHalfDay(periodIndexes, halfDay, context);

        if (gapCount > 0) {
          details.push({
            classId: schoolClass.id,
            dayIndex,
            halfDay,
            gapCount,
          });
        }
      }
    }
  }

  return details;
}

type SingleHourReturnDetail = {
  classId: string;
  dayIndex: number;
  halfDay: HalfDay;
};

function getSingleHourReturnDetails(
  placements: Placement[],
  context: SchedulerContext,
): SingleHourReturnDetail[] {
  const details: SingleHourReturnDetail[] = [];
  const enabledDayIndexes = context.days
    .filter((day) => day.isEnabled)
    .map((day) => day.dayIndex);

  for (const schoolClass of context.classes) {
    for (const dayIndex of enabledDayIndexes) {
      const dayPlacements = placements.filter(
        (placement) =>
          placement.classId === schoolClass.id && placement.dayIndex === dayIndex,
      );

      for (const halfDay of getHalfDays(context)) {
        const periodIndexes = new Set(
          dayPlacements
            .filter((placement) => getPeriodByIndex(placement.startPeriodIndex, context)?.halfDay === halfDay)
            .flatMap(getPlacementPeriodIndexes),
        );

        if (periodIndexes.size === 1) {
          details.push({ classId: schoolClass.id, dayIndex, halfDay });
        }
      }
    }
  }

  return details;
}

function getClassDayUnits(
  classId: string,
  dayIndex: number,
  placements: Placement[],
): number {
  const periodIndexes = new Set<number>();

  for (const placement of placements) {
    if (placement.classId !== classId || placement.dayIndex !== dayIndex) {
      continue;
    }

    for (const periodIndex of getPlacementPeriodIndexes(placement)) {
      periodIndexes.add(periodIndex);
    }
  }

  return periodIndexes.size;
}

function getClassHalfDayUnits(
  classId: string,
  dayIndex: number,
  halfDay: string,
  placements: Placement[],
  context: SchedulerContext,
): number {
  const periodIndexes = new Set<number>();

  for (const placement of placements) {
    if (placement.classId !== classId || placement.dayIndex !== dayIndex) {
      continue;
    }

    const period = getPeriodByIndex(placement.startPeriodIndex, context);

    if (period?.halfDay !== halfDay) {
      continue;
    }

    for (const periodIndex of getPlacementPeriodIndexes(placement)) {
      periodIndexes.add(periodIndex);
    }
  }

  return periodIndexes.size;
}

function subjectIsHeavy(subjectId: string, context: SchedulerContext): boolean {
  return Boolean(context.subjects.find((subject) => subject.id === subjectId)?.isHeavy);
}

function countSoftQualityPenalty(
  placements: Placement[],
  context: SchedulerContext,
): number {
  const rules = getTerrainRules(context);
  const enabledDayIndexes = context.days
    .filter((day) => day.isEnabled)
    .map((day) => day.dayIndex);
  const halfDays = Array.from(new Set(context.periods.map((period) => period.halfDay)));

  let penalty = 0;


  for (const schoolClass of context.classes) {
    const classPlacements = placements.filter(
      (placement) => placement.classId === schoolClass.id,
    );

    const totalUnits = enabledDayIndexes.reduce(
      (total, dayIndex) =>
        total + getClassDayUnits(schoolClass.id, dayIndex, placements),
      0,
    );
    const expectedDayUnits = enabledDayIndexes.length > 0
      ? totalUnits / enabledDayIndexes.length
      : 0;

    for (const dayIndex of enabledDayIndexes) {
      const dayPlacements = classPlacements.filter(
        (placement) => placement.dayIndex === dayIndex,
      );
      const dayUnits = getClassDayUnits(schoolClass.id, dayIndex, placements);

      if (rules.balanceHalfDays) {
        penalty += Math.round(Math.pow(dayUnits - expectedDayUnits, 2) * 22);
      }

      if (rules.avoidStudentGaps) {
        const periodIndexes = dayPlacements.flatMap(getPlacementPeriodIndexes);
        penalty += countGapsInsideDay(periodIndexes, context) * 1200;
      }

      if (rules.avoidSingleHourReturn) {
        for (const halfDay of halfDays) {
          const halfDayUnits = getClassHalfDayUnits(
            schoolClass.id,
            dayIndex,
            halfDay,
            placements,
            context,
          );

          if (halfDayUnits === 1) {
            penalty += 2200;
          } else if (halfDayUnits > 0 && halfDayUnits <= 1 && dayUnits > halfDayUnits) {
            penalty += 130;
          }
        }
      }

      if (rules.avoidSameSubjectSameDay) {
        const subjectCounts = new Map<string, number>();
        for (const placement of dayPlacements) {
          subjectCounts.set(
            placement.subjectId,
            (subjectCounts.get(placement.subjectId) ?? 0) + 1,
          );
        }

        for (const count of subjectCounts.values()) {
          if (count > 1) {
            penalty += (count - 1) * 320;
          }
        }
      }

      if (rules.avoidHeavySubjectsBackToBack) {
        const sorted = [...dayPlacements].sort(
          (a, b) => a.startPeriodIndex - b.startPeriodIndex,
        );

        for (let index = 0; index < sorted.length - 1; index += 1) {
          const current = sorted[index];
          const next = sorted[index + 1];
          const currentEnd = current.startPeriodIndex + Math.ceil(current.durationUnits);

          if (
            currentEnd === next.startPeriodIndex &&
            subjectIsHeavy(current.subjectId, context) &&
            subjectIsHeavy(next.subjectId, context)
          ) {
            penalty += 110;
          }
        }
      }
    }
  }

  return penalty;
}

export function validateSchedule(
  placements: Placement[],
  unplacedBlocks: LessonBlock[],
  context: SchedulerContext,
  lessonBlocks: LessonBlock[] = [],
): GenerationWarning[] {
  const warnings: GenerationWarning[] = [];
  const rules = getTerrainRules(context);

  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const first = placements[i];
      const second = placements[j];

      if (!placementOverlaps(first, second)) {
        continue;
      }

      if (
        first.classId === second.classId &&
        !isPcSvtTandemPlacementPair(first, second, context)
      ) {
        warnings.push(
          makeWarning(
            "critical",
            "class_conflict",
            "Une classe a deux cours placés au même moment.",
            { classId: first.classId },
          ),
        );
      }

      if (first.teacherId === second.teacherId) {
        warnings.push(
          makeWarning(
            "critical",
            "teacher_conflict",
            "Un professeur a deux cours placés au même moment.",
            { teacherId: first.teacherId },
          ),
        );
      }

      if (
        first.roomId &&
        second.roomId &&
        first.roomId === second.roomId &&
        !isSharedSportsFieldRoom(first.roomId, context)
      ) {
        warnings.push(
          makeWarning(
            "critical",
            "room_conflict",
            "Une salle spécialisée est utilisée par deux classes au même moment.",
            { roomId: first.roomId },
          ),
        );
      }
    }
  }


  const epsCapacityWarnings = new Set<string>();
  const epsCapacityPerField = getEpsMaxSimultaneousCoursesPerField(context);

  for (const room of context.rooms.filter((item) => item.roomType === "sports_field")) {
    for (const day of context.days.filter((item) => item.isEnabled)) {
      for (const period of context.periods.filter((item) => item.isTeachingPeriod)) {
        const usage = placements.filter(
          (placement) =>
            placement.roomId === room.id &&
            isEpsSubjectId(placement.subjectId, context) &&
            placementOverlaps(
              placement,
              {
                id: `slot-${room.id}-${day.dayIndex}-${period.periodIndex}`,
                lessonBlockId: "slot",
                classId: "slot",
                teacherId: "slot",
                subjectId: "eps",
                roomId: room.id,
                dayIndex: day.dayIndex,
                startPeriodIndex: period.periodIndex,
                durationUnits: 1,
                placedBy: "auto",
              },
            ),
        );

        if (usage.length <= epsCapacityPerField) {
          continue;
        }

        const key = `${room.id}::${day.dayIndex}::${period.periodIndex}`;

        if (epsCapacityWarnings.has(key)) {
          continue;
        }

        epsCapacityWarnings.add(key);
        warnings.push(
          makeWarning(
            "warning",
            "eps_field_over_capacity",
            `${getRoomLabel(room.id, context)} — ${getDayLabel(day.dayIndex, context)} ${getPeriodLabel(period.periodIndex, context)} : ${usage.length} cours EPS simultanés pour une capacité déclarée de ${epsCapacityPerField}. Case(s) à vérifier.`,
            { roomId: room.id },
          ),
        );
      }
    }
  }

  for (const placement of placements) {
    const block = getBlockForPlacement(placement, context, lessonBlocks);
    const candidate = getCandidateForPlacement(placement);

    if (candidateHitsClosedSchoolPeriod(candidate, context)) {
      warnings.push(
        makeWarning(
          "critical",
          "school_closed_period",
          "Un cours est placé sur une plage fermée de l’établissement.",
          {
            lessonBlockId: placement.lessonBlockId,
            classId: placement.classId,
            teacherId: placement.teacherId,
          },
        ),
      );
    }

    if (rules.avoidBreakInsideMultiPeriodBlock && breakCutsBlock(candidate, context)) {
      warnings.push(
        makeWarning(
          "critical",
          "break_cut_block",
          "Un bloc de cours traverse une récréation. Ce placement doit être corrigé.",
          {
            lessonBlockId: placement.lessonBlockId,
            classId: placement.classId,
            teacherId: placement.teacherId,
          },
        ),
      );
    }

    if (
      isEpsBlock(block, context) &&
      rules.epsHotHourMode !== "disabled" &&
      !isEpsCandidateFavorable(block, candidate, context)
    ) {
      warnings.push(
        makeWarning(
          rules.epsHotHourMode === "strict" ? "error" : "warning",
          "eps_hot_hour",
          `${describePlacement(placement, context)} : EPS est placé hors des plages favorables. En mode strict, ce placement doit être corrigé.`,
          {
            lessonBlockId: placement.lessonBlockId,
            classId: placement.classId,
            teacherId: placement.teacherId,
            roomId: placement.roomId ?? null,
          },
        ),
      );
    }

    if (isEpsBlock(block, context)) {
      const declaredSportsFieldExists = context.rooms.some(
        (room) => room.roomType === "sports_field",
      );
      const placementRoom = context.rooms.find((room) => room.id === placement.roomId);

      if (
        declaredSportsFieldExists &&
        placementRoom &&
        placementRoom.roomType !== "sports_field"
      ) {
        warnings.push(
          makeWarning(
            "critical",
            "eps_not_on_field",
            `${describePlacement(placement, context)} : EPS est placé en ${placementRoom.name} alors qu'un terrain EPS existe. Le moteur doit utiliser le terrain.`,
            { classId: placement.classId, teacherId: placement.teacherId, roomId: placement.roomId ?? null },
          ),
        );
      }
    }

    if (hasCourseAfterAfternoonEps(placement, placements, context)) {
      warnings.push(
        makeWarning(
          "warning",
          "eps_not_last_course",
          `${describePlacement(placement, context)} : EPS est placé l’après-midi et un cours vient après. La case est à vérifier.`,
          {
            lessonBlockId: placement.lessonBlockId,
            classId: placement.classId,
            teacherId: placement.teacherId,
            roomId: placement.roomId ?? null,
          },
        ),
      );
    }

    if (!roomMatchesRequirement(block, candidate, context)) {
      const room = context.rooms.find((item) => item.id === placement.roomId);
      warnings.push(
        makeWarning(
          "critical",
          "room_requirement_mismatch",
          `${describePlacement(placement, context)} : salle incompatible${room ? ` (${room.name})` : ""}. Vérifier le type de salle demandé pour ce bloc.`,
          {
            lessonBlockId: placement.lessonBlockId,
            classId: placement.classId,
            teacherId: placement.teacherId,
            roomId: placement.roomId ?? null,
          },
        ),
      );
      continue;
    }

    // Les placements en salle ordinaire par fallback sont signalés directement
    // dans la grille par une couleur/badge. On évite donc de remplir le diagnostic
    // avec des messages informatifs répétitifs.
    void canUseOrdinaryRoomFallback;
    void isOrdinaryFallbackRoom;
  }

  for (const block of unplacedBlocks) {
    warnings.push(
      makeWarning(
        "error",
        "unplaced_block",
        `${describeBlock(block, context)} : aucun créneau compatible n’a été trouvé automatiquement. Vérifier professeur, salle, volume horaire et contraintes.`,
        {
          lessonBlockId: block.id,
          classId: block.classId,
          teacherId: block.teacherId,
        },
      ),
    );
  }

  if (rules.avoidSameSubjectSameDay) {
    const grouped = new Map<string, Placement[]>();

    for (const placement of placements) {
      const key = `${placement.classId}::${placement.dayIndex}::${placement.subjectId}`;
      grouped.set(key, [...(grouped.get(key) ?? []), placement]);
    }

    for (const sameSubjectPlacements of grouped.values()) {
      if (sameSubjectPlacements.length <= 1) {
        continue;
      }

      const continuousGroups = groupContinuousPlacements(sameSubjectPlacements);

      const firstPlacement = sameSubjectPlacements[0];
      const maxContiguousUnits = getMaxContiguousUnitsForClassSubject(
        firstPlacement.classId,
        firstPlacement.subjectId,
        context,
      );

      for (const group of continuousGroups) {
        const span = getContinuousGroupSpan(group);
        if (span > Math.ceil(maxContiguousUnits)) {
          warnings.push(
            makeWarning(
              "error",
              "same_subject_overlong_block",
              `${getClassLabel(firstPlacement.classId, context)} — ${getSubjectLabel(firstPlacement.subjectId, context)} : bloc continu de ${span}h alors que le découpage autorise au maximum ${maxContiguousUnits}h d’affilée.`,
              {
                classId: firstPlacement.classId,
                teacherId: firstPlacement.teacherId,
                lessonBlockId: firstPlacement.lessonBlockId,
              },
            ),
          );
        }
      }

      if (continuousGroups.length <= 1) {
        continue;
      }

      warnings.push(
        makeWarning(
          "error",
          "same_subject_same_day",
          `${getClassLabel(firstPlacement.classId, context)} — ${getSubjectLabel(firstPlacement.subjectId, context)} : matière présente en ${continuousGroups.length} séances séparées le même jour. Le moteur doit répartir ces séances sur d’autres jours.`,
          {
            classId: firstPlacement.classId,
            teacherId: firstPlacement.teacherId,
            lessonBlockId: firstPlacement.lessonBlockId,
          },
        ),
      );
    }
  }

  if (rules.avoidStudentGaps) {
    const halfDayLabels: Record<HalfDay, string> = {
      morning: "matin",
      afternoon: "après-midi",
      evening: "soir",
    };

    for (const detail of getClassGapDetails(placements, context)) {
      const dayLabel =
        context.days.find((day) => day.dayIndex === detail.dayIndex)?.label ??
        `jour ${detail.dayIndex}`;

      warnings.push(
        makeWarning(
          "error",
          "student_gap",
          `${getClassLabel(detail.classId, context)} — ${dayLabel} ${halfDayLabels[detail.halfDay]} : ${detail.gapCount} heure(s) creuse(s) restante(s).`,
          { classId: detail.classId },
        ),
      );
    }
  }

  if (rules.avoidSingleHourReturn) {
    const halfDayLabels: Record<HalfDay, string> = {
      morning: "matin",
      afternoon: "après-midi",
      evening: "soir",
    };

    for (const detail of getSingleHourReturnDetails(placements, context)) {
      const dayLabel =
        context.days.find((day) => day.dayIndex === detail.dayIndex)?.label ??
        `jour ${detail.dayIndex}`;

      warnings.push(
        makeWarning(
          "error",
          "single_hour_return",
          `${getClassLabel(detail.classId, context)} — ${dayLabel} ${halfDayLabels[detail.halfDay]} : demi-journée limitée à 1h de cours. À éviter fortement.`,
          { classId: detail.classId },
        ),
      );
    }
  }

  for (const teacherDetail of getAceTeacherLevelWarnings(placements, context)) {
    warnings.push(
      makeWarning(
        "info",
        "ace_teacher_too_many_levels",
        `${getTeacherLabel(teacherDetail.teacherId, context)} : ${teacherDetail.levelCount} niveaux détectés (${teacherDetail.levels.join(", ")}). ACE recommande d’éviter plus de 3 niveaux, sauf EDHC/AP/Musique.`,
        { teacherId: teacherDetail.teacherId },
      ),
    );
  }

  for (const schoolClass of context.classes) {
    const classPlacements = placements.filter(
      (placement) => placement.classId === schoolClass.id,
    );

    if (classPlacements.length === 0) {
      warnings.push(
        makeWarning(
          "warning",
          "empty_class_timetable",
          `Aucun cours n’a été placé pour la classe ${schoolClass.name}.`,
          { classId: schoolClass.id },
        ),
      );
    }
  }

  return warnings;
}

export function computeGlobalScore(
  warnings: GenerationWarning[],
  placements: Placement[] = [],
  context?: SchedulerContext,
): number {
  const warningScore = warnings.reduce((total, warning) => {
    if (warning.severity === "critical") return total + 500;
    if (warning.severity === "error") return total + 200;
    if (warning.severity === "warning") return total + 50;
    return total + 5;
  }, 0);

  return warningScore + (context ? countSoftQualityPenalty(placements, context) : 0);
}
