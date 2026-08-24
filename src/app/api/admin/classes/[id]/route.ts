// src/app/api/admin/classes/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { normalizePhone } from "@/lib/phone";
import { isEducationType } from "@/lib/education-organization";
import {
  classDeviceTechnicalEmail,
  classLoginIdentifierKey,
  cleanClassLoginIdentifier,
  legacyClassPhoneCandidates,
  sameClassLoginIdentifier,
} from "@/lib/class-device-identity";

const DEFAULT_TEMP_PASSWORD = process.env.DEFAULT_TEMP_PASSWORD || "Pass2025";

const OFFICIAL_TRACK_CODES = new Set<string>([
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
]);

async function getMyInstitutionId() {
  const supabaseAuth = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  const { data: me, error: meErr } = await supabaseAuth
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) {
    return { error: NextResponse.json({ error: meErr.message }, { status: 400 }) };
  }

  if (!me?.institution_id) {
    return { error: NextResponse.json({ error: "no_institution" }, { status: 400 }) };
  }

  return { institution_id: me.institution_id as string };
}

function cleanOfficialTrackCode(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("bad_official_track_code");

  const cleaned = value.trim();
  if (!OFFICIAL_TRACK_CODES.has(cleaned)) {
    throw new Error("bad_official_track_code");
  }

  return cleaned;
}

