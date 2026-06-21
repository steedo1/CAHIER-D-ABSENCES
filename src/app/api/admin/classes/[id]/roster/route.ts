// src/app/api/admin/classes/[id]/roster/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProfileMini = {
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
};

type OfficialTrackCode =
  | "6eme"
  | "5eme"
  | "4eme"
  | "3eme"
  | "2ndeA"
  | "2ndeC"
  | "1ereA1"
  | "1ereA2"
  | "1ereC"
  | "1ereD"
  | "tleA1"
  | "tleA2"
  | "tleC"
  | "tleD";

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

function fullName(row: any) {
  const lastName = cleanText(row?.last_name).toUpperCase();
  const firstName = cleanText(row?.first_name);

  if (lastName && firstName) return `${lastName} ${firstName}`;
  if (lastName) return lastName;
  if (firstName) return firstName;

  return cleanText(row?.full_name);
}

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeNullableText(value: unknown) {
  const s = cleanText(value);
  return s ? s : null;
}

function cleanOfficialTrackCode(value: unknown): OfficialTrackCode | null {
  const raw = cleanText(value);
  if (!raw) return null;
  if (!OFFICIAL_TRACK_CODES.has(raw)) throw new Error("bad_official_track_code");
  return raw as OfficialTrackCode;
}

function isMissingOfficialTrackColumn(error: any) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("official_track_code") && (message.includes("column") || message.includes("schema cache"));
}

function normalizeDateYmd(value: unknown) {
  const s = cleanText(value);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.replace(/\./g, "/").match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function normalizeGender(value: unknown) {
  const s = cleanText(value).toLowerCase();
  if (!s) return null;
  if (s.startsWith("f")) return "F";
  if (s.startsWith("m") || s.startsWith("h") || s.startsWith("g")) return "M";
  return cleanText(value).slice(0, 8).toUpperCase();
}

function normalizeBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const s = cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (!s) return null;
  if (["oui", "yes", "y", "1", "true", "vrai", "r", "x"].includes(s)) return true;
  if (["non", "no", "0", "false", "faux", "n"].includes(s)) return false;
  return null;
}

async function getCurrentAcademicYear(institutionId: string): Promise<string | null> {
  const srv = getSupabaseServiceClient();

  const { data: current } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (current?.code) return String(current.code);

  const { data: latest } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return latest?.code ? String(latest.code) : null;
}

async function getProfileById(id: string | null): Promise<ProfileMini | null> {
  if (!id) return null;

  const srv = getSupabaseServiceClient();
  const { data } = await srv
    .from("profiles")
    .select("id,display_name,email,phone")
    .eq("id", id)
    .maybeSingle();

  if (!data?.id) return null;

  return {
    id: String(data.id),
    display_name: data.display_name ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
  };
}

async function loadEducatorProfiles(ids: string[]): Promise<ProfileMini[]> {
  if (!ids.length) return [];

  const srv = getSupabaseServiceClient();
  const { data: profiles } = await srv
    .from("profiles")
    .select("id,display_name,email,phone")
    .in("id", ids);

  return (profiles || [])
    .map((row: any) => ({
      id: String(row.id),
      display_name: row.display_name ?? null,
      email: row.email ?? null,
      phone: row.phone ?? null,
    }))
    .sort((a, b) =>
      String(a.display_name || a.email || a.phone || "").localeCompare(
        String(b.display_name || b.email || b.phone || ""),
        "fr",
        { sensitivity: "base" },
      ),
    );
}

