import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EDUCATION_PARAMETER_PROFILES_SETTINGS_KEY,
} from "@/lib/education-parameter-profiles";
import {
  isEducationType,
  type EducationType,
} from "@/lib/education-organization";

export type ClassEducationContext = {
  classId: string;
  educationType: EducationType;
  formationCode: string | null;
  formationLevelCode: string | null;
};

export type ScopedGradePeriodRow = {
  id: string;
  institution_id: string;
  academic_year: string;
  code: string | null;
  display_code?: string | null;
  label: string | null;
  short_label: string | null;
  kind: string | null;
  start_date: string | null;
  end_date: string | null;
  order_index: number | null;
  is_active: boolean | null;
  coeff: number | null;
  scope_type?: string | null;
  education_type?: string | null;
  formation_code?: string | null;
  profile_period_key?: string | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedEducationType(value: unknown): EducationType {
  return isEducationType(value) ? value : "general_secondary";
}

export async function getClassEducationContext(
  srv: SupabaseClient,
  institutionId: string,
  classId: string,
): Promise<ClassEducationContext | null> {
  const { data, error } = await srv
    .from("classes")
    .select("id,institution_id,education_type,formation_code,formation_level_code")
    .eq("id", classId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    classId: String((data as any).id),
    educationType: normalizedEducationType((data as any).education_type),
    formationCode: String((data as any).formation_code || "").trim() || null,
    formationLevelCode:
      String((data as any).formation_level_code || "").trim() || null,
  };
}

async function readInstitutionSettings(
  srv: SupabaseClient,
  institutionId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await srv
    .from("institutions")
    .select("settings_json")
    .eq("id", institutionId)
    .maybeSingle();

  if (error || !isPlainObject((data as any)?.settings_json)) return {};
  return (data as any).settings_json as Record<string, unknown>;
}

export async function classUsesCommonGradingPeriods(
  srv: SupabaseClient,
  institutionId: string,
  context: ClassEducationContext,
): Promise<boolean> {
  if (context.educationType === "general_secondary") return true;

  const settings = await readInstitutionSettings(srv, institutionId);
  const root = settings[EDUCATION_PARAMETER_PROFILES_SETTINGS_KEY];
  if (!isPlainObject(root) || !isPlainObject(root.profiles)) return true;

  const profile = root.profiles[context.educationType];
  if (!isPlainObject(profile)) return true;

  return profile.useCommonGradingPeriods !== false;
}

function mapDisplayCode(row: any): ScopedGradePeriodRow {
  return {
    ...row,
    code: row?.display_code || row?.code || null,
  } as ScopedGradePeriodRow;
}

async function listCommonPeriods(
  srv: SupabaseClient,
  institutionId: string,
  academicYear: string,
): Promise<ScopedGradePeriodRow[]> {
  const { data, error } = await srv
    .from("grade_periods")
    .select(
      "id,institution_id,academic_year,code,display_code,label,short_label,kind,start_date,end_date,order_index,is_active,coeff,scope_type,education_type,formation_code,profile_period_key",
    )
    .eq("institution_id", institutionId)
    .eq("academic_year", academicYear)
    .or("scope_type.eq.common,scope_type.is.null")
    .order("order_index", { ascending: true });

  if (error) throw error;
  return (data || []).map(mapDisplayCode);
}

async function listEducationPeriods(
  srv: SupabaseClient,
  institutionId: string,
  academicYear: string,
  educationType: EducationType,
): Promise<ScopedGradePeriodRow[]> {
  const { data, error } = await srv
    .from("grade_periods")
    .select(
      "id,institution_id,academic_year,code,display_code,label,short_label,kind,start_date,end_date,order_index,is_active,coeff,scope_type,education_type,formation_code,profile_period_key",
    )
    .eq("institution_id", institutionId)
    .eq("academic_year", academicYear)
    .eq("scope_type", "education")
    .eq("education_type", educationType)
    .is("formation_code", null)
    .order("order_index", { ascending: true });

  if (error) throw error;
  return (data || []).map(mapDisplayCode);
}

export async function listApplicableGradePeriods(
  srv: SupabaseClient,
  institutionId: string,
  academicYear: string,
  classId?: string | null,
): Promise<{
  items: ScopedGradePeriodRow[];
  context: ClassEducationContext | null;
  resolvedScope: "common" | "education";
  fallbackToCommon: boolean;
}> {
  if (!classId) {
    return {
      items: await listCommonPeriods(srv, institutionId, academicYear),
      context: null,
      resolvedScope: "common",
      fallbackToCommon: false,
    };
  }

  const context = await getClassEducationContext(srv, institutionId, classId);
  if (!context) {
    return {
      items: [],
      context: null,
      resolvedScope: "common",
      fallbackToCommon: false,
    };
  }

  const usesCommon = await classUsesCommonGradingPeriods(
    srv,
    institutionId,
    context,
  );

  if (usesCommon) {
    return {
      items: await listCommonPeriods(srv, institutionId, academicYear),
      context,
      resolvedScope: "common",
      fallbackToCommon: false,
    };
  }

  const scoped = await listEducationPeriods(
    srv,
    institutionId,
    academicYear,
    context.educationType,
  );

  if (scoped.length > 0) {
    return {
      items: scoped,
      context,
      resolvedScope: "education",
      fallbackToCommon: false,
    };
  }

  // Sécurité de continuité : tant que le découpage spécifique n'a pas encore
  // été matérialisé en base, on ne bloque pas la saisie historique.
  return {
    items: await listCommonPeriods(srv, institutionId, academicYear),
    context,
    resolvedScope: "common",
    fallbackToCommon: true,
  };
}

export async function getApplicableGradePeriodById(
  srv: SupabaseClient,
  institutionId: string,
  academicYear: string,
  classId: string,
  gradingPeriodId: string,
): Promise<ScopedGradePeriodRow | null> {
  const resolved = await listApplicableGradePeriods(
    srv,
    institutionId,
    academicYear,
    classId,
  );
  return resolved.items.find((row) => row.id === gradingPeriodId) || null;
}

export async function autoDetectApplicableGradePeriod(
  srv: SupabaseClient,
  institutionId: string,
  academicYear: string,
  classId: string,
  evalDate: string,
): Promise<ScopedGradePeriodRow | null> {
  const resolved = await listApplicableGradePeriods(
    srv,
    institutionId,
    academicYear,
    classId,
  );

  return (
    resolved.items.find((period) => {
      if (period.is_active === false) return false;
      if (period.start_date && evalDate < period.start_date) return false;
      if (period.end_date && evalDate > period.end_date) return false;
      return true;
    }) || null
  );
}
