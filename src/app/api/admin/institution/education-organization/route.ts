import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  EDUCATION_ORGANIZATION_SETTINGS_KEY,
  FORMATION_CATALOG,
  getDefaultEducationOrganization,
  isEducationType,
  type CustomFormation,
  type EducationOrganizationSettings,
  type EducationType,
  type FormationLevelConfiguration,
} from "@/lib/education-organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GuardOk = { user: { id: string }; instId: string };
type GuardErr = { error: "unauthorized" | "no_institution" | "forbidden" };

const WRITABLE_ROLES = new Set(["admin", "super_admin", "file_correspondent"]);
const READABLE_ROLES = new Set([
  "admin",
  "super_admin",
  "founder",
  "finance_manager",
  "file_correspondent",
]);
const MAX_CUSTOM_FORMATIONS = 100;
const MAX_LEVELS_PER_FORMATION = 12;
const MAX_LEVEL_CONFIGURATIONS = 200;

async function guard(
  supa: SupabaseClient,
  srv: SupabaseClient,
  options: { write?: boolean } = {},
): Promise<GuardOk | GuardErr> {
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) return { error: "unauthorized" };

  const allowedRoles = options.write ? WRITABLE_ROLES : READABLE_ROLES;

  const { data: profile } = await supa
    .from("profiles")
    .select("id, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  const profileInstitutionId = String(
    (profile as any)?.institution_id || "",
  ).trim();
  let instId = profileInstitutionId || null;

  const { data: userRoles } = await srv
    .from("user_roles")
    .select("role, institution_id")
    .eq("profile_id", user.id);

  const allowedRows = (userRoles || []).filter((row: any) =>
    allowedRoles.has(String(row?.role || "").trim()),
  );

  if (!instId) {
    const rowWithInstitution = allowedRows.find((row: any) =>
      String(row?.institution_id || "").trim(),
    );
    instId = String(rowWithInstitution?.institution_id || "").trim() || null;
  }

  if (!instId) return { error: "no_institution" };

  const allowed = allowedRows.some((row: any) => {
    const role = String(row?.role || "").trim();
    if (role === "super_admin") return true;

    const roleInstitutionId = String(row?.institution_id || "").trim();
    if (roleInstitutionId) return roleInstitutionId === instId;

    return Boolean(
      profileInstitutionId && profileInstitutionId === instId,
    );
  });

  if (!allowed) return { error: "forbidden" };

  return { user: { id: user.id }, instId };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanLevels(value: unknown) {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const levels: string[] = [];

  for (const raw of value) {
    const level = cleanText(raw, 80);
    if (!level) continue;

    const key = level.toLocaleLowerCase("fr");
    if (seen.has(key)) continue;

    seen.add(key);
    levels.push(level);
    if (levels.length >= MAX_LEVELS_PER_FORMATION) break;
  }

  return levels;
}

function cleanCustomFormation(
  value: unknown,
  educationTypes: EducationType[],
): CustomFormation | null {
  if (!isPlainObject(value)) return null;

  const educationType = value.educationType;
  if (
    !isEducationType(educationType) ||
    educationType === "general_secondary" ||
    !educationTypes.includes(educationType)
  ) {
    return null;
  }

  const name = cleanText(value.name, 140);
  if (!name) return null;

  const diplomaCode = cleanText(value.diplomaCode, 40).toUpperCase() || "AUTRE";
  const diplomaLabel = cleanText(value.diplomaLabel, 100) || "Autre diplôme ou certificat";
  const shortCode = cleanText(value.shortCode, 40).toUpperCase();
  const levels = cleanLevels(value.levels);
  const rawId = cleanText(value.id, 80);
  const id = /^[a-zA-Z0-9_-]{8,80}$/.test(rawId)
    ? rawId
    : `local_${globalThis.crypto.randomUUID()}`;
  const createdAt = cleanText(value.createdAt, 40) || new Date().toISOString();

  return {
    id,
    educationType,
    diplomaCode,
    diplomaLabel,
    name,
    shortCode,
    levels,
    createdAt,
  };
}


