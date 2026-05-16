import type {
  CandidateSlot,
  LessonBlock,
  Placement,
  SchedulerContext,
  SchedulerResult,
} from "./types";
import { findCandidateSlots } from "./findCandidateSlots";
import {
  canFitDuration,
  respectsHardRules,
} from "./hardRules";
import { getRoomSearchGroupsForBlock } from "./roomSelection";
import { generateLessonBlocks } from "./generateLessonBlocks";
import {
  chooseBestCandidate,
  countSingleHourReturnsInPlacements,
  countStudentGapsInPlacements,
  scoreCandidate,
} from "./scoreCandidate";
import {
  getTerrainRules,
  isEpsBlock,
  withDefaultTerrainRules,
} from "./terrainRules";
import {
  canPairAsPcSvtTandem,
  getPcSvtTandemPlacementDuration,
  isPcSvtBlock,
  isPcSvtTandemPlacementPair,
} from "./tandemScience";
import { createId } from "./utils";
import { computeGlobalScore, validateSchedule } from "./validateSchedule";
import { getAceDifficultyBoost, getAceSubjectPlacementPriority } from "./aceRules";

type BlockOrderStrategy =
  | "ace_priority"
  | "difficulty"
  | "class_spread"
  | "subject_spread"
  | "duration_first";

type GenerationAttempt = {
  seed: number;
  strategy: BlockOrderStrategy;
};

type TandemCandidatePair = {
  first: CandidateSlot;
  second: CandidateSlot;
  score: number;
};

function hashText(value: string): number {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash >>> 0);
}

function classSharesMainRoom(
  classId: string,
  context: SchedulerContext,
): boolean {
  const mainRoomIds = context.roomPreferences
    .filter(
      (preference) =>
        preference.classId === classId &&
        preference.usageType === "main" &&
        preference.isAllowed,
    )
    .map((preference) => preference.roomId);

  if (mainRoomIds.length === 0) {
    return false;
  }

  return context.roomPreferences.some(
    (preference) =>
      preference.classId !== classId &&
      preference.usageType === "main" &&
      preference.isAllowed &&
      mainRoomIds.includes(preference.roomId),
  );
}

function countTeacherStrictUnavailability(
  teacherId: string,
  context: SchedulerContext,
): number {
  return context.teacherUnavailability.filter(
    (item) =>
      item.teacherId === teacherId && item.constraintType === "strict",
  ).length;
}

function getBlockDifficulty(
  block: LessonBlock,
  context: SchedulerContext,
): number {
  let score = 0;

  if (block.roomTypeRequired) {
    score += 70;
  }

  if (block.blockType === "tp" || block.blockType === "tandem") {
    score += 70;
  }

  if (block.blockType === "eps") {
    // EPS dispose de plages trÃ¨s limitÃ©es : avant 10h le matin ou aprÃ¨s 15h.
    // On le place tÃ´t dans lâ€™ordre de gÃ©nÃ©ration pour Ã©viter quâ€™il soit repoussÃ©
    // vers les crÃ©neaux chauds.
    score += 260;
  }

  if (block.durationUnits >= 2) {
    score += 55;
  }

  if (block.durationUnits > 1 && block.durationUnits < 2) {
    score += 35;
  }

  // P.C/SVT sont trÃ¨s contraints Ã  cause des laboratoires et des tandems.
  // On les place avant les matiÃ¨res plus souples pour respecter les espaces rÃ©els.
  if (isPcSvtBlock(block)) {
    score += getTerrainRules(context).enablePcSvtTandem ? 180 : 95;
  }

  if (classSharesMainRoom(block.classId, context)) {
    score += 35;
  }

  score += countTeacherStrictUnavailability(block.teacherId, context) * 12;
  score += getAceDifficultyBoost(block, context);

  return score;
}

function getClassOrder(classId: string, context: SchedulerContext): number {
  return (
    context.classes.find((schoolClass) => schoolClass.id === classId)
      ?.displayOrder ?? 999
  );
}

