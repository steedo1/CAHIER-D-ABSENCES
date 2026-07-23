import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getMyInstitutionId } from "../../_helpers/getMyInstitution";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingCoeff = {
  level: string;
  subject_id: string;
  coeff: number;
};

type CoeffValue = {
  coeff: number;
  include_in_average: boolean;
  source_level: string;
};

type LevelContext = {
  education_type: EducationType;
  education_label: string;
  formation_code: string | null;
  formation_label: string | null;
  level: string;
  level_label: string;
};

const OFFICIAL_TRACK_CODES = [
  "6eme",
  "5eme",
  "4eme",
  "3eme",
  "2ndeA",
  "2ndeC",
  "1ereA1",
  "1ereA2",
  "1ereC",
  "1ereD",
  "tleA1",
  "tleA2",
  "tleC",
  "tleD",
] as const;

type OfficialTrackCode = (typeof OFFICIAL_TRACK_CODES)[number];

const OFFICIAL_TRACK_LABELS: Record<OfficialTrackCode, string> = {
  "6eme": "6ème",
  "5eme": "5ème",
  "4eme": "4ème",
  "3eme": "3ème",
  "2ndeA": "2nde A",
  "2ndeC": "2nde C",
  "1ereA1": "1ère A1",
  "1ereA2": "1ère A2",
  "1ereC": "1ère C",
  "1ereD": "1ère D",
  tleA1: "Tle A1",
  tleA2: "Tle A2",
  tleC: "Tle C",
  tleD: "Tle D",
};

const OFFICIAL_TRACK_ORDER = new Map<string, number>(
  OFFICIAL_TRACK_CODES.map((code, index) => [code, index]),
);

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function isOfficialTrackCode(value: string): value is OfficialTrackCode {
  return (OFFICIAL_TRACK_CODES as readonly string[]).includes(value);
}

function normalizeOfficialTrackCode(value: unknown): OfficialTrackCode | null {
  const raw = String(value ?? "").trim();
  if (isOfficialTrackCode(raw)) return raw;

  const normalized = normalizeText(raw);
  const exactByNormalized: Record<string, OfficialTrackCode> = {
    "6EME": "6eme",
    "6E": "6eme",
    SIXIEME: "6eme",
    "5EME": "5eme",
    "5E": "5eme",
    CINQUIEME: "5eme",
    "4EME": "4eme",
    "4E": "4eme",
    QUATRIEME: "4eme",
    "3EME": "3eme",
    "3E": "3eme",
    TROISIEME: "3eme",
    "2NDEA": "2ndeA",
    SECONDEA: "2ndeA",
    "2A": "2ndeA",
    "2NDEC": "2ndeC",
    SECONDEC: "2ndeC",
    "2C": "2ndeC",
    "1EREA1": "1ereA1",
    PREMIEREA1: "1ereA1",
    "1EREA2": "1ereA2",
    PREMIEREA2: "1ereA2",
    "1EREC": "1ereC",
    PREMIEREC: "1ereC",
    "1C": "1ereC",
    "1ERED": "1ereD",
    PREMIERED: "1ereD",
    "1D": "1ereD",
    TLEA1: "tleA1",
    TERMINALEA1: "tleA1",
    TLEA2: "tleA2",
    TERMINALEA2: "tleA2",
    TLEC: "tleC",
    TERMINALEC: "tleC",
    TC: "tleC",
    TLED: "tleD",
    TERMINALED: "tleD",
    TD: "tleD",
  };

  if (exactByNormalized[normalized]) return exactByNormalized[normalized];
  if (/^6/.test(normalized)) return "6eme";
  if (/^5/.test(normalized)) return "5eme";
  if (/^4/.test(normalized)) return "4eme";
  if (/^3/.test(normalized)) return "3eme";
  if (/^(2NDEA|2A|SECONDEA)/.test(normalized)) return "2ndeA";
  if (/^(2NDEC|2C|SECONDEC)/.test(normalized)) return "2ndeC";
  if (/^(1D|1ERED|PREMIERED)/.test(normalized)) return "1ereD";
  if (/^(1C|1EREC|PREMIEREC)/.test(normalized)) return "1ereC";
  if (/^(1A|1EREA|PREMIEREA)/.test(normalized)) return "1ereA2";
  if (/^(TLED|TD|TERMINALED)/.test(normalized)) return "tleD";
  if (/^(TLEC|TC|TERMINALEC)/.test(normalized)) return "tleC";
  if (/^(TLEA|TA|TERMINALEA)/.test(normalized)) return "tleA2";
  return null;
}

