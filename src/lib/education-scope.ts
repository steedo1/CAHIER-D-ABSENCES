import {
  isEducationType,
  type EducationType,
} from "@/lib/education-organization";

export const ALL_EDUCATION_TYPES = "all" as const;

export type EducationScopeType =
  | EducationType
  | typeof ALL_EDUCATION_TYPES;

export type EducationScopeValue = {
  educationType: EducationScopeType;
  formationCode: string;
  levelCode: string;
  classId: string;
};

export type EducationScopedClass = {
  id: string;
  name?: string | null;
  label?: string | null;
  level?: string | null;
  education_type?: EducationType | null;
  formation_code?: string | null;
  formation_level_code?: string | null;
};

export const DEFAULT_EDUCATION_SCOPE: EducationScopeValue = {
  educationType: "general_secondary",
  formationCode: "",
  levelCode: "",
  classId: "",
};

function clean(value: unknown) {
  return String(value || "").trim();
}

export function normalizeClassEducationType(
  row: Pick<EducationScopedClass, "education_type" | "formation_code">,
): EducationType {
  if (isEducationType(row.education_type)) {
    return row.education_type;
  }

  // Compatibilite des classes historiques : avant le multi-enseignement,
  // l'absence de contexte signifiait le secondaire general.
  return "general_secondary";
}

export function getClassFormationCode(
  row: Pick<EducationScopedClass, "formation_code">,
) {
  return clean(row.formation_code);
}

export function getClassLevelCode(
  row: Pick<
    EducationScopedClass,
    "education_type" | "formation_code" | "formation_level_code" | "level"
  >,
) {
  const educationType = normalizeClassEducationType(row);
  if (educationType === "general_secondary") {
    return clean(row.level);
  }

  return clean(row.formation_level_code || row.level);
}

export function getClassDisplayLabel(
  row: Pick<EducationScopedClass, "id" | "name" | "label">,
) {
  return clean(row.name || row.label) || clean(row.id);
}

export function classMatchesEducationScope(
  row: EducationScopedClass,
  scope: EducationScopeValue,
) {
  if (
    scope.educationType !== ALL_EDUCATION_TYPES &&
    normalizeClassEducationType(row) !== scope.educationType
  ) {
    return false;
  }

  if (
    scope.formationCode &&
    getClassFormationCode(row) !== clean(scope.formationCode)
  ) {
    return false;
  }

  if (scope.levelCode && getClassLevelCode(row) !== clean(scope.levelCode)) {
    return false;
  }

  if (scope.classId && clean(row.id) !== clean(scope.classId)) {
    return false;
  }

  return true;
}

export function buildEducationScopeSearchParams(
  scope: EducationScopeValue,
  options: { includeClass?: boolean; includeLevel?: boolean } = {},
) {
  const params = new URLSearchParams();

  if (scope.educationType) {
    params.set("education_type", scope.educationType);
  }
  if (scope.formationCode) {
    params.set("formation_code", scope.formationCode);
  }
  if (options.includeLevel !== false && scope.levelCode) {
    params.set("formation_level_code", scope.levelCode);
  }
  if (options.includeClass !== false && scope.classId) {
    params.set("class_id", scope.classId);
  }

  return params;
}

export function readEducationScopeFromSearchParams(
  params: URLSearchParams,
): EducationScopeValue {
  const rawType = clean(params.get("education_type"));
  const educationType: EducationScopeType =
    rawType === ALL_EDUCATION_TYPES || isEducationType(rawType)
      ? rawType
      : "general_secondary";

  return {
    educationType,
    formationCode: clean(params.get("formation_code")),
    levelCode: clean(
      params.get("formation_level_code") || params.get("level_code"),
    ),
    classId: clean(params.get("class_id") || params.get("classId")),
  };
}

export function readEducationScopeFromRecord(
  input: Record<string, unknown> | null | undefined,
): EducationScopeValue {
  const rawType = clean(input?.education_type);
  const educationType: EducationScopeType =
    rawType === ALL_EDUCATION_TYPES || isEducationType(rawType)
      ? rawType
      : "general_secondary";

  return {
    educationType,
    formationCode: clean(input?.formation_code),
    levelCode: clean(
      input?.formation_level_code || input?.level_code,
    ),
    classId: clean(input?.class_id || input?.classId),
  };
}

export function getEducationScopeWriteError(
  scope: EducationScopeValue,
): string | null {
  if (scope.educationType === ALL_EDUCATION_TYPES) {
    return "Selectionnez un type d'enseignement precis avant cette operation.";
  }

  if (
    scope.educationType !== "general_secondary" &&
    !clean(scope.formationCode)
  ) {
    return "Selectionnez une formation ou une filiere avant cette operation.";
  }

  return null;
}

export function isEducationScopeReadyForWrite(scope: EducationScopeValue) {
  return getEducationScopeWriteError(scope) === null;
}