async function getEducators(
  institutionId: string,
  classId: string,
  classLevel: string | null | undefined,
): Promise<ProfileMini[]> {
  const srv = getSupabaseServiceClient();

  const { data: roles } = await srv
    .from("user_roles")
    .select("profile_id,role")
    .eq("institution_id", institutionId)
    .eq("role", "educator");

  const allEducatorIds = Array.from(
    new Set<string>((roles || []).map((row: any) => String(row.profile_id || "").trim()).filter(Boolean)),
  );

  if (!allEducatorIds.length) return [];

  const { data: assignments, error: assignErr } = await srv
    .from("educator_class_assignments")
    .select("profile_id,level,class_id")
    .eq("institution_id", institutionId)
    .in("profile_id", allEducatorIds);

  // Compatibilité : si la table n’existe pas encore, on affiche tous les éducateurs.
  if (assignErr) return loadEducatorProfiles(allEducatorIds);

  const rows = Array.isArray(assignments) ? assignments : [];
  if (rows.length === 0) return loadEducatorProfiles(allEducatorIds);

  const level = String(classLevel || "").trim();
  const matchingIds = Array.from(
    new Set<string>(
      rows
        .filter((row: any) => {
          const rowClassId = String(row.class_id || "").trim();
          const rowLevel = String(row.level || "").trim();
          if (rowClassId) return rowClassId === classId;
          return !!level && rowLevel === level;
        })
        .map((row: any) => String(row.profile_id || ""))
        .filter(Boolean),
    ),
  );

  return loadEducatorProfiles(matchingIds);
}

