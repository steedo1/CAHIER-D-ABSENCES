import type { ServiceAssignment, Teacher } from "../scheduler";
import type { ServiceDraft } from "./generateServiceDrafts";

export type SubjectTeacherPool = {
  subjectId: string;
  teacherIds: string[];
};

export type ServiceTeacherAssignment = {
  serviceDraftId: string;
  teacherId: string;
};

export type BuildServiceAssignmentsResult = {
  serviceAssignments: ServiceAssignment[];
  unassignedDrafts: ServiceDraft[];
};

function teacherExists(teachers: Teacher[], teacherId: string): boolean {
  return teachers.some((teacher) => teacher.id === teacherId);
}

export function autoAssignTeachersToDrafts(
  drafts: ServiceDraft[],
  teachers: Teacher[],
  teacherPools: SubjectTeacherPool[],
): ServiceTeacherAssignment[] {
  const assignments: ServiceTeacherAssignment[] = [];
  const loadByTeacher = new Map<string, number>();
  const teachersById = new Map(teachers.map((teacher) => [teacher.id, teacher]));

  for (const draft of drafts) {
    if (draft.status === "disabled") {
      continue;
    }

    const pool = teacherPools.find((item) => item.subjectId === draft.subjectId);
    const teacherIds = pool?.teacherIds.filter((teacherId) =>
      teacherExists(teachers, teacherId),
    );

    if (!teacherIds || teacherIds.length === 0) {
      continue;
    }

    const teachersUnderMaxLoad = teacherIds.filter((teacherId) => {
      const teacher = teachersById.get(teacherId);
      const maxWeeklyUnits = teacher?.maxWeeklyUnits;

      if (typeof maxWeeklyUnits !== "number" || maxWeeklyUnits <= 0) {
        return true;
      }

      return (loadByTeacher.get(teacherId) ?? 0) + draft.weeklyUnits <= maxWeeklyUnits;
    });

    const candidates = teachersUnderMaxLoad.length > 0
      ? teachersUnderMaxLoad
      : teacherIds;

    const selectedTeacherId = [...candidates].sort((a, b) => {
      const loadDelta = (loadByTeacher.get(a) ?? 0) - (loadByTeacher.get(b) ?? 0);

      if (loadDelta !== 0) {
        return loadDelta;
      }

      return teacherIds.indexOf(a) - teacherIds.indexOf(b);
    })[0];

    loadByTeacher.set(
      selectedTeacherId,
      (loadByTeacher.get(selectedTeacherId) ?? 0) + draft.weeklyUnits,
    );

    assignments.push({
      serviceDraftId: draft.id,
      teacherId: selectedTeacherId,
    });
  }

  return assignments;
}


function teacherCanTeachSubject(
  teacherPools: SubjectTeacherPool[] | undefined,
  subjectId: string,
  teacherId: string,
): boolean {
  if (!teacherPools) {
    return true;
  }

  const pool = teacherPools.find((item) => item.subjectId === subjectId);

  return Boolean(pool?.teacherIds.includes(teacherId));
}

export function buildServiceAssignmentsFromDrafts(
  drafts: ServiceDraft[],
  teachers: Teacher[],
  serviceTeacherAssignments: ServiceTeacherAssignment[],
  teacherPools?: SubjectTeacherPool[],
): BuildServiceAssignmentsResult {
  const serviceAssignments: ServiceAssignment[] = [];
  const unassignedDrafts: ServiceDraft[] = [];

  function markUnassignedIfRequired(draft: ServiceDraft): void {
    // Les matières optionnelles ou facultatives sans enseignant ne doivent pas
    // bloquer le montage de base. Elles restent absentes du planning jusqu’à ce
    // que l’établissement leur affecte volontairement un professeur.
    if (!draft.isOptional) {
      unassignedDrafts.push(draft);
    }
  }

  for (const draft of drafts) {
    if (draft.status === "disabled") {
      continue;
    }

    const serviceAssignment = serviceTeacherAssignments.find(
      (assignment) => assignment.serviceDraftId === draft.id,
    );

    if (!serviceAssignment) {
      markUnassignedIfRequired(draft);
      continue;
    }

    if (!teacherExists(teachers, serviceAssignment.teacherId)) {
      markUnassignedIfRequired(draft);
      continue;
    }

    if (
      !teacherCanTeachSubject(
        teacherPools,
        draft.subjectId,
        serviceAssignment.teacherId,
      )
    ) {
      markUnassignedIfRequired(draft);
      continue;
    }

    serviceAssignments.push({
      id: `service_${draft.classId}_${draft.subjectId}`,
      teacherId: serviceAssignment.teacherId,
      classId: draft.classId,
      subjectId: draft.subjectId,
      weeklyUnits: draft.weeklyUnits,
      splitPattern: draft.splitPattern,
      roomTypeRequired: draft.roomTypeRequired ?? null,
    });
  }

  return {
    serviceAssignments,
    unassignedDrafts,
  };
}