async function ensureClassDeviceAuthUser(input: {
  institutionId: string;
  classId: string;
  existingAuthUserId?: string | null;
  legacyPhone?: string | null;
}): Promise<string> {
  const existingAuthUserId = String(input.existingAuthUserId || "").trim();
  if (existingAuthUserId) return existingAuthUserId;

  const srv = getSupabaseServiceClient();
  const legacyCandidates = legacyClassPhoneCandidates(input.legacyPhone);

  // Compatibilité legacy strictement limitée au même établissement et à un
  // compte qui possède déjà le rôle class_device.
  if (legacyCandidates.length) {
    const { data: legacyProfiles, error: legacyError } = await srv
      .from("profiles")
      .select("id")
      .eq("institution_id", input.institutionId)
      .in("phone", legacyCandidates)
      .limit(4);
    if (legacyError) throw legacyError;

    const reusableUserIds: string[] = [];
    for (const profile of legacyProfiles || []) {
      const uid = String(profile?.id || "").trim();
      if (!uid) continue;

      const [
        { data: classRole, error: classRoleError },
        { data: otherCanonicalClass, error: canonicalError },
        { data: otherLegacyClass, error: legacyClassError },
      ] = await Promise.all([
        srv
          .from("user_roles")
          .select("profile_id")
          .eq("profile_id", uid)
          .eq("institution_id", input.institutionId)
          .eq("role", "class_device")
          .maybeSingle(),
        srv
          .from("classes")
          .select("id")
          .eq("class_device_auth_user_id", uid)
          .neq("id", input.classId)
          .limit(1)
          .maybeSingle(),
        srv
          .from("classes")
          .select("id")
          .eq("institution_id", input.institutionId)
          .in("class_phone_e164", legacyCandidates)
          .neq("id", input.classId)
          .limit(1)
          .maybeSingle(),
      ]);
      if (classRoleError) throw classRoleError;
      if (canonicalError) throw canonicalError;
      if (legacyClassError) throw legacyClassError;
      if (!classRole || otherCanonicalClass || otherLegacyClass) continue;

      const { data: authData, error: authError } =
        await srv.auth.admin.getUserById(uid);
      if (!authError && authData?.user?.id) reusableUserIds.push(uid);
    }

    if (reusableUserIds.length === 1) return reusableUserIds[0];
  }

  const technicalEmail = classDeviceTechnicalEmail(
    input.institutionId,
    input.classId,
  );

  // Recherche via profiles, pas via auth.users exposé par PostgREST.
  const { data: existingTechnical, error: lookupError } = await srv
    .from("profiles")
    .select("id")
    .eq("institution_id", input.institutionId)
    .eq("email", technicalEmail)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existingTechnical?.id) {
    const uid = String(existingTechnical.id);
    const { data: authData, error: authError } =
      await srv.auth.admin.getUserById(uid);
    if (!authError && authData?.user?.id) return uid;
  }

  const { data: created, error: createError } = await srv.auth.admin.createUser({
    email: technicalEmail,
    email_confirm: true,
    password: DEFAULT_TEMP_PASSWORD,
  });
  if (createError || !created?.user?.id) {
    throw createError || new Error("auth_user_create_failed");
  }
  return String(created.user.id);
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const body = await req.json().catch(() => ({} as any));
  const srv = getSupabaseServiceClient();

  const { data: current, error: currentErr } = await srv
    .from("classes")
    .select("id,label,level,code,academic_year,official_track_code,education_type,formation_code,formation_level_code,class_phone_e164,device_phone_e164,class_login_identifier,class_device_auth_user_id")
    .eq("id", id)
    .eq("institution_id", institution_id)
    .maybeSingle();

  if (currentErr) {
    return NextResponse.json({ error: currentErr.message }, { status: 400 });
  }

  if (!current) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const row: Record<string, any> = {};

  if (typeof body.label === "string") row.label = body.label.trim();
  if (typeof body.level === "string") row.level = body.level.trim();
  if (typeof body.code === "string" || body.code === null) row.code = body.code ?? null;
  if (typeof body.academic_year === "string" || body.academic_year === null) {
    row.academic_year = body.academic_year ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "education_type")) {
    if (body.education_type === null || body.education_type === "") {
      row.education_type = null;
    } else if (isEducationType(body.education_type)) {
      row.education_type = body.education_type;
    } else {
      return NextResponse.json({ error: "bad_education_type" }, { status: 400 });
    }
  }
  if (typeof body.formation_code === "string" || body.formation_code === null) {
    row.formation_code = body.formation_code ? body.formation_code.trim() : null;
  }
  if (typeof body.formation_level_code === "string" || body.formation_level_code === null) {
    row.formation_level_code = body.formation_level_code
      ? body.formation_level_code.trim()
      : null;
  }

  const currentEducationType = isEducationType(current.education_type)
    ? current.education_type
    : "general_secondary";
  const nextEducationType = Object.prototype.hasOwnProperty.call(row, "education_type")
    ? isEducationType(row.education_type)
      ? row.education_type
      : "general_secondary"
    : currentEducationType;
  const nextFormationCode = Object.prototype.hasOwnProperty.call(row, "formation_code")
    ? String(row.formation_code || "").trim()
    : String(current.formation_code || "").trim();
  const nextFormationLevelCode = Object.prototype.hasOwnProperty.call(
    row,
    "formation_level_code",
  )
    ? String(row.formation_level_code || "").trim()
    : String(current.formation_level_code || "").trim();
  const nextLevel = Object.prototype.hasOwnProperty.call(row, "level")
    ? String(row.level || "").trim()
    : String(current.level || "").trim();
  const contextChanged =
    nextEducationType !== currentEducationType ||
    nextFormationCode !== String(current.formation_code || "").trim() ||
    nextFormationLevelCode !==
      String(current.formation_level_code || "").trim() ||
    nextLevel !== String(current.level || "").trim();

  if (contextChanged) {
    return NextResponse.json(
      {
        error: "class_context_change_blocked",
        message:
          "Le contexte pédagogique d’une classe ne peut pas être modifié depuis cet écran. Une correction dédiée doit auditer ses élèves, affectations, notes et appels.",
      },
      { status: 409 },
    );
  }

  if (
    Object.prototype.hasOwnProperty.call(body, "official_track_code") ||
    Object.prototype.hasOwnProperty.call(body, "officialTrackCode")
  ) {
    try {
      row.official_track_code = cleanOfficialTrackCode(body.official_track_code ?? body.officialTrackCode ?? null);
    } catch {
      return NextResponse.json({ error: "bad_official_track_code" }, { status: 400 });
    }
  }

  const country =
    typeof body?.country === "string" && body.country.trim() ? String(body.country).trim() : undefined;

  const hasClassIdentifier =
    Object.prototype.hasOwnProperty.call(body, "class_identifier") ||
    Object.prototype.hasOwnProperty.call(body, "class_phone");
  let requestedClassIdentifier: string | null | undefined;
  if (hasClassIdentifier) {
    try {
      requestedClassIdentifier = cleanClassLoginIdentifier(
        Object.prototype.hasOwnProperty.call(body, "class_identifier")
          ? body.class_identifier
          : body.class_phone,
      );
    } catch (cause: any) {
      return NextResponse.json(
        { error: cause?.message || "class_identifier_invalid" },
        { status: 400 },
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "device_phone")) {
    if (body.device_phone === null || body.device_phone === "") {
      row.device_phone_e164 = null;
    } else if (typeof body.device_phone === "string" || typeof body.device_phone === "number") {
      const normalized = normalizePhone(String(body.device_phone), {
        defaultCountryAlpha2: country,
      });
      if (!normalized) {
        return NextResponse.json({ error: "device_phone_invalid" }, { status: 400 });
      }
      row.device_phone_e164 = normalized;
    } else {
      return NextResponse.json({ error: "device_phone_bad_type" }, { status: 400 });
    }
  }

  if (Object.keys(row).length === 0 && !hasClassIdentifier) {
    return NextResponse.json({ error: "bad_payload" }, { status: 400 });
  }

  const nextLabel = typeof row.label === "string" ? row.label : current.label;
  const nextAcademicYear = Object.prototype.hasOwnProperty.call(row, "academic_year")
    ? row.academic_year
    : current.academic_year;

  if (
    nextLabel &&
    (nextLabel !== current.label || nextAcademicYear !== current.academic_year)
  ) {
    let duplicateQuery = srv
      .from("classes")
      .select("id")
      .eq("institution_id", institution_id)
      .eq("label", nextLabel)
      .neq("id", id)
      .limit(1);

    duplicateQuery = nextAcademicYear
      ? duplicateQuery.eq("academic_year", nextAcademicYear)
      : duplicateQuery.is("academic_year", null);

    const { data: duplicate, error: duplicateErr } = await duplicateQuery.maybeSingle();

    if (duplicateErr) {
      return NextResponse.json({ error: duplicateErr.message }, { status: 400 });
    }

    if (duplicate?.id) {
      return NextResponse.json({ error: "class_already_exists_for_academic_year" }, { status: 409 });
    }
  }

  try {
    const currentIdentifier =
      current.class_login_identifier ?? current.class_phone_e164 ?? null;
    const identifierChanged =
      hasClassIdentifier &&
      !sameClassLoginIdentifier(currentIdentifier, requestedClassIdentifier);

    if (identifierChanged && requestedClassIdentifier) {
      const identifierKey = classLoginIdentifierKey(requestedClassIdentifier)!;
      const { data: duplicate, error: duplicateError } = await srv
        .from("classes")
        .select("id")
        .eq("institution_id", institution_id)
        .eq("class_login_identifier_key", identifierKey)
        .neq("id", id)
        .limit(1)
        .maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicate?.id) {
        return NextResponse.json(
          { error: "class_identifier_already_used" },
          { status: 409 },
        );
      }

      const uid = await ensureClassDeviceAuthUser({
        institutionId: institution_id,
        classId: id,
        existingAuthUserId: current.class_device_auth_user_id,
        legacyPhone: current.class_phone_e164,
      });
      row.class_login_identifier = requestedClassIdentifier;
      row.class_device_auth_user_id = uid;

      const { data: existingProfile } = await srv
        .from("profiles")
        .select("id,display_name,phone")
        .eq("id", uid)
        .maybeSingle();

      if (!existingProfile) {
        await srv.from("profiles").insert({
          id: uid,
          institution_id,
          display_name: row.label ?? current.label ?? null,
          email: classDeviceTechnicalEmail(institution_id, id),
          phone: row.device_phone_e164 ?? current.device_phone_e164 ?? null,
        });
      } else {
        await srv
          .from("profiles")
          .update({
            display_name: existingProfile.display_name ?? (row.label ?? current.label ?? null),
          })
          .eq("id", uid);
      }

      await srv
        .from("user_roles")
        .upsert(
          { profile_id: uid, institution_id, role: "class_device" },
          { onConflict: "profile_id,institution_id,role" }
        );
    } else if (identifierChanged && requestedClassIdentifier === null) {
      row.class_login_identifier = null;
      row.class_device_auth_user_id = null;
      row.class_phone_e164 = null;
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: "class_phone_auth_failed", details: e?.message ?? null },
      { status: 400 }
    );
  }

  if (Object.keys(row).length === 0) {
    return NextResponse.json({ item: current });
  }

  const { data, error: dbErr } = await srv
    .from("classes")
    .update(row)
    .eq("id", id)
    .eq("institution_id", institution_id)
    .select("id,label,level,code,academic_year,official_track_code,education_type,formation_code,formation_level_code,class_phone_e164,device_phone_e164,class_login_identifier,class_device_auth_user_id")
    .maybeSingle();

  if (dbErr) {
    const isUnique = (dbErr as any).code === "23505";
    return NextResponse.json({ error: dbErr.message }, { status: isUnique ? 409 : 400 });
  }

  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ item: data });
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { institution_id, error } = await getMyInstitutionId();
  if (error) return error;

  const supabase = getSupabaseServiceClient();
  const { data, error: dbErr } = await supabase
    .from("classes")
    .delete()
    .eq("id", id)
    .eq("institution_id", institution_id)
    .select("id")
    .maybeSingle();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