function getSubjectOrder(subjectId: string, context: SchedulerContext): number {
  return (
    context.subjects.findIndex((subject) => subject.id === subjectId) + 1 || 999
  );
}

function compareWithSeed(
  a: LessonBlock,
  b: LessonBlock,
  context: SchedulerContext,
  attempt: GenerationAttempt,
): number {
  const difficultyDelta =
    getBlockDifficulty(b, context) - getBlockDifficulty(a, context);

  if (attempt.strategy === "ace_priority") {
    const aceDelta =
      getAceSubjectPlacementPriority(a, context) -
      getAceSubjectPlacementPriority(b, context);

    if (aceDelta !== 0) return aceDelta;
    if (difficultyDelta !== 0) return difficultyDelta;
  }

  if (attempt.strategy === "difficulty" && difficultyDelta !== 0) {
    return difficultyDelta;
  }

  if (attempt.strategy === "duration_first") {
    const durationDelta = b.durationUnits - a.durationUnits;
    if (durationDelta !== 0) return durationDelta;
    if (difficultyDelta !== 0) return difficultyDelta;
  }

  if (attempt.strategy === "class_spread") {
    const classDelta = getClassOrder(a.classId, context) - getClassOrder(b.classId, context);
    if (classDelta !== 0) return classDelta;
    if (difficultyDelta !== 0) return difficultyDelta;
  }

  if (attempt.strategy === "subject_spread") {
    const subjectDelta = getSubjectOrder(a.subjectId, context) - getSubjectOrder(b.subjectId, context);
    if (subjectDelta !== 0) return subjectDelta;
    if (difficultyDelta !== 0) return difficultyDelta;
  }

  const aHash = hashText(`${attempt.seed}:${a.classId}:${a.subjectId}:${a.blockOrder}`);
  const bHash = hashText(`${attempt.seed}:${b.classId}:${b.subjectId}:${b.blockOrder}`);

  return aHash - bHash;
}

function sortBlocksForAttempt(
  blocks: LessonBlock[],
  context: SchedulerContext,
  attempt: GenerationAttempt,
): LessonBlock[] {
  return [...blocks].sort((a, b) => compareWithSeed(a, b, context, attempt));
}

function createPlacement(
  block: LessonBlock,
  candidate: CandidateSlot,
  extra: Partial<Placement> = {},
): Placement {
  return {
    id: createId("placement"),
    lessonBlockId: block.id,
    classId: block.classId,
    teacherId: block.teacherId,
    subjectId: block.subjectId,
    roomId: candidate.roomId ?? null,
    dayIndex: candidate.dayIndex,
    startPeriodIndex: candidate.startPeriodIndex,
    durationUnits: candidate.durationUnits,
    placedBy: "auto",
    ...extra,
  };
}

function getScienceTandemRole(block: LessonBlock): "pc" | "svt" {
  return block.subjectId.toLowerCase() === "svt" ? "svt" : "pc";
}

function findCandidateSlotsWithDuration(
  block: LessonBlock,
  durationUnits: number,
  context: SchedulerContext,
  placements: Placement[],
): CandidateSlot[] {
  const roomGroups = getRoomSearchGroupsForBlock(block, context);

  if (roomGroups.length === 0) {
    return [];
  }

  const enabledDays = context.days.filter((day) => day.isEnabled);
  const teachingPeriods = context.periods
    .filter((period) => period.isTeachingPeriod)
    .sort((a, b) => a.periodIndex - b.periodIndex);

  for (const group of roomGroups) {
    const candidates: CandidateSlot[] = [];

    for (const day of enabledDays) {
      for (const period of teachingPeriods) {
        if (!canFitDuration(period.periodIndex, durationUnits, context)) {
          continue;
        }

        for (const room of group.rooms) {
          const candidate: CandidateSlot = {
            dayIndex: day.dayIndex,
            startPeriodIndex: period.periodIndex,
            durationUnits,
            roomId: room.id,
          };

          if (respectsHardRules(block, candidate, context, placements)) {
            candidates.push(candidate);
          }
        }
      }
    }

    if (candidates.length > 0) {
      return candidates;
    }
  }

  return [];
}

