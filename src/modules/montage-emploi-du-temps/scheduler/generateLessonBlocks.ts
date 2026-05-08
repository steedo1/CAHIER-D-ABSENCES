import type { LessonBlock, SchedulerContext, ServiceAssignment } from "./types";
import {
  createId,
  inferBlockType,
  parseSplitPattern,
  sumDurations,
} from "./utils";

function getRoomRequirementForBlock(
  assignment: ServiceAssignment,
  durations: number[],
  index: number,
): string | null {
  const requiredRoomType = assignment.roomTypeRequired ?? null;

  if (!requiredRoomType) {
    return null;
  }

  // Important : HoraClasse ne décide plus arbitrairement quel fragment P.C/SVT
  // doit aller au laboratoire. Si le service demande une ressource spécialisée,
  // chaque fragment la tente d’abord ; le fallback configuré par l’établissement
  // prend le relais seulement si aucun créneau spécialisé viable n’existe.
  void durations;
  void index;

  return requiredRoomType;
}

export function generateLessonBlocks(context: SchedulerContext): LessonBlock[] {
  const blocks: LessonBlock[] = [];

  for (const assignment of context.serviceAssignments) {
    const durations = parseSplitPattern(assignment.splitPattern);
    const totalDuration = sumDurations(durations);

    if (durations.length === 0) {
      throw new Error(
        `Aucun découpage défini pour le service ${assignment.id}.`,
      );
    }

    if (Math.abs(totalDuration - assignment.weeklyUnits) > 0.01) {
      throw new Error(
        `Découpage incohérent pour le service ${assignment.id}. ` +
          `Volume attendu : ${assignment.weeklyUnits}h, volume obtenu : ${totalDuration}h.`,
      );
    }

    durations.forEach((durationUnits, index) => {
      const roomTypeRequired = getRoomRequirementForBlock(
        assignment,
        durations,
        index,
      );
      const blockAssignment = {
        ...assignment,
        roomTypeRequired,
      };

      blocks.push({
        id: createId("block"),
        serviceAssignmentId: assignment.id,
        classId: assignment.classId,
        teacherId: assignment.teacherId,
        subjectId: assignment.subjectId,
        durationUnits,
        blockOrder: index + 1,
        blockType: inferBlockType(blockAssignment, durationUnits),
        roomTypeRequired,
        status: "pending",
      });
    });
  }

  return blocks;
}
