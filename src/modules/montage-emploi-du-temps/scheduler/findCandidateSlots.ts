import type {
  CandidateSlot,
  LessonBlock,
  Placement,
  SchedulerContext,
} from "./types";
import { getRoomSearchGroupsForBlock } from "./roomSelection";
import { canFitDuration, respectsHardRules } from "./hardRules";

export function findCandidateSlots(
  block: LessonBlock,
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

  // Logique métier validée : pour P.C/SVT et les ressources spécialisées,
  // on essaie d’abord le labo / terrain. Le fallback en salle ordinaire n’est
  // interrogé que si aucun créneau viable n’existe dans le groupe prioritaire.
  for (const group of roomGroups) {
    const candidates: CandidateSlot[] = [];

    for (const day of enabledDays) {
      for (const period of teachingPeriods) {
        if (!canFitDuration(period.periodIndex, block.durationUnits, context)) {
          continue;
        }

        for (const room of group.rooms) {
          const candidate: CandidateSlot = {
            dayIndex: day.dayIndex,
            startPeriodIndex: period.periodIndex,
            durationUnits: block.durationUnits,
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