function cleanFormationLevelConfigurations(
  value: unknown,
  allowedFormationKeys: Set<string>,
): FormationLevelConfiguration[] {
  if (!Array.isArray(value)) return [];

  const seenKeys = new Set<string>();
  const out: FormationLevelConfiguration[] = [];

  for (const raw of value) {
    if (!isPlainObject(raw)) continue;

    const formationKey = cleanText(raw.formationKey, 120);
    if (!formationKey || !allowedFormationKeys.has(formationKey) || seenKeys.has(formationKey)) {
      continue;
    }

    const rawLevels = Array.isArray(raw.levels) ? raw.levels : [];
    const levelCodes = new Set<string>();
    const levels = rawLevels
      .map((item) => {
        if (!isPlainObject(item)) return null;
        const levelValue = cleanText(item.value, 80).toUpperCase();
        const levelLabel = cleanText(item.label, 120);
        if (!levelValue || !levelLabel || levelCodes.has(levelValue)) return null;
        levelCodes.add(levelValue);
        return { value: levelValue, label: levelLabel };
      })
      .filter((item): item is { value: string; label: string } => Boolean(item))
      .slice(0, MAX_LEVELS_PER_FORMATION);

    if (!levels.length) continue;

    seenKeys.add(formationKey);
    out.push({
      formationKey,
      levels,
      updatedAt: cleanText(raw.updatedAt, 40) || new Date().toISOString(),
    });

    if (out.length >= MAX_LEVEL_CONFIGURATIONS) break;
  }

  return out;
}

function parseStoredSettings(
  settingsJson: unknown,
  hasExistingClasses: boolean,
): EducationOrganizationSettings {
  const fallback = getDefaultEducationOrganization({ hasExistingClasses });
  if (!isPlainObject(settingsJson)) return fallback;

  const raw = settingsJson[EDUCATION_ORGANIZATION_SETTINGS_KEY];
  if (!isPlainObject(raw)) return fallback;

  const educationTypes = Array.isArray(raw.educationTypes)
    ? Array.from(new Set(raw.educationTypes.filter(isEducationType)))
    : fallback.educationTypes;

  const selectedCatalogFormationIds = Array.isArray(raw.selectedCatalogFormationIds)
    ? Array.from(
        new Set(
          raw.selectedCatalogFormationIds
            .map((item) => cleanText(item, 100))
            .filter(Boolean),
        ),
      )
    : [];

  const customFormations = Array.isArray(raw.customFormations)
    ? raw.customFormations
        .map((item) => cleanCustomFormation(item, educationTypes))
        .filter((item): item is CustomFormation => Boolean(item))
        .slice(0, MAX_CUSTOM_FORMATIONS)
    : [];

  const allowedFormationKeys = new Set<string>([
    ...selectedCatalogFormationIds.map((id) => `catalog:${id}`),
    ...customFormations.map((item) => `custom:${item.id}`),
  ]);
  const formationLevelConfigurations = cleanFormationLevelConfigurations(
    raw.formationLevelConfigurations,
    allowedFormationKeys,
  );

  return {
    version: raw.version === 2 ? 2 : 1,
    configured: raw.configured === true || fallback.configured,
    educationTypes,
    selectedCatalogFormationIds,
    customFormations,
    formationLevelConfigurations,
    legacyGeneralProtected: false,
    configuredAt: cleanText(raw.configuredAt, 40) || null,
    updatedAt: cleanText(raw.updatedAt, 40) || null,
    updatedBy: cleanText(raw.updatedBy, 80) || null,
  };
}

async function readInstitutionContext(srv: SupabaseClient, instId: string) {
  const [{ data: institution, error: institutionError }, { count, error: countError }] =
    await Promise.all([
      srv
        .from("institutions")
        .select("id,name,code,code_unique,settings_json")
        .eq("id", instId)
        .maybeSingle(),
      srv
        .from("classes")
        .select("id", { count: "exact", head: true })
        .eq("institution_id", instId),
    ]);

  if (institutionError) throw institutionError;
  if (countError) throw countError;

  return {
    institution: institution as any,
    hasExistingClasses: Number(count || 0) > 0,
  };
}

export async function GET() {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;
  const g = await guard(supa, srv);

  if ("error" in g) {
    const status = g.error === "unauthorized" ? 401 : 403;
    return NextResponse.json({ ok: false, error: g.error }, { status });
  }

  try {
    const context = await readInstitutionContext(srv, g.instId);
    const settingsJson = isPlainObject(context.institution?.settings_json)
      ? context.institution.settings_json
      : {};
    const organization = parseStoredSettings(
      settingsJson,
      context.hasExistingClasses,
    );

    return NextResponse.json({
      ok: true,
      institution: {
        id: context.institution?.id || g.instId,
        name: context.institution?.name || "",
        code: context.institution?.code_unique || context.institution?.code || "",
      },
      hasExistingClasses: context.hasExistingClasses,
      organization,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "education_organization_read_failed" },
      { status: 400 },
    );
  }
}

