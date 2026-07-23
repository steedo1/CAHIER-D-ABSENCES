import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { isEducationType, type EducationType } from "@/lib/education-organization";
import {
  EDUCATION_PARAMETER_PROFILES_SETTINGS_KEY,
  EMPTY_SCOPED_INSTITUTION_SETTINGS,
  getDefaultEducationParameterProfile,
  type EducationParameterProfile,
  type EducationParameterProfilesSettings,
  type ScopedGradingPeriod,
  type ScopedInstitutionSettings,
} from "@/lib/education-parameter-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PERIODS_PER_YEAR = 24;

type GuardOk = { user: { id: string }; instId: string };
type GuardErr = { error: "unauthorized" | "no_institution" | "forbidden" };

async function guard(
  supa: SupabaseClient,
  srv: SupabaseClient,
  options: { write?: boolean } = {},
): Promise<GuardOk | GuardErr> {
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return { error: "unauthorized" };

  const allowed = options.write
    ? new Set(["admin", "super_admin"])
    : new Set(["admin", "super_admin", "founder"]);

  const { data: profile } = await supa
    .from("profiles")
    .select("role,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  let instId = String((profile as any)?.institution_id || "").trim();
  let canAccess = allowed.has(String((profile as any)?.role || ""));

  const { data: roleRows } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  for (const row of roleRows || []) {
    const role = String((row as any)?.role || "");
    if (!allowed.has(role)) continue;
    const roleInstId = String((row as any)?.institution_id || "").trim();
    if (!instId && roleInstId) instId = roleInstId;
    if (role === "super_admin" || !roleInstId || roleInstId === instId) {
      canAccess = true;
      break;
    }
  }

  if (!instId) return { error: "no_institution" };
  if (!canAccess) return { error: "forbidden" };
  return { user: { id: user.id }, instId };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength = 200) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanInstitutionSettings(value: unknown): ScopedInstitutionSettings {
  const source = isPlainObject(value) ? value : {};
  const minutes = Number(source.default_session_minutes);
  return {
    tz: cleanText(source.tz, 80) || EMPTY_SCOPED_INSTITUTION_SETTINGS.tz,
    auto_lateness: source.auto_lateness !== false,
    default_session_minutes:
      Number.isFinite(minutes) && minutes > 0 ? Math.min(600, Math.floor(minutes)) : 60,
    institution_region: cleanText(source.institution_region, 180),
    institution_status: cleanText(source.institution_status, 120),
    institution_head_name: cleanText(source.institution_head_name, 180),
    institution_head_title: cleanText(source.institution_head_title, 180),
    country_name: cleanText(source.country_name, 180),
    country_motto: cleanText(source.country_motto, 180),
    ministry_name: cleanText(source.ministry_name, 300),
    institution_code: cleanText(source.institution_code, 100),
  };
}

function cleanPeriod(value: unknown, index: number): ScopedGradingPeriod | null {
  if (!isPlainObject(value)) return null;
  const code = cleanText(value.code, 50) || `P${index + 1}`;
  const label = cleanText(value.label, 160) || `Période ${index + 1}`;
  const coeffRaw = Number(value.coeff);
  return {
    id: cleanText(value.id, 100) || `local_period_${index + 1}`,
    code,
    label,
    short_label: cleanText(value.short_label, 100) || label,
    kind: cleanText(value.kind, 60),
    start_date: cleanText(value.start_date, 10),
    end_date: cleanText(value.end_date, 10),
    order_index: index + 1,
    is_active: value.is_active !== false,
    coeff: Number.isFinite(coeffRaw) && coeffRaw >= 0 ? coeffRaw : 1,
  };
}

function cleanPeriods(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_PERIODS_PER_YEAR)
    .map((item, index) => cleanPeriod(item, index))
    .filter((item): item is ScopedGradingPeriod => Boolean(item));
}