async function requireAdminContext(
  classId: string,
  options: { write?: boolean } = {},
) {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  // Important : dans cette base, le rôle n’est pas dans profiles.
  // La source fiable des rôles est public.user_roles.
  const { data: me, error: meErr } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr) return { error: NextResponse.json({ error: meErr.message }, { status: 400 }) };

  const { data: roleRows, error: roleErr } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  if (roleErr) return { error: NextResponse.json({ error: roleErr.message }, { status: 400 }) };

  const allowedRoles = options.write
    ? new Set(["admin", "super_admin"])
    : new Set(["admin", "super_admin", "founder", "finance_manager"]);

  const allowedRoleRows = (roleRows || []).filter((row: any) =>
    allowedRoles.has(String(row.role || "")),
  );

  let institutionId = String((me as any)?.institution_id || "").trim();
  if (!institutionId) {
    const roleInstitution = allowedRoleRows.find((row: any) => row.institution_id)?.institution_id;
    institutionId = roleInstitution ? String(roleInstitution).trim() : "";
  }

  if (!institutionId) {
    return { error: NextResponse.json({ error: "no_institution" }, { status: 400 }) };
  }

  const hasAccess = allowedRoleRows.some((row: any) => {
    const role = String(row.role || "");
    if (role === "super_admin") return true;
    const roleInstitutionId = String(row.institution_id || "").trim();
    // Compatibilité avec les anciens user_roles sans institution_id :
    // lecture/écriture limitée à l'établissement du profil connecté.
    if (!roleInstitutionId) return Boolean(institutionId);
    return roleInstitutionId === institutionId;
  });

  if (!hasAccess) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  const { data: cls, error: classErr } = await srv
    .from("classes")
    .select("id,label,level,code,academic_year,official_track_code,head_teacher_id")
    .eq("id", classId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (classErr) return { error: NextResponse.json({ error: classErr.message }, { status: 400 }) };
  if (!cls) return { error: NextResponse.json({ error: "class_not_found" }, { status: 404 }) };

  return { supa, srv, user, me, institutionId, cls };
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const classId = String(id || "").trim();

  if (!classId) return NextResponse.json({ error: "missing_class_id" }, { status: 400 });

  const ctx = await requireAdminContext(classId);
  if ("error" in ctx) return ctx.error;

  const { srv, institutionId, cls } = ctx;

  const url = new URL(req.url);
  const academicYearParam = String(url.searchParams.get("academic_year") || "").trim();
  const academicYear = academicYearParam || (await getCurrentAcademicYear(institutionId));

  if (academicYear && academicYear !== "all" && String((cls as any).academic_year || "") !== academicYear) {
    return NextResponse.json({ error: "class_not_in_academic_year" }, { status: 404 });
  }

  const [institutionRes, academicYearRes, headTeacher, educators] = await Promise.all([
    srv
      .from("institutions")
      .select(
        [
          "id",
          "name",
          "logo_url",
          "phone",
          "email",
          "regional_direction",
          "postal_address",
          "status",
          "head_name",
          "head_title",
          "country_name",
          "country_motto",
          "ministry_name",
          "code",
          "settings_json",
        ].join(","),
      )
      .eq("id", institutionId)
      .maybeSingle(),
    academicYear && academicYear !== "all"
      ? srv
          .from("academic_years")
          .select("code,label,start_date,end_date,is_current")
          .eq("institution_id", institutionId)
          .eq("code", academicYear)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null } as any),
    getProfileById((cls as any).head_teacher_id ? String((cls as any).head_teacher_id) : null),
    getEducators(institutionId, classId, (cls as any).level),
  ]);

  if (institutionRes.error) {
    return NextResponse.json({ error: institutionRes.error.message }, { status: 400 });
  }

  async function loadEnrollments(includeStudentSeries: boolean) {
    return srv
      .from("class_enrollments")
      .select(
        `
        id,
        student_id,
        start_date,
        end_date${includeStudentSeries ? ",\n        official_track_code" : ""},
        students:student_id(
          id,
          first_name,
          last_name,
          full_name,
          matricule,
          gender,
          birthdate,
          birth_place,
          nationality,
          is_repeater,
          lv2,
          is_affecte,
          is_boarder
        )
      `,
      )
      .eq("institution_id", institutionId)
      .eq("class_id", classId)
      .is("end_date", null);
  }

  let { data: enrollments, error: enrollErr } = await loadEnrollments(true);

  if (enrollErr && isMissingOfficialTrackColumn(enrollErr)) {
    const fallback = await loadEnrollments(false);
    enrollments = fallback.data;
    enrollErr = fallback.error;
  }

  if (enrollErr) {
    return NextResponse.json(
      {
        error:
          enrollErr.message.includes("lv2")
            ? "La colonne students.lv2 est absente. Exécute la migration 20260521_students_lv2.sql dans Supabase, puis réessaie."
            : enrollErr.message,
        details: enrollErr.message,
      },
      { status: 400 },
    );
  }

  const students = (enrollments || [])
    .map((row: any) => {
      const s = row.students || {};
      const sid = String(s.id || row.student_id || "").trim();
      const name = fullName(s) || "—";

      return {
        id: sid,
        matricule: s.matricule ? String(s.matricule) : null,
        full_name: name,
        first_name: s.first_name ?? null,
        last_name: s.last_name ?? null,
        gender: s.gender ?? null,
        birthdate: s.birthdate ?? null,
        birth_place: s.birth_place ?? null,
        nationality: s.nationality ?? null,
        is_repeater:
          typeof s.is_repeater === "boolean"
            ? s.is_repeater
            : null,
        lv2: s.lv2 ?? null,
        is_affecte: typeof s.is_affecte === "boolean" ? s.is_affecte : null,
        is_boarder: typeof s.is_boarder === "boolean" ? s.is_boarder : null,
        official_track_code: cleanOfficialTrackCode((row as any).official_track_code ?? null),
        enrollment_start_date: row.start_date ?? null,
      };
    })
    .filter((row: any) => row.id)
    .sort((a: any, b: any) =>
      String(a.full_name || "").localeCompare(String(b.full_name || ""), "fr", {
        sensitivity: "base",
        numeric: true,
      }),
    );

  const institution = (institutionRes.data || {}) as Record<string, any>;
  const rawSettings = institution.settings_json;
  const settings =
    rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)
      ? (rawSettings as Record<string, any>)
      : {};
  const institutionName =
    cleanText(institution.name) ||
    cleanText(settings.institution_name || settings.school_name || settings.name);

  return NextResponse.json({
    ok: true,
    class: {
      id: String((cls as any).id),
      label: String((cls as any).label || (cls as any).code || "Classe"),
      level: (cls as any).level ?? null,
      code: (cls as any).code ?? null,
      academic_year: (cls as any).academic_year ?? null,
      official_track_code: (cls as any).official_track_code ?? null,
    },
    academic_year: academicYearRes.data
      ? {
          code: academicYearRes.data.code ?? academicYear ?? null,
          label: academicYearRes.data.label ?? academicYear ?? null,
          start_date: academicYearRes.data.start_date ?? null,
          end_date: academicYearRes.data.end_date ?? null,
          is_current: academicYearRes.data.is_current === true,
        }
      : {
          code: academicYear ?? (cls as any).academic_year ?? null,
          label: academicYear ?? (cls as any).academic_year ?? null,
          start_date: null,
          end_date: null,
          is_current: false,
        },
    institution: {
      id: String(institution?.id || institutionId),
      name: institutionName || "Établissement",
      acronym: null,
      logo_url: institution?.logo_url ?? null,
      phone: institution?.phone ?? null,
      email: institution?.email ?? null,
      regional_direction: institution?.regional_direction ?? null,
      postal_address: institution?.postal_address ?? null,
      status: institution?.status ?? null,
      head_name: institution?.head_name ?? null,
      head_title: institution?.head_title ?? null,
      country_name: institution?.country_name ?? null,
      country_motto: institution?.country_motto ?? null,
      ministry_name: institution?.ministry_name ?? null,
      code: institution?.code ?? null,
    },
    staff: {
      head_teacher: headTeacher,
      educators,
    },
    students,
    totals: {
      students: students.length,
      girls: students.filter((s: any) => /^f/i.test(String(s.gender || ""))).length,
      boys: students.filter((s: any) => /^m/i.test(String(s.gender || ""))).length,
    },
  });
}