function officialTrackLabel(level: string) {
  return isOfficialTrackCode(level) ? OFFICIAL_TRACK_LABELS[level] : level;
}

function educationLabel(type: EducationType) {
  return EDUCATION_TYPE_OPTIONS.find((item) => item.id === type)?.label || type;
}

function sortContexts(a: LevelContext, b: LevelContext) {
  const educationOrder = new Map(
    EDUCATION_TYPE_OPTIONS.map((item, index) => [item.id, index]),
  );
  const educationDiff =
    (educationOrder.get(a.education_type) ?? 99) -
    (educationOrder.get(b.education_type) ?? 99);
  if (educationDiff !== 0) return educationDiff;
  const formationDiff = String(a.formation_label || "").localeCompare(
    String(b.formation_label || ""),
    "fr",
  );
  if (formationDiff !== 0) return formationDiff;
  const ao = OFFICIAL_TRACK_ORDER.get(a.level) ?? 999;
  const bo = OFFICIAL_TRACK_ORDER.get(b.level) ?? 999;
  if (ao !== bo) return ao - bo;
  return a.level_label.localeCompare(b.level_label, "fr", {
    numeric: true,
    sensitivity: "base",
  });
}

function coefficientKey(level: string, subjectId: string) {
  return `${level}__${subjectId}`;
}

function contextKey(type: EducationType, formationCode: string | null, level: string) {
  return `${type}__${formationCode || ""}__${level}`;
}

function normalizeCoeffValue(row: any): CoeffValue {
  return {
    coeff: Number(row.coeff ?? 1),
    include_in_average: row.include_in_average !== false,
    source_level: String(row.level || ""),
  };
}

function readOrganization(settingsJson: unknown, hasExistingClasses: boolean) {
  const fallback = getDefaultEducationOrganization({ hasExistingClasses });
  if (!settingsJson || typeof settingsJson !== "object" || Array.isArray(settingsJson)) {
    return fallback;
  }
  const raw = (settingsJson as Record<string, any>)[EDUCATION_ORGANIZATION_SETTINGS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;

  const educationTypes = Array.isArray(raw.educationTypes)
    ? raw.educationTypes.filter(isEducationType)
    : fallback.educationTypes;
  const selectedCatalogFormationIds = Array.isArray(raw.selectedCatalogFormationIds)
    ? raw.selectedCatalogFormationIds.map(String)
    : [];
  const customFormations = Array.isArray(raw.customFormations)
    ? (raw.customFormations as CustomFormation[])
    : [];
  const formationLevelConfigurations = Array.isArray(raw.formationLevelConfigurations)
    ? (raw.formationLevelConfigurations as FormationLevelConfiguration[])
    : [];

  const organization: EducationOrganizationSettings = {
    version: raw.version === 2 ? 2 : 1,
    configured: raw.configured === true,
    educationTypes: educationTypes.length ? educationTypes : fallback.educationTypes,
    selectedCatalogFormationIds,
    customFormations,
    formationLevelConfigurations,
    legacyGeneralProtected: false,
    configuredAt: raw.configuredAt || null,
    updatedAt: raw.updatedAt || null,
    updatedBy: raw.updatedBy || null,
  };
  return organization;
}

function subjectKey(name: string) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function slug(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 16);
}