function sameStartAndDuration(a: CandidateSlot, b: CandidateSlot): boolean {
  return (
    a.dayIndex === b.dayIndex &&
    a.startPeriodIndex === b.startPeriodIndex &&
    Math.abs(a.durationUnits - b.durationUnits) < 0.01
  );
}

function sameRoom(a: CandidateSlot, b: CandidateSlot): boolean {
  return Boolean(a.roomId && b.roomId && a.roomId === b.roomId);
}

function findTandemPartner(
  block: LessonBlock,
  orderedBlocks: LessonBlock[],
  consumedBlockIds: Set<string>,
  context: SchedulerContext,
): LessonBlock | null {
  if (!isPcSvtBlock(block)) {
    return null;
  }

  return (
    orderedBlocks.find(
      (candidate) =>
        candidate.id !== block.id &&
        !consumedBlockIds.has(candidate.id) &&
        canPairAsPcSvtTandem(block, candidate, context),
    ) ?? null
  );
}

function chooseBestTandemPair(
  firstBlock: LessonBlock,
  secondBlock: LessonBlock,
  context: SchedulerContext,
  placements: Placement[],
  seed: number,
): TandemCandidatePair | null {
  const tandemDuration = getPcSvtTandemPlacementDuration(firstBlock, secondBlock, context);
  const firstCandidates = findCandidateSlotsWithDuration(
    firstBlock,
    tandemDuration,
    context,
    placements,
  );
  const secondCandidates = findCandidateSlotsWithDuration(
    secondBlock,
    tandemDuration,
    context,
    placements,
  );
  const pairs: TandemCandidatePair[] = [];

  for (const first of firstCandidates) {
    for (const second of secondCandidates) {
      if (!sameStartAndDuration(first, second)) {
        continue;
      }

      if (sameRoom(first, second)) {
        continue;
      }

      const firstPlacement = createPlacement(firstBlock, first);
      const secondPlacement = createPlacement(secondBlock, second);

      if (!isPcSvtTandemPlacementPair(firstPlacement, secondPlacement, context)) {
        continue;
      }

      const score =
        scoreCandidate(firstBlock, first, context, placements, { seed }) +
        scoreCandidate(secondBlock, second, context, placements, { seed }) -
        1800;

      pairs.push({ first, second, score });
    }
  }

  if (pairs.length === 0) {
    return null;
  }

  return pairs.sort((a, b) => {
    if (a.score !== b.score) {
      return a.score - b.score;
    }

    const aKey = `${seed}:${a.first.dayIndex}:${a.first.startPeriodIndex}:${a.first.roomId ?? ""}:${a.second.roomId ?? ""}`;
    const bKey = `${seed}:${b.first.dayIndex}:${b.first.startPeriodIndex}:${b.first.roomId ?? ""}:${b.second.roomId ?? ""}`;

    return hashText(aKey) - hashText(bKey);
  })[0];
}

function getBlockById(
  blockId: string,
  lessonBlocks: LessonBlock[],
): LessonBlock | null {
  return lessonBlocks.find((block) => block.id === blockId) ?? null;
}

function sameCandidateAsPlacement(
  placement: Placement,
  candidate: CandidateSlot,
): boolean {
  return (
    placement.dayIndex === candidate.dayIndex &&
    placement.startPeriodIndex === candidate.startPeriodIndex &&
    Math.abs(placement.durationUnits - candidate.durationUnits) < 0.01 &&
    (placement.roomId ?? null) === (candidate.roomId ?? null)
  );
}

function movePlacementToCandidate(
  placement: Placement,
  candidate: CandidateSlot,
): Placement {
  return {
    ...placement,
    roomId: candidate.roomId ?? null,
    dayIndex: candidate.dayIndex,
    startPeriodIndex: candidate.startPeriodIndex,
    durationUnits: candidate.durationUnits,
    score: candidate.roomId ? placement.score : placement.score,
  };
}