function parseProfiles(settingsJson: unknown): EducationParameterProfilesSettings {
  const fallback: EducationParameterProfilesSettings = { version: 1, profiles: {} };
  if (!isPlainObject(settingsJson)) return fallback;
  const raw = settingsJson[EDUCATION_PARAMETER_PROFILES_SETTINGS_KEY];
  if (!isPlainObject(raw) || !isPlainObject(raw.profiles)) return fallback;

  const profiles: EducationParameterProfilesSettings["profiles"] = {};
  for (const [type, value] of Object.entries(raw.profiles)) {
    if (!isEducationType(type) || !isPlainObject(value)) continue;
    const byYear: Record<string, ScopedGradingPeriod[]> = {};
    if (isPlainObject(value.gradingPeriodsByAcademicYear)) {
      for (const [year, periods] of Object.entries(value.gradingPeriodsByAcademicYear)) {
        const cleanYear = cleanText(year, 30);
        if (!cleanYear) continue;
        byYear[cleanYear] = cleanPeriods(periods);
      }
    }

    profiles[type] = {
      useCommonInstitutionSettings: value.useCommonInstitutionSettings !== false,
      institutionSettings: value.institutionSettings
        ? cleanInstitutionSettings(value.institutionSettings)
        : null,
      useCommonGradingPeriods: value.useCommonGradingPeriods !== false,
      gradingPeriodsByAcademicYear: byYear,
      updatedAt: cleanText(value.updatedAt, 50) || null,
      updatedBy: cleanText(value.updatedBy, 100) || null,
    };
  }

  return { version: 1, profiles };
}

async function readInstitution(srv: SupabaseClient, instId: string) {
  const { data, error } = await srv
    .from("institutions")
    .select("settings_json")
    .eq("id", instId)
    .maybeSingle();
  if (error) throw error;
  return isPlainObject((data as any)?.settings_json) ? (data as any).settings_json : {};
}

export async function GET(req: NextRequest) {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;
  const g = await guard(supa, srv);
  if ("error" in g) {
    return NextResponse.json({ ok: false, error: g.error }, { status: g.error === "unauthorized" ? 401 : 403 });
  }

  try {
    const url = new URL(req.url);
    const requestedType = url.searchParams.get("education_type");
    const settingsJson = await readInstitution(srv, g.instId);
    const parsed = parseProfiles(settingsJson);

    if (requestedType && isEducationType(requestedType)) {
      return NextResponse.json({
        ok: true,
        educationType: requestedType,
        profile: parsed.profiles[requestedType] || getDefaultEducationParameterProfile(),
      });
    }

    return NextResponse.json({ ok: true, settings: parsed });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "education_parameter_profiles_read_failed" },
      { status: 400 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;
  const g = await guard(supa, srv, { write: true });
  if ("error" in g) {
    return NextResponse.json({ ok: false, error: g.error }, { status: g.error === "unauthorized" ? 401 : 403 });
  }

  const body = await req.json().catch(() => ({}));
  const educationType = body?.educationType as EducationType;
  if (!isEducationType(educationType)) {
    return NextResponse.json({ ok: false, error: "invalid_education_type" }, { status: 400 });
  }

  try {
    const settingsJson = await readInstitution(srv, g.instId);
    const parsed = parseProfiles(settingsJson);
    const current: EducationParameterProfile = {
      ...getDefaultEducationParameterProfile(),
      ...(parsed.profiles[educationType] || {}),
    };

    if (typeof body.useCommonInstitutionSettings === "boolean") {
      current.useCommonInstitutionSettings = body.useCommonInstitutionSettings;
    }
    if (Object.prototype.hasOwnProperty.call(body, "institutionSettings")) {
      current.institutionSettings = cleanInstitutionSettings(body.institutionSettings);
    }
    if (typeof body.useCommonGradingPeriods === "boolean") {
      current.useCommonGradingPeriods = body.useCommonGradingPeriods;
    }

    const academicYear = cleanText(body.academicYear, 30);
    if (academicYear && Object.prototype.hasOwnProperty.call(body, "gradingPeriods")) {
      current.gradingPeriodsByAcademicYear = {
        ...current.gradingPeriodsByAcademicYear,
        [academicYear]: cleanPeriods(body.gradingPeriods),
      };
    }

    current.updatedAt = new Date().toISOString();
    current.updatedBy = g.user.id;
    parsed.profiles[educationType] = current;

    const nextSettingsJson = {
      ...settingsJson,
      [EDUCATION_PARAMETER_PROFILES_SETTINGS_KEY]: parsed,
    };

    const { error } = await srv
      .from("institutions")
      .update({ settings_json: nextSettingsJson })
      .eq("id", g.instId);
    if (error) throw error;

    return NextResponse.json({ ok: true, educationType, profile: current });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "education_parameter_profiles_save_failed" },
      { status: 400 },
    );
  }
}
