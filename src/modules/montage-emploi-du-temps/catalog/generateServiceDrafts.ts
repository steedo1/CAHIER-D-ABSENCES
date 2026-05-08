import type { SchoolClass } from "../scheduler";
import { defaultSubjectHours, defaultSubjects } from "./defaultCatalog";

export type ServiceDraftStatus = "pending_teacher" | "ready" | "disabled";

export type ServiceDraft = {
  id: string;
  classId: string;
  className: string;
  levelCode: string;
  seriesCode?: string | null;
  subjectId: string;
  subjectName: string;
  subjectShortName: string;
  weeklyUnits: number;
  splitPattern: string;
  roomTypeRequired?: string | null;
  isOptional: boolean;
  teacherId?: string | null;
  teacherName?: string | null;
  status: ServiceDraftStatus;
  source: "default_catalog" | "manual";
};

function makeServiceDraftId(classId: string, subjectId: string): string {
  return `draft_${classId}_${subjectId}`;
}

function matchesClassLevel(
  schoolClass: SchoolClass,
  levelCode: string,
  seriesCode?: string | null,
): boolean {
  if (schoolClass.levelCode !== levelCode) {
    return false;
  }

  if (!seriesCode) {
    return true;
  }

  return schoolClass.seriesCode === seriesCode;
}

export function generateServiceDraftsFromCatalog(
  classes: SchoolClass[],
): ServiceDraft[] {
  const drafts: ServiceDraft[] = [];

  for (const schoolClass of classes) {
    const catalogRows = defaultSubjectHours.filter((hour) =>
      matchesClassLevel(schoolClass, hour.levelCode, hour.seriesCode),
    );

    for (const hour of catalogRows) {
      const subject = defaultSubjects.find(
        (item) => item.id === hour.subjectId,
      );

      drafts.push({
        id: makeServiceDraftId(schoolClass.id, hour.subjectId),
        classId: schoolClass.id,
        className: schoolClass.name,
        levelCode: schoolClass.levelCode,
        seriesCode: schoolClass.seriesCode ?? null,
        subjectId: hour.subjectId,
        subjectName: subject?.name ?? hour.subjectId,
        subjectShortName: subject?.shortName ?? hour.subjectId,
        weeklyUnits: hour.weeklyUnits,
        splitPattern: hour.splitPattern,
        roomTypeRequired: hour.roomTypeRequired ?? null,
        isOptional: Boolean(hour.isOptional),
        teacherId: null,
        teacherName: null,
        status: "pending_teacher",
        source: "default_catalog",
      });
    }
  }

  return drafts;
}

export function getTotalWeeklyUnits(drafts: ServiceDraft[]): number {
  return drafts.reduce((total, draft) => total + draft.weeklyUnits, 0);
}

export function getDraftsForClass(
  drafts: ServiceDraft[],
  classId: string,
): ServiceDraft[] {
  return drafts.filter((draft) => draft.classId === classId);
}