function compactStudentGaps(
  placements: Placement[],
  context: SchedulerContext,
  lessonBlocks: LessonBlock[],
  seed: number,
): Placement[] {
  if (!getTerrainRules(context).avoidStudentGaps || placements.length <= 1) {
    return placements;
  }

  let currentPlacements = [...placements];
  let currentGapCount = countStudentGapsInPlacements(currentPlacements, context);

  if (currentGapCount === 0) {
    return currentPlacements;
  }

  // Petite passe de rÃ©paration aprÃ¨s le montage glouton : on dÃ©place seulement
  // les blocs qui peuvent rÃ©ellement rÃ©duire les trous, sans casser classe,
  // professeur, salle, labo, terrain EPS, indisponibilitÃ©s ni rÃ©crÃ©ations.
  for (let pass = 0; pass < 4; pass += 1) {
    let improvedThisPass = false;

    for (const placement of [...currentPlacements]) {
      if (placement.tandemGroupId) {
        continue;
      }

      const block = getBlockById(placement.lessonBlockId, lessonBlocks);

      if (!block) {
        continue;
      }

      const remainingPlacements = currentPlacements.filter(
        (item) => item.id !== placement.id,
      );
      const candidates = findCandidateSlotsWithDuration(
        block,
        placement.durationUnits,
        context,
        remainingPlacements,
      );

      let bestMove: Placement | null = null;
      let bestGapCount = currentGapCount;
      let bestMoveScore = Number.POSITIVE_INFINITY;

      for (const candidate of candidates) {
        if (sameCandidateAsPlacement(placement, candidate)) {
          continue;
        }

        const movedPlacement = movePlacementToCandidate(placement, candidate);
        const projectedPlacements = [...remainingPlacements, movedPlacement];
        const projectedGapCount = countStudentGapsInPlacements(
          projectedPlacements,
          context,
        );

        if (projectedGapCount > bestGapCount) {
          continue;
        }

        const candidateScore = scoreCandidate(
          block,
          candidate,
          context,
          remainingPlacements,
          { seed },
        );

        if (
          projectedGapCount < bestGapCount ||
          (projectedGapCount === bestGapCount && candidateScore < bestMoveScore)
        ) {
          bestMove = movedPlacement;
          bestGapCount = projectedGapCount;
          bestMoveScore = candidateScore;
        }
      }

      if (bestMove && bestGapCount < currentGapCount) {
        currentPlacements = [...remainingPlacements, bestMove];
        currentGapCount = bestGapCount;
        improvedThisPass = true;

        if (currentGapCount === 0) {
          return currentPlacements;
        }
      }
    }

    if (!improvedThisPass) {
      break;
    }
  }

  return currentPlacements;
}

function getPeriodHalfDay(
  periodIndex: number,
  context: SchedulerContext,
): string | null {
  return context.periods.find((period) => period.periodIndex === periodIndex)?.halfDay ?? null;
}

function getPlacementPeriodIndexes(placement: Placement): number[] {
  const indexes: number[] = [];

  for (let offset = 0; offset < Math.ceil(placement.durationUnits); offset += 1) {
    indexes.push(placement.startPeriodIndex + offset);
  }

  return indexes;
}

function getClassHalfDayUnitCount(
  classId: string,
  dayIndex: number,
  halfDay: string,
  placements: Placement[],
  context: SchedulerContext,
): number {
  const indexes = new Set<number>();

  for (const placement of placements) {
    if (placement.classId !== classId || placement.dayIndex !== dayIndex) {
      continue;
    }

    if (getPeriodHalfDay(placement.startPeriodIndex, context) !== halfDay) {
      continue;
    }

    for (const periodIndex of getPlacementPeriodIndexes(placement)) {
      indexes.add(periodIndex);
    }
  }

  return indexes.size;
}

function getCandidateHalfDay(
  candidate: CandidateSlot,
  context: SchedulerContext,
): string | null {
  return getPeriodHalfDay(candidate.startPeriodIndex, context);
}

