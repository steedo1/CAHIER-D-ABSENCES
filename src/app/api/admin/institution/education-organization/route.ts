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
} from "@/lib/education-organization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GuardOk = { user: { id: string }; instId: string };
type GuardErr = { error: "unauthorized" | "no_institution" | "forbidden" };

const WRITABLE_ROLES = new Set(["admin", "super_admin"]);
const READABLE_ROLES = new Set(["admin", "super_admin", "founder"]);
const MAX_CUSTOM_FORMATIONS = 100;
const MAX_LEVELS_PER_FORMATION = 12;

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
    .select("id, role, institution_id")
    .eq("id", user.id)
    .maybeSingle();

  let instId = String((profile as any)?.institution_id || "").trim() || null;
  const profileRole = String((profile as any)?.role || "").trim();
  let allowed = allowedRoles.has(profileRole);

  const { data: userRoles } = await srv
    .from("user_roles")
    .select("role, institution_id")
    .eq("profile_id", user.id);

  for (const row of userRoles || []) {
    const role = String((row as any)?.role || "").trim();
    if (!allowedRoles.has(role)) continue;

    const roleInstitutionId = String((row as any)?.institution_id || "").trim();
    if (!instId && roleInstitutionId) instId = roleInstitutionId;

    if (role === "super_admin" || !roleInstitutionId || roleInstitutionId === instId) {
      allowed = true;
      break;
    }
  }

  if (!instId) return { error: "no_institution" };
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

  const legacyGeneralProtected =
    raw.legacyGeneralProtected === true || fallback.legacyGeneralProtected;

  const effectiveEducationTypes = legacyGeneralProtected
    ? Array.from(new Set<EducationType>(["general_secondary", ...educationTypes]))
    : educationTypes;

  return {
    version: 1,
    configured: raw.configured === true || legacyGeneralProtected,
    educationTypes: effectiveEducationTypes,
    selectedCatalogFormationIds,
    customFormations,
    legacyGeneralProtected,
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

    const legacyGeneralProtected =
      currentOrganization.legacyGeneralProtected || context.hasExistingClasses;

    const educationTypes: EducationType[] = legacyGeneralProtected
      ? Array.from(
          new Set<EducationType>(["general_secondary", ...requestedEducationTypes]),
        )
      : requestedEducationTypes;

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
      version: 1,
      configured: true,
      educationTypes,
      selectedCatalogFormationIds,
      customFormations,
      legacyGeneralProtected,
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