async function getAcademicYearIdForFinance(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  academicYear: string | null,
) {
  if (!academicYear) return null;

  const { data, error } = await srv
    .from("academic_years")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("code", academicYear)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}

async function ensureFinanceChargesForStudent(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  userId: string,
  studentId: string,
  classId: string,
) {
  const { data: classRow, error: classErr } = await srv
    .from("classes")
    .select("id,label,level,academic_year,institution_id")
    .eq("id", classId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (classErr) throw new Error(classErr.message);
  if (!classRow) throw new Error("Classe introuvable.");

  const { data: schedules, error: scheduleErr } = await srv
    .schema("finance")
    .from("fee_schedules")
    .select("id,school_id,academic_year,class_id,fee_category_id,label,amount,due_date,is_active,notes")
    .eq("school_id", institutionId)
    .eq("class_id", classId)
    .eq("is_active", true);

  if (scheduleErr) throw new Error(scheduleErr.message);

  const scheduleRows = Array.isArray(schedules) ? schedules : [];
  if (scheduleRows.length === 0) return 0;

  const scheduleIds = scheduleRows.map((row: any) => String(row.id)).filter(Boolean);

  const { data: existingCharges, error: existingErr } = await srv
    .schema("finance")
    .from("student_charges")
    .select("fee_schedule_id")
    .eq("school_id", institutionId)
    .eq("student_id", studentId)
    .eq("class_id", classId)
    .in("fee_schedule_id", scheduleIds);

  if (existingErr) throw new Error(existingErr.message);

  const existing = new Set(
    (existingCharges || [])
      .map((row: any) => String(row.fee_schedule_id || ""))
      .filter(Boolean),
  );

  const academicYear = String((classRow as any).academic_year || "").trim() || null;
  const academicYearId = await getAcademicYearIdForFinance(
    srv,
    institutionId,
    academicYear,
  );
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  const rowsToInsert = scheduleRows
    .filter((schedule: any) => !existing.has(String(schedule.id)))
    .map((schedule: any) => ({
      school_id: institutionId,
      academic_year_id: academicYearId,
      academic_year: schedule.academic_year || academicYear,
      student_id: studentId,
      class_id: classId,
      fee_schedule_id: schedule.id,
      fee_category_id: schedule.fee_category_id,
      label: schedule.label,
      base_amount: Number(schedule.amount || 0),
      due_date: schedule.due_date || null,
      charge_date: today,
      status: "pending",
      notes:
        schedule.notes ||
        "Situation créée automatiquement depuis " + schedule.label,
      created_by: userId,
      created_at: nowIso,
      updated_at: nowIso,
    }));

  if (rowsToInsert.length === 0) return 0;

  const { error: insertErr } = await srv
    .schema("finance")
    .from("student_charges")
    .insert(rowsToInsert as any[]);

  if (insertErr) throw new Error(insertErr.message);
  return rowsToInsert.length;
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const classId = String(id || "").trim();
  if (!classId) return NextResponse.json({ error: "missing_class_id" }, { status: 400 });

  const ctx = await requireAdminContext(classId, { write: true });
  if ("error" in ctx) return ctx.error;

  const { srv, institutionId } = ctx;
  const body = await req.json().catch(() => ({}));
  const lastName = normalizeNullableText(body?.last_name);
  const firstName = normalizeNullableText(body?.first_name);
  const matricule = normalizeNullableText(body?.matricule);

  if (!lastName) {
    return NextResponse.json({ error: "Le nom de l’élève est obligatoire." }, { status: 400 });
  }
  if (!firstName) {
    return NextResponse.json({ error: "Le prénom de l’élève est obligatoire." }, { status: 400 });
  }

  if (matricule) {
    const { data: duplicate, error: dupErr } = await srv
      .from("students")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("matricule", matricule)
      .maybeSingle();

    if (dupErr) return NextResponse.json({ error: dupErr.message }, { status: 400 });
    if (duplicate?.id) {
      return NextResponse.json(
        { error: "Ce matricule existe déjà dans cet établissement." },
        { status: 400 },
      );
    }
  }

  const { data: created, error: createErr } = await srv
    .from("students")
    .insert({
      institution_id: institutionId,
      first_name: firstName,
      last_name: lastName,
      full_name: `${lastName} ${firstName}`.trim(),
      matricule,
    } as any)
    .select("id")
    .maybeSingle();

  if (createErr) return NextResponse.json({ error: createErr.message }, { status: 400 });
  if (!created?.id) return NextResponse.json({ error: "Impossible de créer l’élève." }, { status: 400 });

  const today = new Date().toISOString().slice(0, 10);
  const { error: enrollErr } = await srv.from("class_enrollments").upsert(
    [
      {
        institution_id: institutionId,
        class_id: classId,
        student_id: created.id,
        start_date: today,
        end_date: null,
      },
    ],
    { onConflict: "class_id,student_id", ignoreDuplicates: true },
  );

  if (enrollErr) return NextResponse.json({ error: enrollErr.message }, { status: 400 });

  let chargesCreated = 0;
  let financeWarning: string | null = null;
  try {
    chargesCreated = await ensureFinanceChargesForStudent(
      srv,
      institutionId,
      ctx.user.id,
      String(created.id),
      classId,
    );
  } catch (error) {
    financeWarning =
      error instanceof Error ? error.message : "Génération automatique des frais impossible.";
  }

  return NextResponse.json({
    ok: true,
    student_id: created.id,
    charges_created: chargesCreated,
    finance_warning: financeWarning,
  });
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const classId = String(id || "").trim();
  if (!classId) return NextResponse.json({ error: "missing_class_id" }, { status: 400 });

  const ctx = await requireAdminContext(classId, { write: true });
  if ("error" in ctx) return ctx.error;

  const { srv, institutionId } = ctx;
  const body = await req.json().catch(() => ({}));
  const updates = Array.isArray(body?.updates) ? body.updates : [];

  if (!updates.length) return NextResponse.json({ ok: true, updated: 0 });
  if (updates.length > 200) {
    return NextResponse.json({ error: "too_many_updates" }, { status: 400 });
  }

  const requestedIds = Array.from(
    new Set(updates.map((row: any) => cleanText(row?.student_id)).filter(Boolean)),
  );

  if (!requestedIds.length) return NextResponse.json({ ok: true, updated: 0 });

  const { data: allowedRows, error: allowedErr } = await srv
    .from("class_enrollments")
    .select("student_id")
    .eq("institution_id", institutionId)
    .eq("class_id", classId)
    .is("end_date", null)
    .in("student_id", requestedIds);

  if (allowedErr) return NextResponse.json({ error: allowedErr.message }, { status: 400 });

  const allowed = new Set((allowedRows || []).map((row: any) => String(row.student_id)));

  let rows: Array<{
    student_id: string;
    patch: Record<string, any>;
    matricule: string | null;
    official_track_code: OfficialTrackCode | null;
  }> = [];

  try {
    rows = updates
      .map((row: any) => {
        const studentId = cleanText(row?.student_id);
        if (!studentId || !allowed.has(studentId)) return null;

        const firstName = normalizeNullableText(row?.first_name);
        const lastName = normalizeNullableText(row?.last_name);
        const matricule = normalizeNullableText(row?.matricule)?.toUpperCase() ?? null;
        const normalizedFullName = [lastName, firstName].filter(Boolean).join(" ").trim();

        if (!normalizedFullName) throw new Error("missing_student_name");

        return {
          student_id: studentId,
          patch: {
            first_name: firstName,
            last_name: lastName,
            full_name: normalizedFullName,
            gender: normalizeGender(row?.gender),
            birthdate: normalizeDateYmd(row?.birthdate),
            birth_place: normalizeNullableText(row?.birth_place),
            nationality: normalizeNullableText(row?.nationality),
            is_repeater: normalizeBool(row?.is_repeater),
            lv2: normalizeNullableText(row?.lv2)?.toUpperCase() ?? null,
            is_affecte: normalizeBool(row?.is_affecte),
            is_boarder: normalizeBool(row?.is_boarder),
          },
          matricule,
          official_track_code: cleanOfficialTrackCode(row?.official_track_code ?? null),
        };
      })
      .filter(Boolean) as Array<{
        student_id: string;
        patch: Record<string, any>;
        matricule: string | null;
        official_track_code: OfficialTrackCode | null;
      }>;
  } catch (error) {
    if ((error as Error)?.message === "bad_official_track_code") {
      return NextResponse.json({ error: "bad_official_track_code" }, { status: 400 });
    }
    if ((error as Error)?.message === "missing_student_name") {
      return NextResponse.json(
        { error: "Le nom complet de chaque élève est obligatoire." },
        { status: 400 },
      );
    }
    throw error;
  }

  if (!rows.length) return NextResponse.json({ ok: true, updated: 0 });

  const matriculesToCheck = rows
    .map((row) => row.matricule)
    .filter((matricule): matricule is string => Boolean(matricule));

  if (matriculesToCheck.length > 0) {
    const matriculeCounts = new Map<string, number>();
    for (const matricule of matriculesToCheck) {
      matriculeCounts.set(matricule, (matriculeCounts.get(matricule) || 0) + 1);
    }

    const duplicatedInRequest = Array.from(matriculeCounts.entries()).find(([, count]) => count > 1);
    if (duplicatedInRequest) {
      return NextResponse.json(
        { error: `Le matricule ${duplicatedInRequest[0]} est saisi plusieurs fois dans cette liste.` },
        { status: 400 },
      );
    }

    const uniqueMatricules = Array.from(new Set(matriculesToCheck));
    const { data: duplicates, error: duplicateErr } = await srv
      .from("students")
      .select("id,matricule")
      .eq("institution_id", institutionId)
      .in("matricule", uniqueMatricules);

    if (duplicateErr) return NextResponse.json({ error: duplicateErr.message }, { status: 400 });

    const duplicatesByMatricule = new Map<string, string[]>();
    for (const duplicate of duplicates || []) {
      const key = String((duplicate as any).matricule || "").trim().toUpperCase();
      const id = String((duplicate as any).id || "");
      if (!key || !id) continue;
      duplicatesByMatricule.set(key, [...(duplicatesByMatricule.get(key) || []), id]);
    }

    for (const row of rows) {
      if (!row.matricule) continue;
      const owners = duplicatesByMatricule.get(row.matricule) || [];
      if (owners.some((id) => id !== row.student_id)) {
        return NextResponse.json(
          { error: `Le matricule ${row.matricule} existe déjà dans cet établissement.` },
          { status: 400 },
        );
      }
    }
  }

  let updated = 0;

  for (const row of rows) {
    const { error } = await srv
      .from("students")
      .update({ ...row.patch, matricule: row.matricule })
      .eq("id", row.student_id)
      .eq("institution_id", institutionId);

    if (error) {
      return NextResponse.json(
        {
          error:
            error.message.includes("lv2")
              ? "La colonne students.lv2 est absente. Exécute la migration 20260521_students_lv2.sql dans Supabase, puis réessaie."
              : error.message,
          details: error.message,
        },
        { status: 400 },
      );
    }

    const { error: enrollmentErr } = await srv
      .from("class_enrollments")
      .update({ official_track_code: row.official_track_code })
      .eq("institution_id", institutionId)
      .eq("class_id", classId)
      .eq("student_id", row.student_id)
      .is("end_date", null);

    if (enrollmentErr) {
      return NextResponse.json(
        {
          error: isMissingOfficialTrackColumn(enrollmentErr)
            ? "La colonne class_enrollments.official_track_code est absente. Exécutez src/db/class_enrollments_student_series_v1.sql dans Supabase, puis réessayez."
            : enrollmentErr.message,
          details: enrollmentErr.message,
        },
        { status: 400 },
      );
    }

    updated++;
  }

  return NextResponse.json({ ok: true, updated });
}