function isSingleHourReturnPlacement(
  placement: Placement,
  placements: Placement[],
  context: SchedulerContext,
): boolean {
  if (placement.durationUnits > 1) {
    return false;
  }

  const halfDay = getPeriodHalfDay(placement.startPeriodIndex, context);

  if (!halfDay) {
    return false;
  }

  return getClassHalfDayUnitCount(
    placement.classId,
    placement.dayIndex,
    halfDay,
    placements,
    context,
  ) === 1;
}

function compactSingleHourReturns(
  placements: Placement[],
  context: SchedulerContext,
  lessonBlocks: LessonBlock[],
  seed: number,
): Placement[] {
  if (!getTerrainRules(context).avoidSingleHourReturn || placements.length <= 1) {
    return placements;
  }

  let currentPlacements = [...placements];
  let currentSingleHourCount = countSingleHourReturnsInPlacements(currentPlacements, context);
  let currentGapCount = countStudentGapsInPlacements(currentPlacements, context);

  if (currentSingleHourCount === 0) {
    return currentPlacements;
  }

  for (let pass = 0; pass < 4; pass += 1) {
    let improvedThisPass = false;

    for (const placement of [...currentPlacements]) {
      if (placement.tandemGroupId || !isSingleHourReturnPlacement(placement, currentPlacements, context)) {
        continue;
      }

      const block = getBlockById(placement.lessonBlockId, lessonBlocks);

      if (!block) {
        continue;
      }

      const remainingPlacements = currentPlacements.filter(
        (item) => item.id !== placement.id,
      );
      const candidates = findCandidateSlotsWithDuration(
        block,
        placement.durationUnits,
        context,
        remainingPlacements,
      );

      let bestMove: Placement | null = null;
      let bestSingleHourCount = currentSingleHourCount;
      let bestGapCount = currentGapCount;
      let bestMoveScore = Number.POSITIVE_INFINITY;

      for (const candidate of candidates) {
        if (sameCandidateAsPlacement(placement, candidate)) {
          continue;
        }

        const candidateHalfDay = getCandidateHalfDay(candidate, context);

        if (!candidateHalfDay) {
          continue;
        }

        // Objectif terrain : dÃ©placer la seule heure vers une demi-journÃ©e oÃ¹
        // la classe vient dÃ©jÃ , au lieu de crÃ©er une prÃ©sence isolÃ©e.
        if (
          getClassHalfDayUnitCount(
            placement.classId,
            candidate.dayIndex,
            candidateHalfDay,
            remainingPlacements,
            context,
          ) === 0
        ) {
          continue;
        }

        const movedPlacement = movePlacementToCandidate(placement, candidate);
        const projectedPlacements = [...remainingPlacements, movedPlacement];
        const projectedSingleHourCount = countSingleHourReturnsInPlacements(
          projectedPlacements,
          context,
        );
        const projectedGapCount = countStudentGapsInPlacements(projectedPlacements, context);

        if (projectedSingleHourCount > bestSingleHourCount) {
          continue;
        }

        if (projectedGapCount > bestGapCount) {
          continue;
        }

        const candidateScore = scoreCandidate(
          block,
          candidate,
          context,
          remainingPlacements,
          { seed },
        );

        if (
          projectedSingleHourCount < bestSingleHourCount ||
          (projectedSingleHourCount === bestSingleHourCount &&
            (projectedGapCount < bestGapCount || candidateScore < bestMoveScore))
        ) {
          bestMove = movedPlacement;
          bestSingleHourCount = projectedSingleHourCount;
          bestGapCount = projectedGapCount;
          bestMoveScore = candidateScore;
        }
      }

      if (bestMove && bestSingleHourCount < currentSingleHourCount) {
        currentPlacements = [...remainingPlacements, bestMove];
        currentSingleHourCount = bestSingleHourCount;
        currentGapCount = bestGapCount;
        improvedThisPass = true;

        if (currentSingleHourCount === 0) {
          return currentPlacements;
        }
      }
    }

    if (!improvedThisPass) {
      break;
    }
  }

  return currentPlacements;
}