export async function GET(_req: NextRequest) {
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const supabase = getSupabaseServiceClient();

  const [institutionResult, classResult, subjectResult, coeffResult, assignmentResult] =
    await Promise.all([
      supabase
        .from("institutions")
        .select("settings_json")
        .eq("id", institution_id)
        .maybeSingle(),
      supabase
        .from("classes")
        .select(
          "level,label,official_track_code,education_type,formation_code,formation_level_code",
        )
        .eq("institution_id", institution_id),
      supabase
        .from("institution_subjects")
        .select("subject_id,is_active,subjects(name)")
        .eq("institution_id", institution_id),
      supabase
        .from("institution_subject_coeffs")
        .select("level,subject_id,coeff,include_in_average")
        .eq("institution_id", institution_id),
      supabase
        .from("institution_level_subjects")
        .select(
          "education_type,formation_code,level_code,subject_id,order_index,is_active",
        )
        .eq("institution_id", institution_id)
        .eq("is_active", true),
    ]);

  for (const result of [
    institutionResult,
    classResult,
    subjectResult,
    coeffResult,
    assignmentResult,
  ]) {
    if (result.error) {
      return NextResponse.json(
        { ok: false, error: result.error.message },
        { status: 400 },
      );
    }
  }

  const classRows = classResult.data || [];
  const organization = readOrganization(
    institutionResult.data?.settings_json,
    classRows.length > 0,
  );
  const configuredFormations = getConfiguredFormations(organization);

  const contextMap = new Map<string, LevelContext>();
  const addContext = (context: LevelContext) => {
    if (!context.level) return;
    contextMap.set(
      contextKey(context.education_type, context.formation_code, context.level),
      context,
    );
  };

  for (const formation of configuredFormations) {
    for (const level of formation.levels) {
      addContext({
        education_type: formation.educationType,
        education_label: educationLabel(formation.educationType),
        formation_code: formation.key,
        formation_label: `${formation.diplomaLabel} — ${formation.name}`,
        level: level.value,
        level_label: level.label,
      });
    }
  }

  const formationForLevel = (level: string) => {
    const key = normalizeText(level);
    return (
      configuredFormations.find((formation) =>
        formation.levels.some((item) => normalizeText(item.value) === key),
      ) || null
    );
  };

  for (const row of classRows as any[]) {
    const rawLevel = String(row.formation_level_code || row.level || "").trim();
    const explicitType = isEducationType(row.education_type)
      ? row.education_type
      : null;
    const explicitFormation = row.formation_code
      ? configuredFormations.find((item) => item.key === row.formation_code) || null
      : null;
    const inferredFormation = explicitFormation || formationForLevel(rawLevel);

    if (
      (explicitType && explicitType !== "general_secondary") ||
      inferredFormation
    ) {
      const type =
        explicitType && explicitType !== "general_secondary"
          ? explicitType
          : inferredFormation!.educationType;
      const formationCode = row.formation_code || inferredFormation?.key || null;
      const formation =
        configuredFormations.find((item) => item.key === formationCode) ||
        inferredFormation;
      const levelConfig = formation?.levels.find(
        (item) => normalizeText(item.value) === normalizeText(rawLevel),
      );
      addContext({
        education_type: type,
        education_label: educationLabel(type),
        formation_code: formationCode,
        formation_label: formation
          ? `${formation.diplomaLabel} — ${formation.name}`
          : formationCode,
        level: rawLevel,
        level_label: levelConfig?.label || rawLevel,
      });
      continue;
    }

    const official =
      normalizeOfficialTrackCode(row.official_track_code) ||
      normalizeOfficialTrackCode(row.level) ||
      normalizeOfficialTrackCode(row.label);
    if (official) {
      addContext({
        education_type: "general_secondary",
        education_label: educationLabel("general_secondary"),
        formation_code: null,
        formation_label: null,
        level: official,
        level_label: officialTrackLabel(official),
      });
    }
  }

  const subjects: { subject_id: string; subject_name: string }[] = (subjectResult.data || [])
    .filter((row: any) => row.is_active !== false)
    .map((row: any) => ({
      subject_id: String(row.subject_id),
      subject_name: String(row.subjects?.name || "Matière"),
    }))
    .sort((a, b) => a.subject_name.localeCompare(b.subject_name, "fr"));
  const subjectById = new Map(subjects.map((item) => [item.subject_id, item]));

  const exactByKey = new Map<string, CoeffValue>();
  const legacyByKey = new Map<string, CoeffValue>();
  for (const row of coeffResult.data || []) {
    const rawLevel = String((row as any).level || "").trim();
    const subjectId = String((row as any).subject_id || "").trim();
    if (!rawLevel || !subjectId) continue;
    const official = normalizeOfficialTrackCode(rawLevel);
    const value = normalizeCoeffValue(row);
    if (official) {
      const key = coefficientKey(official, subjectId);
      if (isOfficialTrackCode(rawLevel)) exactByKey.set(key, value);
      else if (!legacyByKey.has(key)) legacyByKey.set(key, value);
    } else {
      exactByKey.set(coefficientKey(rawLevel, subjectId), value);
      const formation = formationForLevel(rawLevel);
      if (formation) {
        const level = formation.levels.find(
          (item) => normalizeText(item.value) === normalizeText(rawLevel),
        );
        addContext({
          education_type: formation.educationType,
          education_label: educationLabel(formation.educationType),
          formation_code: formation.key,
          formation_label: `${formation.diplomaLabel} — ${formation.name}`,
          level: rawLevel,
          level_label: level?.label || rawLevel,
        });
      }
    }
  }

  const assignmentMap = new Map<string, Set<string>>();
  for (const row of assignmentResult.data || []) {
    const type = isEducationType((row as any).education_type)
      ? ((row as any).education_type as EducationType)
      : null;
    if (!type) continue;
    const formationCode = String((row as any).formation_code || "").trim() || null;
    const level = String((row as any).level_code || "").trim();
    const subjectId = String((row as any).subject_id || "").trim();
    if (!level || !subjectId) continue;
    const key = contextKey(type, formationCode, level);
    const current = assignmentMap.get(key) || new Set<string>();
    current.add(subjectId);
    assignmentMap.set(key, current);
  }

  const levels = Array.from(contextMap.values()).sort(sortContexts);
  const items: any[] = [];

  for (const context of levels) {
    let relevantSubjectIds: string[];
    if (context.education_type === "general_secondary") {
      relevantSubjectIds = subjects.map((item) => item.subject_id);
    } else {
      const key = contextKey(
        context.education_type,
        context.formation_code,
        context.level,
      );
      const assigned = new Set(assignmentMap.get(key) || []);
      for (const row of coeffResult.data || []) {
        if (String((row as any).level || "") === context.level) {
          assigned.add(String((row as any).subject_id || ""));
        }
      }
      relevantSubjectIds = Array.from(assigned).filter((id) => subjectById.has(id));
    }

    for (const subjectId of relevantSubjectIds) {
      const subject = subjectById.get(subjectId);
      if (!subject) continue;
      const key = coefficientKey(context.level, subjectId);
      const existing = exactByKey.get(key) || legacyByKey.get(key);
      items.push({
        ...context,
        subject_id: subjectId,
        subject_name: subject.subject_name,
        coeff: existing ? existing.coeff : 1,
        include_in_average: existing ? existing.include_in_average : true,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    items,
    levels,
    available_subjects: subjects,
  });
}

export async function POST(req: NextRequest) {
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const educationType = body?.education_type;
  const formationCode = String(body?.formation_code || "").trim();
  const level = String(body?.level || "").trim();
  const subjectIdRaw = String(body?.subject_id || "").trim();
  const subjectName = String(body?.subject_name || "").trim();

  if (
    !isEducationType(educationType) ||
    educationType === "general_secondary" ||
    !formationCode ||
    !level ||
    (!subjectIdRaw && !subjectName)
  ) {
    return NextResponse.json(
      { ok: false, error: "bad_payload" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServiceClient();
  let subjectId = subjectIdRaw;
  let resolvedName = subjectName;

  if (subjectId) {
    const { data, error: subjectError } = await supabase
      .from("subjects")
      .select("id,name")
      .eq("id", subjectId)
      .maybeSingle();
    if (subjectError || !data?.id) {
      return NextResponse.json(
        { ok: false, error: subjectError?.message || "subject_not_found" },
        { status: 400 },
      );
    }
    resolvedName = String(data.name || subjectName || "Discipline");
  } else {
    const key = subjectKey(subjectName);
    const { data: existing } = await supabase
      .from("subjects")
      .select("id,name,subject_key")
      .eq("subject_key", key)
      .maybeSingle();

    if (existing?.id) {
      subjectId = String(existing.id);
      resolvedName = String(existing.name || subjectName);
    } else {
      const { data: created, error: createError } = await supabase
        .from("subjects")
        .insert({ name: subjectName, code: slug(subjectName) })
        .select("id,name")
        .single();
      if (createError || !created?.id) {
        const { data: reread } = await supabase
          .from("subjects")
          .select("id,name")
          .eq("subject_key", key)
          .maybeSingle();
        if (!reread?.id) {
          return NextResponse.json(
            { ok: false, error: createError?.message || "subject_create_failed" },
            { status: 400 },
          );
        }
        subjectId = String(reread.id);
        resolvedName = String(reread.name || subjectName);
      } else {
        subjectId = String(created.id);
        resolvedName = String(created.name || subjectName);
      }
    }
  }

  const { error: institutionSubjectError } = await supabase
    .from("institution_subjects")
    .upsert(
      { institution_id, subject_id: subjectId, is_active: true },
      { onConflict: "institution_id,subject_id" },
    );
  if (institutionSubjectError) {
    return NextResponse.json(
      { ok: false, error: institutionSubjectError.message },
      { status: 400 },
    );
  }

  const { error: assignmentError } = await supabase
    .from("institution_level_subjects")
    .upsert(
      {
        institution_id,
        education_type: educationType,
        formation_code: formationCode,
        level_code: level,
        subject_id: subjectId,
        is_active: true,
      },
      {
        onConflict:
          "institution_id,education_type,formation_code,level_code,subject_id",
      },
    );
  if (assignmentError) {
    return NextResponse.json(
      { ok: false, error: assignmentError.message },
      { status: 400 },
    );
  }

  const { error: coeffError } = await supabase
    .from("institution_subject_coeffs")
    .upsert(
      {
        institution_id,
        level,
        subject_id: subjectId,
        coeff: 1,
        include_in_average: true,
      },
      { onConflict: "institution_id,level,subject_id" },
    );
  if (coeffError) {
    return NextResponse.json(
      { ok: false, error: coeffError.message },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    item: {
      education_type: educationType,
      formation_code: formationCode,
      level,
      subject_id: subjectId,
      subject_name: resolvedName,
      coeff: 1,
    },
  });
}

export async function PUT(req: NextRequest) {
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const body = await req.json().catch(() => ({}) as any);
  const incoming = Array.isArray(body.items)
    ? (body.items as IncomingCoeff[])
    : [];

  if (!incoming.length) {
    return NextResponse.json({ ok: false, error: "no_items" }, { status: 400 });
  }

  const rows = incoming
    .map((it) => {
      const rawLevel = (it.level ?? "").trim();
      const officialLevel = normalizeOfficialTrackCode(rawLevel);
      const level = officialLevel || rawLevel;
      const subject_id = (it.subject_id ?? "").trim();
      if (!level || !subject_id) return null;

      let coeff = Number(it.coeff);
      if (!Number.isFinite(coeff) || coeff < 0) coeff = 0;
      if (coeff > 99) coeff = 99;

      return {
        institution_id,
        level,
        subject_id,
        coeff,
        include_in_average: coeff > 0,
      };
    })
    .filter(Boolean) as {
    institution_id: string;
    level: string;
    subject_id: string;
    coeff: number;
    include_in_average: boolean;
  }[];

  if (!rows.length) {
    return NextResponse.json(
      { ok: false, error: "no_valid_items" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServiceClient();
  const { data, error: dbErr } = await supabase
    .from("institution_subject_coeffs")
    .upsert(rows, { onConflict: "institution_id,level,subject_id" })
    .select("level,subject_id,coeff");

  if (dbErr) {
    return NextResponse.json(
      { ok: false, error: dbErr.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, items: data ?? [] });
}
