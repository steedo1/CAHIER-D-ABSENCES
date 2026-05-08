import type { LessonBlock, Placement, SchedulerContext, ScienceTandemMode } from "./types";
import {
  getPcSvtTandemMode,
  getTerrainRules,
  isPcSvtSubject,
  isPcSvtTandemEnabledForClass,
} from "./terrainRules";

export type ScienceTandemReadiness = {
  enabled: boolean;
  mode: ScienceTandemMode;
  eligibleClassIds: string[];
  classesWithPcAndSvt: string[];
  classesMissingPcOrSvt: string[];
};

function normalizeSubjectId(subjectId: string): string {
  return subjectId.trim().toLowerCase();
}

function hasServiceForSubject(
  context: SchedulerContext,
  classId: string,
  subjectId: "pc" | "svt",
): boolean {
  return context.serviceAssignments.some(
    (assignment) =>
      assignment.classId === classId &&
      normalizeSubjectId(assignment.subjectId) === subjectId,
  );
}

export function getScienceTandemReadiness(
  context: SchedulerContext,
): ScienceTandemReadiness {
  const rules = getTerrainRules(context);

  if (!rules.enablePcSvtTandem) {
    return {
      enabled: false,
      mode: rules.pcSvtTandemMode,
      eligibleClassIds: [],
      classesWithPcAndSvt: [],
      classesMissingPcOrSvt: [],
    };
  }

  const eligibleClassIds = context.classes
    .filter((schoolClass) =>
      isPcSvtTandemEnabledForClass(schoolClass.id, context),
    )
    .map((schoolClass) => schoolClass.id);

  const classesWithPcAndSvt = eligibleClassIds.filter(
    (classId) =>
      hasServiceForSubject(context, classId, "pc") &&
      hasServiceForSubject(context, classId, "svt"),
  );

  const classesMissingPcOrSvt = eligibleClassIds.filter(
    (classId) => !classesWithPcAndSvt.includes(classId),
  );

  return {
    enabled: true,
    mode: rules.pcSvtTandemMode,
    eligibleClassIds,
    classesWithPcAndSvt,
    classesMissingPcOrSvt,
  };
}

export function isPcSvtBlock(block: LessonBlock): boolean {
  return isPcSvtSubject(block.subjectId);
}

function areOppositeScienceSubjects(firstSubjectId: string, secondSubjectId: string): boolean {
  const first = normalizeSubjectId(firstSubjectId);
  const second = normalizeSubjectId(secondSubjectId);

  return (
    (first === "pc" && second === "svt") ||
    (first === "svt" && second === "pc")
  );
}

export function canPairAsPcSvtTandem(
  first: LessonBlock,
  second: LessonBlock,
  context: SchedulerContext,
): boolean {
  if (first.id === second.id) {
    return false;
  }

  if (first.classId !== second.classId) {
    return false;
  }

  if (!isPcSvtTandemEnabledForClass(first.classId, context)) {
    return false;
  }

  if (!areOppositeScienceSubjects(first.subjectId, second.subjectId)) {
    return false;
  }

  // Le tandem ACE travaille avec deux demi-groupes équilibrés :
  // une phase P.C et une phase SVT de même durée. Si l’établissement
  // renseigne des découpages différents, on garde un placement classique.
  return Math.abs(first.durationUnits - second.durationUnits) < 0.01;
}

export function getPcSvtTandemPlacementDuration(
  first: LessonBlock,
  second: LessonBlock,
  context: SchedulerContext,
): number {
  const mode = getPcSvtTandemMode(context);

  if (mode === "rotation") {
    return first.durationUnits + second.durationUnits;
  }

  // Mode ACE parallèle : P.C et SVT se déroulent au même moment.
  // Sur une grille horaire d’1h, un cours de 1h30 occupe donc 2 créneaux
  // à l’affichage et au contrôle, mais reste une seule séance parallèle.
  return Math.max(first.durationUnits, second.durationUnits);
}

export function isPcSvtTandemPlacementPair(
  first: Placement,
  second: Placement,
  context: SchedulerContext,
): boolean {
  if (first.id === second.id) {
    return false;
  }

  if (first.classId !== second.classId) {
    return false;
  }

  if (!isPcSvtTandemEnabledForClass(first.classId, context)) {
    return false;
  }

  if (!areOppositeScienceSubjects(first.subjectId, second.subjectId)) {
    return false;
  }

  if (first.dayIndex !== second.dayIndex) {
    return false;
  }

  if (first.startPeriodIndex !== second.startPeriodIndex) {
    return false;
  }

  if (Math.abs(first.durationUnits - second.durationUnits) >= 0.01) {
    return false;
  }

  if (first.tandemMode && second.tandemMode && first.tandemMode !== second.tandemMode) {
    return false;
  }

  if (first.teacherId === second.teacherId) {
    return false;
  }

  if (first.roomId && second.roomId && first.roomId === second.roomId) {
    return false;
  }

  return true;
}