function runGenerationAttempt(
  context: SchedulerContext,
  lessonBlocks: LessonBlock[],
  attempt: GenerationAttempt,
  options: { repairGaps?: boolean } = {},
): SchedulerResult {
  const orderedBlocks = sortBlocksForAttempt(lessonBlocks, context, attempt);

  const placements: Placement[] = [];
  const unplacedBlocks: LessonBlock[] = [];
  const consumedBlockIds = new Set<string>();

  for (const block of orderedBlocks) {
    if (consumedBlockIds.has(block.id)) {
      continue;
    }

    const tandemPartner = findTandemPartner(
      block,
      orderedBlocks,
      consumedBlockIds,
      context,
    );

    if (tandemPartner) {
      const tandemPair = chooseBestTandemPair(
        block,
        tandemPartner,
        context,
        placements,
        attempt.seed,
      );

      if (tandemPair) {
        const tandemGroupId = createId("tandem_pc_svt");

        const tandemMode = getTerrainRules(context).pcSvtTandemMode;

        placements.push(
          createPlacement(block, tandemPair.first, {
            tandemGroupId,
            tandemRole: getScienceTandemRole(block),
            tandemMode,
            tandemPhaseDurationUnits: block.durationUnits,
          }),
        );
        placements.push(
          createPlacement(tandemPartner, tandemPair.second, {
            tandemGroupId,
            tandemRole: getScienceTandemRole(tandemPartner),
            tandemMode,
            tandemPhaseDurationUnits: tandemPartner.durationUnits,
          }),
        );
        consumedBlockIds.add(block.id);
        consumedBlockIds.add(tandemPartner.id);
        continue;
      }
    }

    const candidates = findCandidateSlots(block, context, placements);
    const bestCandidate = chooseBestCandidate(
      block,
      candidates,
      context,
      placements,
      { seed: attempt.seed },
    );

    if (!bestCandidate) {
      unplacedBlocks.push({
        ...block,
        status: "unplaced",
      });
      consumedBlockIds.add(block.id);
      continue;
    }

    placements.push(createPlacement(block, bestCandidate));
    consumedBlockIds.add(block.id);
  }

  const gapRepairedPlacements = options.repairGaps
    ? compactStudentGaps(placements, context, lessonBlocks, attempt.seed)
    : placements;

  const finalPlacements = options.repairGaps
    ? compactSingleHourReturns(gapRepairedPlacements, context, lessonBlocks, attempt.seed)
    : gapRepairedPlacements;

  const warnings = validateSchedule(
    finalPlacements,
    unplacedBlocks,
    context,
    lessonBlocks,
  );
  const globalScore = computeGlobalScore(warnings, finalPlacements, context);

  return {
    placements: finalPlacements,
    unplacedBlocks,
    warnings,
    globalScore,
  };
}

function buildAttempts(context: SchedulerContext, lessonBlockCount: number): GenerationAttempt[] {
  const rules = getTerrainRules(context);
  const isConstrained =
    rules.enablePcSvtTandem ||
    rules.avoidStudentGaps ||
    rules.avoidSameSubjectSameDay ||
    rules.avoidSingleHourReturn ||
    rules.balanceHalfDays;

  // En production Mon Cahier, un Ã©tablissement complet peut produire plusieurs
  // centaines de blocs. L'ancien moteur lanÃ§ait jusqu'Ã  72 tentatives complÃ¨tes
  // avec rÃ©parations, ce qui provoquait des timeouts Vercel et donc une rÃ©ponse
  // HTML/504 au lieu d'un JSON exploitable.
  // Ici on garde plusieurs stratÃ©gies, mais on borne le coÃ»t selon la taille rÃ©elle
  // du problÃ¨me pour garantir une rÃ©ponse serveur. Les diagnostics bloquants restent
  // ensuite chargÃ©s de refuser la publication si le rÃ©sultat n'est pas conforme.
  let strategies: BlockOrderStrategy[] = [
    "ace_priority",
    "difficulty",
    "duration_first",
    "class_spread",
  ];
  let seedCount = isConstrained ? 10 : 6;

  if (lessonBlockCount >= 360) {
    strategies = ["ace_priority", "difficulty"];
    seedCount = 2;
  } else if (lessonBlockCount >= 260) {
    strategies = ["ace_priority", "difficulty", "duration_first"];
    seedCount = 3;
  } else if (lessonBlockCount >= 180) {
    strategies = ["ace_priority", "difficulty", "duration_first", "class_spread"];
    // Les Ã©tablissements rÃ©els autour de 200 blocs restent gÃ©rables, et 4 graines
    // donnent trop souvent un montage localement coincÃ© (matinÃ©es pleines, trous).
    seedCount = isConstrained ? 6 : 4;
  } else if (lessonBlockCount >= 120) {
    seedCount = isConstrained ? 8 : 5;
  }

  const attempts: GenerationAttempt[] = [];

  for (const strategy of strategies) {
    for (let seed = 0; seed < seedCount; seed += 1) {
      attempts.push({ strategy, seed });
    }
  }

  return attempts;
}

