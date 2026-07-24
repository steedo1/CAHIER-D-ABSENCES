import {
  EDUCATION_ORGANIZATION_SETTINGS_KEY,
  EDUCATION_TYPE_OPTIONS,
  getConfiguredFormations,
  getDefaultEducationOrganization,
  isEducationType,
  type CustomFormation,
  type EducationOrganizationSettings,
  type EducationType,
  type FormationLevelConfiguration,
} from "@/lib/education-organization";

export type AttendanceEducationContext = {
  education_type: EducationType;
  education_label: string;
  education_short_label: string;
  formation_code: string | null;
  formation_label: string | null;
  formation_level_code: string | null;
  formation_level_label: string | null;
  context_key: string;
  context_label: string;
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseEducationOrganization(settingsJson: unknown): EducationOrganizationSettings {
  const fallback = getDefaultEducationOrganization({ hasExistingClasses: true });
  if (!isPlainObject(settingsJson)) return fallback;

  const raw = settingsJson[EDUCATION_ORGANIZATION_SETTINGS_KEY];
  if (!isPlainObject(raw)) return fallback;

  const educationTypes = Array.isArray(raw.educationTypes)
    ? raw.educationTypes.filter(isEducationType)
    : fallback.educationTypes;

  return {
    version: raw.version === 2 ? 2 : 1,
    configured: raw.configured === true,
    educationTypes: educationTypes.length ? educationTypes : fallback.educationTypes,
    selectedCatalogFormationIds: Array.isArray(raw.selectedCatalogFormationIds)
      ? raw.selectedCatalogFormationIds.map(String)
      : [],
    customFormations: Array.isArray(raw.customFormations)
      ? (raw.customFormations as CustomFormation[])
      : [],
    formationLevelConfigurations: Array.isArray(raw.formationLevelConfigurations)
      ? (raw.formationLevelConfigurations as FormationLevelConfiguration[])
      : [],
    legacyGeneralProtected: false,
    configuredAt: typeof raw.configuredAt === "string" ? raw.configuredAt : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === "string" ? raw.updatedBy : null,
  };
}

export function normalizeAttendanceEducationType(value: unknown): EducationType {
  return isEducationType(value) ? value : "general_secondary";
}

export function attendanceEducationTypeLabel(value: unknown): string {
  const type = normalizeAttendanceEducationType(value);
  return EDUCATION_TYPE_OPTIONS.find((option) => option.id === type)?.label || type;
}

export function attendanceEducationTypeShortLabel(value: unknown): string {
  const type = normalizeAttendanceEducationType(value);
  return EDUCATION_TYPE_OPTIONS.find((option) => option.id === type)?.shortLabel || type;
}

export function isNonGeneralAttendanceEducation(value: unknown): boolean {
  return normalizeAttendanceEducationType(value) !== "general_secondary";
}

export function resolveAttendanceEducationContext(input: {
  educationType?: unknown;
  formationCode?: unknown;
  formationLevelCode?: unknown;
  classLevel?: unknown;
  settingsJson?: unknown;
}): AttendanceEducationContext {
  const educationType = normalizeAttendanceEducationType(input.educationType);
  const educationLabel = attendanceEducationTypeLabel(educationType);
  const educationShortLabel = attendanceEducationTypeShortLabel(educationType);

  if (educationType === "general_secondary") {
    return {
      education_type: educationType,
      education_label: educationLabel,
      education_short_label: educationShortLabel,
      formation_code: null,
      formation_label: null,
      formation_level_code: null,
      formation_level_label: null,
      context_key: educationType,
      context_label: educationLabel,
    };
  }

  const formationCode = String(input.formationCode || "").trim() || null;
  const formationLevelCode =
    String(input.formationLevelCode || input.classLevel || "").trim() || null;

  let formationLabel: string | null = null;
  let formationLevelLabel: string | null = formationLevelCode;

  if (formationCode) {
    const organization = parseEducationOrganization(input.settingsJson);
    const formation = getConfiguredFormations(organization).find(
      (item) => item.key === formationCode,
    );

    if (formation) {
      formationLabel = `${formation.diplomaLabel} — ${formation.name}`;
      const level = formation.levels.find(
        (item) => String(item.value) === String(formationLevelCode || ""),
      );
      if (level?.label) formationLevelLabel = level.label;
    }
  }

  const labelParts = [
    formationLabel || educationLabel,
    formationLevelLabel,
  ].filter(Boolean);

  return {
    education_type: educationType,
    education_label: educationLabel,
    education_short_label: educationShortLabel,
    formation_code: formationCode,
    formation_label: formationLabel,
    formation_level_code: formationLevelCode,
    formation_level_label: formationLevelLabel,
    context_key: [
      educationType,
      formationCode || "",
      formationLevelCode || "",
    ].join("|"),
    context_label: labelParts.join(" • ") || educationLabel,
  };
}

export function attendanceClassContextIsComplete(input: {
  educationType?: unknown;
  formationCode?: unknown;
  formationLevelCode?: unknown;
}): boolean {
  if (!isNonGeneralAttendanceEducation(input.educationType)) return true;
  return Boolean(
    String(input.formationCode || "").trim() &&
      String(input.formationLevelCode || "").trim(),
  );
}
