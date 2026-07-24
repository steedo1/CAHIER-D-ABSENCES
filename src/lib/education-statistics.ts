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

export type EducationStatisticsClass = {
  id: string;
  level?: string | null;
  education_type?: string | null;
  formation_code?: string | null;
  formation_label?: string | null;
  formation_level_code?: string | null;
  formation_level_label?: string | null;
};

export type EducationStatisticsContext = {
  educationType: EducationType;
  educationLabel: string;
  educationShortLabel: string;
  formationCode: string | null;
  formationLabel: string | null;
  formationLevelCode: string | null;
  formationLevelLabel: string | null;
  contextLabel: string;
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseOrganization(settingsJson: unknown): EducationOrganizationSettings {
  const fallback = getDefaultEducationOrganization({ hasExistingClasses: true });
  const root = isPlainObject(settingsJson)
    ? isPlainObject(settingsJson.settings_json)
      ? settingsJson.settings_json
      : settingsJson
    : {};
  const raw = root[EDUCATION_ORGANIZATION_SETTINGS_KEY];

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

export function normalizeEducationStatisticsType(value: unknown): EducationType {
  return isEducationType(value) ? value : "general_secondary";
}

export function educationStatisticsTypeLabel(value: unknown) {
  const type = normalizeEducationStatisticsType(value);
  return EDUCATION_TYPE_OPTIONS.find((item) => item.id === type)?.label || type;
}

export function educationStatisticsTypeShortLabel(value: unknown) {
  const type = normalizeEducationStatisticsType(value);
  return (
    EDUCATION_TYPE_OPTIONS.find((item) => item.id === type)?.shortLabel ||
    educationStatisticsTypeLabel(type)
  );
}

export function resolveEducationStatisticsContext(
  row: EducationStatisticsClass,
  settingsJson?: unknown,
): EducationStatisticsContext {
  const educationType = normalizeEducationStatisticsType(row.education_type);
  const educationLabel = educationStatisticsTypeLabel(educationType);
  const educationShortLabel = educationStatisticsTypeShortLabel(educationType);
  const formationCode = String(row.formation_code || "").trim() || null;
  const formationLevelCode =
    String(row.formation_level_code || "").trim() ||
    (educationType === "general_secondary"
      ? String(row.level || "").trim() || null
      : null);

  if (educationType === "general_secondary") {
    return {
      educationType,
      educationLabel,
      educationShortLabel,
      formationCode: null,
      formationLabel: null,
      formationLevelCode,
      formationLevelLabel: formationLevelCode,
      contextLabel: educationLabel,
    };
  }

  const organization = parseOrganization(settingsJson);
  const formation = formationCode
    ? getConfiguredFormations(organization).find((item) => item.key === formationCode)
    : null;

  const formationLabel =
    String(row.formation_label || "").trim() ||
    (formation ? `${formation.diplomaLabel} — ${formation.name}` : formationCode);

  const levelFromFormation = formation?.levels?.find(
    (item) => String(item.value || "").trim() === formationLevelCode,
  );
  const formationLevelLabel =
    String(row.formation_level_label || "").trim() ||
    String(levelFromFormation?.label || "").trim() ||
    formationLevelCode;

  return {
    educationType,
    educationLabel,
    educationShortLabel,
    formationCode,
    formationLabel: formationLabel || null,
    formationLevelCode,
    formationLevelLabel: formationLevelLabel || null,
    contextLabel:
      [educationLabel, formationLabel, formationLevelLabel].filter(Boolean).join(" • ") ||
      educationLabel,
  };
}

export function educationStatisticsClassMatches(
  row: EducationStatisticsClass,
  filters: {
    educationType?: string | null;
    formationCode?: string | null;
    formationLevelCode?: string | null;
  },
) {
  const type = normalizeEducationStatisticsType(row.education_type);
  const selectedType = normalizeEducationStatisticsType(
    filters.educationType || "general_secondary",
  );

  if (type !== selectedType) return false;
  if (selectedType === "general_secondary") return true;

  const formationCode = String(row.formation_code || "").trim();
  const formationLevelCode = String(row.formation_level_code || "").trim();

  if (
    filters.formationCode &&
    formationCode !== String(filters.formationCode || "").trim()
  ) {
    return false;
  }

  if (
    filters.formationLevelCode &&
    formationLevelCode !== String(filters.formationLevelCode || "").trim()
  ) {
    return false;
  }

  return true;
}