function countBlockingWarnings(result: SchedulerResult): number {
  return result.warnings.filter(
    (warning) => warning.severity === "critical" || warning.severity === "error",
  ).length;
}

function countWarningsByType(
  result: SchedulerResult,
  warningTypes: Set<string>,
): number {
  return result.warnings.filter((warning) => warningTypes.has(warning.warningType)).length;
}

const fatalWarningTypes = new Set([
  "class_conflict",
  "teacher_conflict",
  "room_conflict",
  "school_closed_period",
  "break_cut_block",
  "room_requirement_mismatch",
  "eps_not_on_field",
]);

const aceQualityWarningTypes = new Set([
  "student_gap",
  "single_hour_return",
  "same_subject_same_day",
  "same_subject_overlong_block",
]);

function isBetterResult(
  candidate: SchedulerResult,
  currentBest: SchedulerResult | null,
  context: SchedulerContext,
): boolean {
  if (!currentBest) {
    return true;
  }

  const candidateFatal = countWarningsByType(candidate, fatalWarningTypes);
  const currentFatal = countWarningsByType(currentBest, fatalWarningTypes);

  if (candidateFatal !== currentFatal) {
    return candidateFatal < currentFatal;
  }

  const candidateBlockingWarnings = countBlockingWarnings(candidate);
  const currentBlockingWarnings = countBlockingWarnings(currentBest);

  if (candidateBlockingWarnings !== currentBlockingWarnings) {
    return candidateBlockingWarnings < currentBlockingWarnings;
  }

  const candidateAceQuality = countWarningsByType(candidate, aceQualityWarningTypes);
  const currentAceQuality = countWarningsByType(currentBest, aceQualityWarningTypes);

  if (candidateAceQuality !== currentAceQuality) {
    return candidateAceQuality < currentAceQuality;
  }

  if (candidate.unplacedBlocks.length !== currentBest.unplacedBlocks.length) {
    return candidate.unplacedBlocks.length < currentBest.unplacedBlocks.length;
  }

  if (getTerrainRules(context).avoidStudentGaps) {
    const candidateGapCount = countStudentGapsInPlacements(candidate.placements, context);
    const currentGapCount = countStudentGapsInPlacements(currentBest.placements, context);

    if (candidateGapCount !== currentGapCount) {
      return candidateGapCount < currentGapCount;
    }
  }

  if (getTerrainRules(context).avoidSingleHourReturn) {
    const candidateSingleHourReturns = countSingleHourReturnsInPlacements(
      candidate.placements,
      context,
    );
    const currentSingleHourReturns = countSingleHourReturnsInPlacements(
      currentBest.placements,
      context,
    );

    if (candidateSingleHourReturns !== currentSingleHourReturns) {
      return candidateSingleHourReturns < currentSingleHourReturns;
    }
  }

  if (candidate.globalScore !== currentBest.globalScore) {
    return candidate.globalScore < currentBest.globalScore;
  }

  return candidate.placements.length > currentBest.placements.length;
}

