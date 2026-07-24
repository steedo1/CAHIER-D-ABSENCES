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

export type TextbookProgressionEducationContext = {
  education_type: EducationType;
  education_label: string;
  formation_code: string | null;
  formation_label: string | null;
  formation_level_code: string | null;
  formation_level_label: string | null;
  context_key: string;
  context_label: string;
  is_complete: boolean;
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readOrganization(settingsJson: unknown): EducationOrganizationSettings {
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
    educationTypes: educationTypes.length
      ? educationTypes
      : fallback.educationTypes,
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
    configuredAt:
      typeof raw.configuredAt === "string" ? raw.configuredAt : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    updatedBy: typeof raw.updatedBy === "string" ? raw.updatedBy : null,
  };
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function educationLabel(type: EducationType) {
  return EDUCATION_TYPE_OPTIONS.find((item) => item.id === type)?.label || type;
}

export function normalizeTextbookProgressionEducationType(
  value: unknown,
): EducationType {
  return isEducationType(value) ? value : "general_secondary";
}

export function resolveTextbookProgressionEducationContext(input: {
  educationType?: unknown;
  formationCode?: unknown;
  formationLabel?: unknown;
  formationLevelCode?: unknown;
  formationLevelLabel?: unknown;
  level?: unknown;
  settingsJson?: unknown;
}): TextbookProgressionEducationContext {
  const educationType = normalizeTextbookProgressionEducationType(
    input.educationType,
  );
  const configured = readOrganization(input.settingsJson);
  const formations = getConfiguredFormations(configured);

  if (educationType === "general_secondary") {
    return {
      education_type: educationType,
      education_label: educationLabel(educationType),
      formation_code: null,
      formation_label: null,
      formation_level_code: null,
      formation_level_label: null,
      context_key: `${educationType}::::${clean(input.level)}`,
      context_label: educationLabel(educationType),
      is_complete: true,
    };
  }

  const formationCode = clean(input.formationCode) || null;
  const formationLevelCode =
    clean(input.formationLevelCode) || clean(input.level) || null;
  const formation = formationCode
    ? formations.find(
        (item) =>
          item.key === formationCode && item.educationType === educationType,
      ) || null
    : null;
  const configuredLevel = formationLevelCode
    ? formation?.levels.find((item) => item.value === formationLevelCode) || null
    : null;

  const formationLabel =
    clean(input.formationLabel) ||
    (formation ? `${formation.diplomaLabel} — ${formation.name}` : "") ||
    formationCode;
  const formationLevelLabel =
    clean(input.formationLevelLabel) ||
    configuredLevel?.label ||
    formationLevelCode;

  const labels = [formationLabel, formationLevelLabel].filter(Boolean);
  return {
    education_type: educationType,
    education_label: educationLabel(educationType),
    formation_code: formationCode,
    formation_label: formationLabel || null,
    formation_level_code: formationLevelCode,
    formation_level_label: formationLevelLabel || null,
    context_key: `${educationType}::${formationCode || ""}::${formationLevelCode || ""}`,
    context_label: labels.join(" • ") || educationLabel(educationType),
    is_complete: Boolean(formationCode && formationLevelCode),
  };
}

export function decorateTextbookProgressionEducation(
  progression: any,
  settingsJson?: unknown,
) {
  if (!progression) return progression;
  const context = resolveTextbookProgressionEducationContext({
    educationType: progression.education_type,
    formationCode: progression.formation_code,
    formationLabel: progression.formation_label,
    formationLevelCode: progression.formation_level_code,
    formationLevelLabel: progression.formation_level_label,
    level: progression.level,
    settingsJson,
  });

  return {
    ...progression,
    ...context,
    education_context_key: context.context_key,
    education_context_label: context.context_label,
    education_context_complete: context.is_complete,
  };
}

export function textbookProgressionContextValidationError(
  context: TextbookProgressionEducationContext,
) {
  if (context.education_type === "general_secondary") return null;
  if (context.is_complete) return null;
  return {
    error: "progression_education_context_incomplete",
    message:
      "Sélectionnez la formation et l’année de formation de cette progression.",
    status: 409,
  };
}

export function textbookProgressionMatchesClass(
  progression: any,
  classRow: any,
) {
  const progressionType = normalizeTextbookProgressionEducationType(
    progression?.education_type,
  );
  const classType = normalizeTextbookProgressionEducationType(
    classRow?.education_type,
  );

  if (progressionType !== classType) return false;
  if (progressionType === "general_secondary") return true;

  return (
    clean(progression?.formation_code) === clean(classRow?.formation_code) &&
    clean(progression?.formation_level_code || progression?.level) ===
      clean(classRow?.formation_level_code)
  );
}

export function textbookProgressionContextMismatchMessage(
  progression: any,
  classRow: any,
) {
  if (textbookProgressionMatchesClass(progression, classRow)) return null;
  return {
    error: "progression_class_context_mismatch",
    message:
      "Cette progression ne correspond pas au type d’enseignement, à la formation ou à l’année de cette classe.",
    status: 409,
  };
}
