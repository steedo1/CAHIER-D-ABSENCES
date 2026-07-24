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
import {
  EDUCATION_PARAMETER_PROFILES_SETTINGS_KEY,
  type ScopedInstitutionSettings,
} from "@/lib/education-parameter-profiles";

export type BulletinEducationContext = {
  educationType: EducationType;
  educationLabel: string;
  formationCode: string | null;
  formationLabel: string | null;
  formationLevelCode: string | null;
  formationLevelLabel: string | null;
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeBulletinEducationType(value: unknown): EducationType {
  return isEducationType(value) ? value : "general_secondary";
}

export function getBulletinEducationLabel(type: EducationType) {
  return EDUCATION_TYPE_OPTIONS.find((item) => item.id === type)?.label || type;
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

export function resolveBulletinEducationContext(input: {
  educationType?: unknown;
  formationCode?: unknown;
  formationLevelCode?: unknown;
  settingsJson?: unknown;
}): BulletinEducationContext {
  const educationType = normalizeBulletinEducationType(input.educationType);
  const formationCode = String(input.formationCode || "").trim() || null;
  const formationLevelCode = String(input.formationLevelCode || "").trim() || null;
  let formationLabel: string | null = null;
  let formationLevelLabel: string | null = formationLevelCode;

  if (formationCode && educationType !== "general_secondary") {
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

  return {
    educationType,
    educationLabel: getBulletinEducationLabel(educationType),
    formationCode,
    formationLabel,
    formationLevelCode,
    formationLevelLabel,
  };
}

export function resolveScopedInstitutionSettings(input: {
  educationType: EducationType;
  settingsJson?: unknown;
}): Partial<ScopedInstitutionSettings> | null {
  if (input.educationType === "general_secondary" || !isPlainObject(input.settingsJson)) {
    return null;
  }

  const root = input.settingsJson[EDUCATION_PARAMETER_PROFILES_SETTINGS_KEY];
  if (!isPlainObject(root) || !isPlainObject(root.profiles)) return null;
  const profile = root.profiles[input.educationType];
  if (!isPlainObject(profile) || profile.useCommonInstitutionSettings !== false) return null;
  if (!isPlainObject(profile.institutionSettings)) return null;

  return profile.institutionSettings as Partial<ScopedInstitutionSettings>;
}

export function bulletinDocumentTitle(input: {
  educationType: EducationType;
  periodKind?: unknown;
  periodLabel?: unknown;
  periodCode?: unknown;
}) {
  const token = [input.periodKind, input.periodLabel, input.periodCode]
    .map((value) => String(value || ""))
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (token.includes("semestre")) return "BULLETIN SEMESTRIEL DE NOTES";
  if (token.includes("trimestre")) return "BULLETIN TRIMESTRIEL DE NOTES";
  if (token.includes("composition")) return "BULLETIN DE COMPOSITION";
  if (token.includes("module")) return "RELEVÉ DE NOTES DU MODULE";

  // Le général garde le libellé historique lorsqu'aucune information plus précise n'existe.
  if (input.educationType === "general_secondary") {
    return "BULLETIN TRIMESTRIEL DE NOTES";
  }
  return "BULLETIN DE NOTES";
}