export async function PUT(req: NextRequest) {
  const supa = (await getSupabaseServerClient()) as unknown as SupabaseClient;
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;
  const g = await guard(supa, srv, { write: true });

  if ("error" in g) {
    const status = g.error === "unauthorized" ? 401 : 403;
    return NextResponse.json({ ok: false, error: g.error }, { status });
  }

  const body = await req.json().catch(() => ({}));

  try {
    const context = await readInstitutionContext(srv, g.instId);
    const currentSettingsJson: Record<string, unknown> = isPlainObject(
      context.institution?.settings_json,
    )
      ? { ...context.institution.settings_json }
      : {};
    const currentOrganization = parseStoredSettings(
      currentSettingsJson,
      context.hasExistingClasses,
    );

    const requestedEducationTypes: EducationType[] = Array.isArray(
      body?.educationTypes,
    )
      ? Array.from(
          new Set<EducationType>(
            (body.educationTypes as unknown[]).filter(isEducationType),
          ),
        )
      : [];

    const educationTypes: EducationType[] = requestedEducationTypes;

    if (educationTypes.length === 0) {
      return NextResponse.json(
        { ok: false, error: "education_type_required" },
        { status: 400 },
      );
    }

    const selectedCatalogFormationIds: string[] = Array.isArray(
      body?.selectedCatalogFormationIds,
    )
      ? Array.from(
          new Set<string>(
            (body.selectedCatalogFormationIds as unknown[])
              .map((item) => cleanText(item, 100))
              .filter((item): item is string => Boolean(item)),
          ),
        )
      : [];

    const allowedCatalogIds = new Set(
      FORMATION_CATALOG.filter((item) => educationTypes.includes(item.educationType)).map(
        (item) => item.id,
      ),
    );

    const invalidCatalogId = selectedCatalogFormationIds.find(
      (id) => !allowedCatalogIds.has(id),
    );

    if (invalidCatalogId) {
      return NextResponse.json(
        { ok: false, error: "invalid_catalog_formation", formationId: invalidCatalogId },
        { status: 400 },
      );
    }

    const customFormations: CustomFormation[] = Array.isArray(
      body?.customFormations,
    )
      ? (body.customFormations as unknown[])
          .map((item) => cleanCustomFormation(item, educationTypes))
          .filter((item): item is CustomFormation => Boolean(item))
          .slice(0, MAX_CUSTOM_FORMATIONS)
      : [];

    const allowedFormationKeys = new Set<string>([
      ...selectedCatalogFormationIds.map((id) => `catalog:${id}`),
      ...customFormations.map((item) => `custom:${item.id}`),
    ]);
    const formationLevelConfigurations = cleanFormationLevelConfigurations(
      body?.formationLevelConfigurations,
      allowedFormationKeys,
    );

    const duplicateLevelOwner = new Map<string, string>();
    for (const configuration of formationLevelConfigurations) {
      for (const level of configuration.levels) {
        const previous = duplicateLevelOwner.get(level.value);
        if (previous && previous !== configuration.formationKey) {
          return NextResponse.json(
            {
              ok: false,
              error: "duplicate_formation_level_code",
              levelCode: level.value,
            },
            { status: 400 },
          );
        }
        duplicateLevelOwner.set(level.value, configuration.formationKey);
      }
    }

    const selectedNonGeneralTypes = educationTypes.filter(
      (type) => type !== "general_secondary",
    );

    for (const educationType of selectedNonGeneralTypes) {
      const hasCatalogFormation = FORMATION_CATALOG.some(
        (item) =>
          item.educationType === educationType &&
          selectedCatalogFormationIds.includes(item.id),
      );
      const hasCustomFormation = customFormations.some(
        (item) => item.educationType === educationType,
      );

      if (!hasCatalogFormation && !hasCustomFormation) {
        return NextResponse.json(
          {
            ok: false,
            error: "formation_required_for_education_type",
            educationType,
          },
          { status: 400 },
        );
      }
    }

    const now = new Date().toISOString();
    const nextOrganization: EducationOrganizationSettings = {
      version: 2,
      configured: true,
      educationTypes,
      selectedCatalogFormationIds,
      customFormations,
      formationLevelConfigurations,
      legacyGeneralProtected: false,
      configuredAt: currentOrganization.configuredAt || now,
      updatedAt: now,
      updatedBy: g.user.id,
    };

    currentSettingsJson[EDUCATION_ORGANIZATION_SETTINGS_KEY] = nextOrganization;

    const { error } = await srv
      .from("institutions")
      .update({ settings_json: currentSettingsJson })
      .eq("id", g.instId);

    if (error) throw error;

    return NextResponse.json({ ok: true, organization: nextOrganization });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "education_organization_save_failed" },
      { status: 400 },
    );
  }
}
