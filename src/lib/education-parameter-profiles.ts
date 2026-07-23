import type { EducationType } from "@/lib/education-organization";

export const EDUCATION_PARAMETER_PROFILES_SETTINGS_KEY =
  "education_parameter_profiles_v1" as const;

export type ScopedInstitutionSettings = {
  tz: string;
  auto_lateness: boolean;
  default_session_minutes: number;
  institution_region: string;
  institution_status: string;
  institution_head_name: string;
  institution_head_title: string;
  country_name: string;
  country_motto: string;
  ministry_name: string;
  institution_code: string;
};

export type ScopedGradingPeriod = {
  id: string;
  code: string;
  label: string;
  short_label: string;
  kind: string;
  start_date: string;
  end_date: string;
  order_index: number;
  is_active: boolean;
  coeff: number;
};

export type EducationParameterProfile = {
  useCommonInstitutionSettings: boolean;
  institutionSettings: ScopedInstitutionSettings | null;
  useCommonGradingPeriods: boolean;
  gradingPeriodsByAcademicYear: Record<string, ScopedGradingPeriod[]>;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

export type EducationParameterProfilesSettings = {
  version: 1;
  profiles: Partial<Record<EducationType, EducationParameterProfile>>;
};

export const EMPTY_SCOPED_INSTITUTION_SETTINGS: ScopedInstitutionSettings = {
  tz: "Africa/Abidjan",
  auto_lateness: true,
  default_session_minutes: 60,
  institution_region: "",
  institution_status: "",
  institution_head_name: "",
  institution_head_title: "",
  country_name: "",
  country_motto: "",
  ministry_name: "",
  institution_code: "",
};

export function getDefaultEducationParameterProfile(): EducationParameterProfile {
  return {
    useCommonInstitutionSettings: true,
    institutionSettings: null,
    useCommonGradingPeriods: true,
    gradingPeriodsByAcademicYear: {},
    updatedAt: null,
    updatedBy: null,
  };
}