function finalizeBestResult(
  result: SchedulerResult | null,
  context: SchedulerContext,
  lessonBlocks: LessonBlock[],
): SchedulerResult {
  if (!result) {
    return {
      placements: [],
      unplacedBlocks: lessonBlocks.map((block) => ({ ...block, status: "unplaced" })),
      warnings: validateSchedule([], lessonBlocks, context, lessonBlocks),
      globalScore: 999999,
    };
  }

  const gapRepairedPlacements = compactStudentGaps(
    result.placements,
    context,
    lessonBlocks,
    0,
  );
  const repairedPlacements = compactSingleHourReturns(
    gapRepairedPlacements,
    context,
    lessonBlocks,
    0,
  );
  const warnings = validateSchedule(
    repairedPlacements,
    result.unplacedBlocks,
    context,
    lessonBlocks,
  );

  return {
    placements: repairedPlacements,
    unplacedBlocks: result.unplacedBlocks,
    warnings,
    globalScore: computeGlobalScore(warnings, repairedPlacements, context),
  };
}


export function generateTimetable(context: SchedulerContext): SchedulerResult {
  const normalizedContext = withDefaultTerrainRules(context);
  const lessonBlocks = generateLessonBlocks(normalizedContext);
  const attempts = buildAttempts(normalizedContext, lessonBlocks.length);
  const repairDuringAttempts = lessonBlocks.length <= 260;

  let bestResult: SchedulerResult | null = null;

  for (const attempt of attempts) {
    const attemptResult = runGenerationAttempt(
      normalizedContext,
      lessonBlocks,
      attempt,
      { repairGaps: repairDuringAttempts },
    );

    if (isBetterResult(attemptResult, bestResult, normalizedContext)) {
      bestResult = attemptResult;
    }
  }

  return finalizeBestResult(bestResult, normalizedContext, lessonBlocks);
}

export type GenerationProgress = {
  completedAttempts: number;
  totalAttempts: number;
  currentStrategy: BlockOrderStrategy;
  bestPlacedCount: number;
  bestUnplacedCount: number;
  bestScore: number;
};

export type GenerateTimetableAsyncOptions = {
  yieldEveryAttempts?: number;
  onProgress?: (progress: GenerationProgress) => void;
  signal?: AbortSignal;
};

function waitForUiFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        window.setTimeout(resolve, 0);
      });
      return;
    }

    setTimeout(resolve, 0);
  });
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("GÃ©nÃ©ration annulÃ©e.");
  }
}

export async function generateTimetableAsync(
  context: SchedulerContext,
  options: GenerateTimetableAsyncOptions = {},
): Promise<SchedulerResult> {
  const normalizedContext = withDefaultTerrainRules(context);
  const lessonBlocks = generateLessonBlocks(normalizedContext);
  const attempts = buildAttempts(normalizedContext, lessonBlocks.length);
  const repairDuringAttempts = lessonBlocks.length <= 260;
  const yieldEveryAttempts = Math.max(1, options.yieldEveryAttempts ?? 2);

  let bestResult: SchedulerResult | null = null;

  await waitForUiFrame();

  for (let index = 0; index < attempts.length; index += 1) {
    assertNotAborted(options.signal);

    const attempt = attempts[index];
    const attemptResult = runGenerationAttempt(
      normalizedContext,
      lessonBlocks,
      attempt,
      { repairGaps: repairDuringAttempts },
    );

    if (isBetterResult(attemptResult, bestResult, normalizedContext)) {
      bestResult = attemptResult;
    }

    const completedAttempts = index + 1;

    if (options.onProgress && bestResult) {
      options.onProgress({
        completedAttempts,
        totalAttempts: attempts.length,
        currentStrategy: attempt.strategy,
        bestPlacedCount: bestResult.placements.length,
        bestUnplacedCount: bestResult.unplacedBlocks.length,
        bestScore: bestResult.globalScore,
      });
    }

    if (completedAttempts % yieldEveryAttempts === 0) {
      await waitForUiFrame();
    }
  }

  return finalizeBestResult(bestResult, normalizedContext, lessonBlocks);
}
