// src/app/api/admin/classes/[id]/roster/route.ts
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { hasStudentIdentityConflict, STUDENT_IDENTITY_CONFLICT_MESSAGE } from "@/lib/student-identity-conflicts";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  applyStudentFinanceReconciliation,
  reconcileFinanceChargesForStudent,
  type FinanceSyncResult,
} from "@/lib/finance/student-finance-sync";
import {
  transferStudentToSeriesClass,
  type StudentSeriesTargetClass,
} from "@/lib/student-series-class-transfer";

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

type FinanceStudentProfile = {
  is_affecte: boolean | null;
  is_boarder: boolean | null;
};

function fullName(row: any) {
  const lastName = cleanText(row?.last_name).toUpperCase();
  const firstName = cleanText(row?.first_name);

  if (lastName && firstName) return `${lastName} ${firstName}`;
  if (lastName) return lastName;
  if (firstName) return firstName;

  return cleanText(row?.full_name);
}

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNullableText(value: unknown) {
  const s = cleanText(value);
  return s ? s : null;
}

function cleanOfficialTrackCode(value: unknown): OfficialTrackCode | null {
  const raw = cleanText(value);
  if (!raw) return null;
  if (!OFFICIAL_TRACK_CODES.has(raw))
    throw new Error("bad_official_track_code");
  return raw as OfficialTrackCode;
}

function normalizeTrackLookupKey(value: unknown) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function inferClassOfficialTrackCode(
  row: StudentSeriesTargetClass | null | undefined,
): OfficialTrackCode | null {
  const explicit = cleanText(row?.official_track_code);
  if (OFFICIAL_TRACK_CODES.has(explicit)) return explicit as OfficialTrackCode;

  for (const value of [row?.label, row?.code, row?.level]) {
    const key = normalizeTrackLookupKey(value);
    if (!key) continue;

    if (/^6/.test(key)) return "6eme";
    if (/^5/.test(key)) return "5eme";
    if (/^4/.test(key)) return "4eme";
    if (/^3/.test(key)) return "3eme";
    if (/^(2NDEA|SECONDEA|2A)/.test(key)) return "2ndeA";
    if (/^(2NDEC|SECONDEC|2C)/.test(key)) return "2ndeC";
    if (/^(1EREA1|PREMIEREA1|1A1)/.test(key)) return "1ereA1";
    if (/^(1EREA2|PREMIEREA2|1A2)/.test(key)) return "1ereA2";
    if (/^(1EREC|PREMIEREC|1C)/.test(key)) return "1ereC";
    if (/^(1ERED|PREMIERED|1D)/.test(key)) return "1ereD";
    if (/^(TLEA1|TERMINALEA1|TA1)/.test(key)) return "tleA1";
    if (/^(TLEA2|TERMINALEA2|TA2)/.test(key)) return "tleA2";
    if (/^(TLEC|TERMINALEC|TC)/.test(key)) return "tleC";
    if (/^(TLED|TERMINALED|TD)/.test(key)) return "tleD";
  }

  return null;
}

function officialTrackLabel(code: OfficialTrackCode) {
  const labels: Record<OfficialTrackCode, string> = {
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
  return labels[code];
}

function isMissingOfficialTrackColumn(error: any) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("official_track_code") &&
    (message.includes("column") || message.includes("schema cache"))
  );
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
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (!s) return null;
  if (["oui", "yes", "y", "1", "true", "vrai", "r", "x"].includes(s))
    return true;
  if (["non", "no", "0", "false", "faux", "n"].includes(s)) return false;
  return null;
}

async function getCurrentAcademicYear(
  institutionId: string,
): Promise<string | null> {
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

  const [{ data: roles }, { data: assignments, error: assignErr }] = await Promise.all([
    srv.from("user_roles").select("profile_id,role")
      .eq("institution_id", institutionId).eq("role", "educator"),
    srv.from("educator_class_assignments").select("profile_id,level,class_id")
      .eq("institution_id", institutionId),
  ]);

  const allEducatorIds = Array.from(
    new Set<string>(
      (roles || [])
        .map((row: any) => String(row.profile_id || "").trim())
        .filter(Boolean),
    ),
  );

  if (!allEducatorIds.length) return [];

  // Compatibilité : si la table n’existe pas encore, on affiche tous les éducateurs.
  if (assignErr) return loadEducatorProfiles(allEducatorIds);

  const educatorIds = new Set(allEducatorIds);
  const rows = Array.isArray(assignments)
    ? assignments.filter((row: any) => educatorIds.has(String(row.profile_id)))
    : [];
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
    return {
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  // Important : dans cette base, le rôle n’est pas dans profiles.
  // La source fiable des rôles est public.user_roles.
  const [{ data: me, error: meErr }, { data: roleRows, error: roleErr }] = await Promise.all([
    supa.from("profiles").select("id,institution_id").eq("id", user.id).maybeSingle(),
    srv.from("user_roles").select("role,institution_id").eq("profile_id", user.id),
  ]);

  if (meErr)
    return {
      error: NextResponse.json({ error: meErr.message }, { status: 400 }),
    };

  if (roleErr)
    return {
      error: NextResponse.json({ error: roleErr.message }, { status: 400 }),
    };

  const allowedRoles = options.write
    ? new Set(["admin", "super_admin", "founder", "finance_manager", "finance"])
    : new Set([
        "admin",
        "super_admin",
        "founder",
        "finance_manager",
        "finance",
      ]);

  const allowedRoleRows = (roleRows || []).filter((row: any) =>
    allowedRoles.has(String(row.role || "")),
  );

  let institutionId = String((me as any)?.institution_id || "").trim();
  if (!institutionId) {
    const roleInstitution = allowedRoleRows.find(
      (row: any) => row.institution_id,
    )?.institution_id;
    institutionId = roleInstitution ? String(roleInstitution).trim() : "";
  }

  if (!institutionId) {
    return {
      error: NextResponse.json({ error: "no_institution" }, { status: 400 }),
    };
  }

  const roleAppliesToInstitution = (row: any) => {
    const role = String(row.role || "");
    if (role === "super_admin") return true;
    const roleInstitutionId = String(row.institution_id || "").trim();
    // Compatibilité avec les anciens user_roles sans institution_id :
    // lecture/écriture limitée à l'établissement du profil connecté.
    if (!roleInstitutionId) return Boolean(institutionId);
    return roleInstitutionId === institutionId;
  };

  const hasAccess = allowedRoleRows.some(roleAppliesToInstitution);
  const writeRoles = new Set([
    "admin",
    "super_admin",
    "founder",
    "finance_manager",
    "finance",
  ]);
  const canWrite = (roleRows || []).some((row: any) => {
    const role = String(row.role || "");
    return writeRoles.has(role) && roleAppliesToInstitution(row);
  });

  if (!hasAccess) {
    return {
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }

  const { data: cls, error: classErr } = await srv
    .from("classes")
    .select(
      "id,label,level,code,academic_year,official_track_code,education_type,formation_code,formation_level_code,head_teacher_id",
    )
    .eq("id", classId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (classErr)
    return {
      error: NextResponse.json({ error: classErr.message }, { status: 400 }),
    };
  if (!cls)
    return {
      error: NextResponse.json({ error: "class_not_found" }, { status: 404 }),
    };

  return { supa, srv, user, me, institutionId, cls, canWrite };
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const startedAt = performance.now();
  let accessMs = 0;
  const respond = (body: unknown, options?: { status: number }) => {
    const totalMs = performance.now() - startedAt;
    const timings = { access_ms: Math.round(accessMs), data_ms: Math.round(totalMs - accessMs), total_ms: Math.round(totalMs) };
    if (totalMs >= 2000) console.warn("[class-roster] slow_request", { ...timings, status: options?.status || 200 });
    return NextResponse.json(body, { ...options, headers: {
      "Cache-Control": "private, no-store",
      "Server-Timing": `access;dur=${accessMs.toFixed(1)}, data;dur=${(totalMs - accessMs).toFixed(1)}, total;dur=${totalMs.toFixed(1)}`,
    } });
  };
  const { id } = await context.params;
  const classId = String(id || "").trim();

  if (!classId)
    return respond({ error: "missing_class_id" }, { status: 400 });

  const ctx = await requireAdminContext(classId);
  accessMs = performance.now() - startedAt;
  if ("error" in ctx) return ctx.error;

  const { srv, institutionId, cls, canWrite } = ctx;

  const url = new URL(req.url);
  const academicYearParam = String(
    url.searchParams.get("academic_year") || "",
  ).trim();
  const academicYear =
    academicYearParam || (await getCurrentAcademicYear(institutionId));

  if (
    academicYear &&
    academicYear !== "all" &&
    String((cls as any).academic_year || "") !== academicYear
  ) {
    return respond(
      { error: "class_not_in_academic_year" },
      { status: 404 },
    );
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

  const [institutionRes, academicYearRes, headTeacher, educators, enrollmentRes] =
    await Promise.all([
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
      getProfileById(
        (cls as any).head_teacher_id
          ? String((cls as any).head_teacher_id)
          : null,
      ),
      getEducators(institutionId, classId, (cls as any).level),
      loadEnrollments(true),
    ]);

  if (institutionRes.error) {
    return respond(
      { error: institutionRes.error.message },
      { status: 400 },
    );
  }

  let { data: enrollments, error: enrollErr } = enrollmentRes;

  if (enrollErr && isMissingOfficialTrackColumn(enrollErr)) {
    const fallback = await loadEnrollments(false);
    enrollments = fallback.data;
    enrollErr = fallback.error;
  }

  if (enrollErr) {
    return respond(
      {
        error: enrollErr.message.includes("lv2")
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
        is_repeater: typeof s.is_repeater === "boolean" ? s.is_repeater : null,
        lv2: s.lv2 ?? null,
        is_affecte: typeof s.is_affecte === "boolean" ? s.is_affecte : null,
        is_boarder: typeof s.is_boarder === "boolean" ? s.is_boarder : null,
        official_track_code: cleanOfficialTrackCode(
          (row as any).official_track_code ?? null,
        ),
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
    rawSettings &&
    typeof rawSettings === "object" &&
    !Array.isArray(rawSettings)
      ? (rawSettings as Record<string, any>)
      : {};
  const institutionName =
    cleanText(institution.name) ||
    cleanText(
      settings.institution_name || settings.school_name || settings.name,
    );

  return respond({
    ok: true,
    can_edit: canWrite,
    class: {
      id: String((cls as any).id),
      label: String((cls as any).label || (cls as any).code || "Classe"),
      level: (cls as any).level ?? null,
      code: (cls as any).code ?? null,
      academic_year: (cls as any).academic_year ?? null,
      official_track_code: (cls as any).official_track_code ?? null,
      education_type: (cls as any).education_type ?? null,
      formation_code: (cls as any).formation_code ?? null,
      formation_level_code: (cls as any).formation_level_code ?? null,
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
      girls: students.filter((s: any) => /^f/i.test(String(s.gender || "")))
        .length,
      boys: students.filter((s: any) => /^m/i.test(String(s.gender || "")))
        .length,
    },
  });
}

async function loadFinanceProfilesForStudents(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  classId: string,
  studentIds: string[],
): Promise<
  Array<{
    student_id: string;
    official_track_code: OfficialTrackCode | null;
    profile: FinanceStudentProfile;
  }>
> {
  const ids = Array.from(
    new Set(studentIds.map((id) => cleanText(id)).filter(Boolean)),
  );
  if (ids.length === 0) return [];

  const { data, error } = await srv
    .from("class_enrollments")
    .select(
      `
      student_id,
      official_track_code,
      students:student_id(is_affecte,is_boarder)
    `,
    )
    .eq("institution_id", institutionId)
    .eq("class_id", classId)
    .is("end_date", null)
    .in("student_id", ids);

  if (error) throw new Error(error.message);

  return (data || [])
    .map((row: any) => {
      const student = row.students || {};
      const studentId = cleanText(row.student_id);
      if (!studentId) return null;
      return {
        student_id: studentId,
        official_track_code: cleanOfficialTrackCode(
          row.official_track_code ?? null,
        ),
        profile: {
          is_affecte:
            typeof student.is_affecte === "boolean" ? student.is_affecte : null,
          is_boarder:
            typeof student.is_boarder === "boolean" ? student.is_boarder : null,
        },
      };
    })
    .filter(Boolean) as Array<{
    student_id: string;
    official_track_code: OfficialTrackCode | null;
    profile: FinanceStudentProfile;
  }>;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const classId = String(id || "").trim();
  if (!classId)
    return NextResponse.json({ error: "missing_class_id" }, { status: 400 });

  const ctx = await requireAdminContext(classId, { write: true });
  if ("error" in ctx) return ctx.error;

  const { srv, institutionId } = ctx;
  const body = await req.json().catch(() => ({}));
  const lastName = normalizeNullableText(body?.last_name);
  const firstName = normalizeNullableText(body?.first_name);
  const matricule = normalizeNullableText(body?.matricule);
  const isAffecte = normalizeBool(body?.is_affecte);
  const isBoarder = normalizeBool(body?.is_boarder);

  if (!lastName) {
    return NextResponse.json(
      { error: "Le nom de l’élève est obligatoire." },
      { status: 400 },
    );
  }
  if (!firstName) {
    return NextResponse.json(
      { error: "Le prénom de l’élève est obligatoire." },
      { status: 400 },
    );
  }
  if (isAffecte === null || isBoarder === null) {
    return NextResponse.json(
      {
        error:
          "Affectation et internat sont obligatoires pour générer une dette fiable.",
      },
      { status: 400 },
    );
  }

  if (matricule) {
    const { data: duplicate, error: dupErr } = await srv
      .from("students")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("matricule", matricule)
      .maybeSingle();

    if (dupErr)
      return NextResponse.json({ error: dupErr.message }, { status: 400 });
    if (duplicate?.id) {
      return NextResponse.json(
        { error: "Ce matricule existe déjà dans cet établissement." },
        { status: 400 },
      );
    }
  }

  try {
    if (await hasStudentIdentityConflict(srv, institutionId, lastName, firstName, matricule)) {
      return NextResponse.json({ error: STUDENT_IDENTITY_CONFLICT_MESSAGE, code: "student_identity_exists" }, { status: 409 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Impossible de vérifier l’identité." }, { status: 400 });
  }

  const { data: created, error: createErr } = await srv
    .from("students")
    .insert({
      institution_id: institutionId,
      first_name: firstName,
      last_name: lastName,
      full_name: `${lastName} ${firstName}`.trim(),
      matricule,
      is_affecte: isAffecte,
      is_boarder: isBoarder,
    } as any)
    .select("id")
    .maybeSingle();

  if (createErr)
    return NextResponse.json({ error: createErr.message }, { status: 400 });
  if (!created?.id)
    return NextResponse.json(
      { error: "Impossible de créer l’élève." },
      { status: 400 },
    );

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

  if (enrollErr) {
    await srv
      .from("students")
      .delete()
      .eq("id", created.id)
      .eq("institution_id", institutionId);
    return NextResponse.json({ error: enrollErr.message }, { status: 400 });
  }

  let chargesCreated = 0;
  let financeWarnings: string[] = [];
  try {
    const result = await reconcileFinanceChargesForStudent(
      srv,
      institutionId,
      ctx.user.id,
      String(created.id),
      classId,
      { is_affecte: isAffecte, is_boarder: isBoarder },
    );
    chargesCreated =
      result.inserted + result.reactivated + result.updated_amount;
    financeWarnings = result.warnings;
  } catch (error) {
    await srv
      .from("class_enrollments")
      .delete()
      .eq("institution_id", institutionId)
      .eq("class_id", classId)
      .eq("student_id", created.id);
    await srv
      .from("students")
      .delete()
      .eq("id", created.id)
      .eq("institution_id", institutionId);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Génération automatique des frais impossible.",
        details:
          "Création annulée : aucune fiche élève sans synchronisation financière n'a été conservée.",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    student_id: created.id,
    charges_created: chargesCreated,
    finance_warning: financeWarnings[0] || null,
    finance_warnings: financeWarnings,
  });
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const classId = String(id || "").trim();
  if (!classId)
    return NextResponse.json({ error: "missing_class_id" }, { status: 400 });

  const ctx = await requireAdminContext(classId, { write: true });
  if ("error" in ctx) return ctx.error;

  const { srv, institutionId, cls } = ctx;
  const body = await req.json().catch(() => ({}));
  const updates = Array.isArray(body?.updates) ? body.updates : [];
  const forceFinanceSync = body?.force_finance_sync === true;
  const syncOnlyIds = Array.isArray(body?.student_ids)
    ? Array.from(
        new Set(
          body.student_ids.map((id: any) => cleanText(id)).filter(Boolean),
        ),
      )
    : [];

  if (!updates.length && !forceFinanceSync)
    return NextResponse.json({ ok: true, updated: 0 });
  if (updates.length > 200 || syncOnlyIds.length > 200) {
    return NextResponse.json({ error: "too_many_updates" }, { status: 400 });
  }

  const updateIds = updates
    .map((row: any) => cleanText(row?.student_id))
    .filter(Boolean);
  const requestedIds = Array.from(new Set([...updateIds, ...syncOnlyIds]));

  if (!requestedIds.length) return NextResponse.json({ ok: true, updated: 0 });

  const { data: allowedRows, error: allowedErr } = await srv
    .from("class_enrollments")
    .select("student_id")
    .eq("institution_id", institutionId)
    .eq("class_id", classId)
    .is("end_date", null)
    .in("student_id", requestedIds);

  if (allowedErr)
    return NextResponse.json({ error: allowedErr.message }, { status: 400 });

  const allowed = new Set(
    (allowedRows || []).map((row: any) => String(row.student_id)),
  );

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
        const matricule =
          normalizeNullableText(row?.matricule)?.toUpperCase() ?? null;
        const normalizedFullName = [lastName, firstName]
          .filter(Boolean)
          .join(" ")
          .trim();
        const isAffecte = normalizeBool(row?.is_affecte);
        const isBoarder = normalizeBool(row?.is_boarder);

        if (!normalizedFullName) throw new Error("missing_student_name");
        if (isAffecte === null || isBoarder === null) {
          throw new Error("missing_finance_profile");
        }

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
            is_affecte: isAffecte,
            is_boarder: isBoarder,
          },
          matricule,
          official_track_code: cleanOfficialTrackCode(
            row?.official_track_code ?? null,
          ),
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
      return NextResponse.json(
        { error: "bad_official_track_code" },
        { status: 400 },
      );
    }
    if ((error as Error)?.message === "missing_student_name") {
      return NextResponse.json(
        { error: "Le nom complet de chaque élève est obligatoire." },
        { status: 400 },
      );
    }
    if ((error as Error)?.message === "missing_finance_profile") {
      return NextResponse.json(
        {
          error:
            "Affectation et internat sont obligatoires. Aucune dette n'a été modifiée.",
        },
        { status: 400 },
      );
    }
    throw error;
  }

  if (!rows.length && !forceFinanceSync)
    return NextResponse.json({ ok: true, updated: 0 });

  const matriculesToCheck = rows
    .map((row) => row.matricule)
    .filter((matricule): matricule is string => Boolean(matricule));

  if (matriculesToCheck.length > 0) {
    const matriculeCounts = new Map<string, number>();
    for (const matricule of matriculesToCheck) {
      matriculeCounts.set(matricule, (matriculeCounts.get(matricule) || 0) + 1);
    }

    const duplicatedInRequest = Array.from(matriculeCounts.entries()).find(
      ([, count]) => count > 1,
    );
    if (duplicatedInRequest) {
      return NextResponse.json(
        {
          error: `Le matricule ${duplicatedInRequest[0]} est saisi plusieurs fois dans cette liste.`,
        },
        { status: 400 },
      );
    }

    const uniqueMatricules = Array.from(new Set(matriculesToCheck));
    const { data: duplicates, error: duplicateErr } = await srv
      .from("students")
      .select("id,matricule")
      .eq("institution_id", institutionId)
      .in("matricule", uniqueMatricules);

    if (duplicateErr)
      return NextResponse.json(
        { error: duplicateErr.message },
        { status: 400 },
      );

    const duplicatesByMatricule = new Map<string, string[]>();
    for (const duplicate of duplicates || []) {
      const key = String((duplicate as any).matricule || "")
        .trim()
        .toUpperCase();
      const id = String((duplicate as any).id || "");
      if (!key || !id) continue;
      duplicatesByMatricule.set(key, [
        ...(duplicatesByMatricule.get(key) || []),
        id,
      ]);
    }

    for (const row of rows) {
      if (!row.matricule) continue;
      const owners = duplicatesByMatricule.get(row.matricule) || [];
      if (owners.some((id) => id !== row.student_id)) {
        return NextResponse.json(
          {
            error: `Le matricule ${row.matricule} existe déjà dans cet établissement.`,
          },
          { status: 400 },
        );
      }
    }
  }

  const [studentSnapshotsResult, enrollmentSnapshotsResult] = await Promise.all(
    [
      rows.length > 0
        ? srv
            .from("students")
            .select(
              "id,institution_id,first_name,last_name,full_name,matricule,gender,birthdate,birth_place,nationality,is_repeater,lv2,is_affecte,is_boarder",
            )
            .in(
              "id",
              rows.map((row) => row.student_id),
            )
        : Promise.resolve({ data: [], error: null } as any),
      rows.length > 0
        ? srv
            .from("class_enrollments")
            .select(
              "id,institution_id,class_id,student_id,start_date,end_date,official_track_code",
            )
            .eq("institution_id", institutionId)
            .eq("class_id", classId)
            .is("end_date", null)
            .in(
              "student_id",
              rows.map((row) => row.student_id),
            )
        : Promise.resolve({ data: [], error: null } as any),
    ],
  );

  if (studentSnapshotsResult.error) {
    return NextResponse.json(
      { error: studentSnapshotsResult.error.message },
      { status: 400 },
    );
  }
  if (enrollmentSnapshotsResult.error) {
    return NextResponse.json(
      {
        error: isMissingOfficialTrackColumn(enrollmentSnapshotsResult.error)
          ? "La colonne class_enrollments.official_track_code est absente. Exécutez src/db/class_enrollments_student_series_v1.sql dans Supabase, puis réessayez."
          : enrollmentSnapshotsResult.error.message,
      },
      { status: 400 },
    );
  }

  const studentSnapshots = new Map(
    (studentSnapshotsResult.data || []).map((snapshot: any) => [
      String(snapshot.id),
      snapshot,
    ]),
  );
  const enrollmentSnapshots = new Map(
    (enrollmentSnapshotsResult.data || []).map((snapshot: any) => [
      String(snapshot.student_id),
      snapshot,
    ]),
  );

  const currentClass: StudentSeriesTargetClass = {
    id: String((cls as any).id),
    institution_id: institutionId,
    label: (cls as any).label ?? null,
    code: (cls as any).code ?? null,
    level: (cls as any).level ?? null,
    academic_year: (cls as any).academic_year ?? null,
    official_track_code: (cls as any).official_track_code ?? null,
  };

  let classCatalogQuery = srv
    .from("classes")
    .select(
      "id,institution_id,label,code,level,academic_year,official_track_code",
    )
    .eq("institution_id", institutionId);

  const currentAcademicYear = cleanText((cls as any).academic_year);
  if (currentAcademicYear) {
    classCatalogQuery = classCatalogQuery.eq(
      "academic_year",
      currentAcademicYear,
    );
  }

  const { data: classCatalogData, error: classCatalogError } =
    await classCatalogQuery;

  if (classCatalogError) {
    return NextResponse.json(
      { error: classCatalogError.message },
      { status: 400 },
    );
  }

  const classCatalog = (classCatalogData ?? []) as StudentSeriesTargetClass[];
  if (!classCatalog.some((row) => String(row.id) === classId)) {
    classCatalog.push(currentClass);
  }

  function resolveSeriesTargetClass(
    officialTrackCode: OfficialTrackCode | null,
  ): StudentSeriesTargetClass {
    if (!officialTrackCode) return currentClass;

    const candidates = classCatalog.filter(
      (row) => inferClassOfficialTrackCode(row) === officialTrackCode,
    );
    const currentCandidate = candidates.find(
      (row) => String(row.id) === classId,
    );

    if (currentCandidate) return currentCandidate;
    if (candidates.length === 1) return candidates[0];

    if (candidates.length > 1) {
      const labels = candidates
        .map((row) => cleanText(row.label || row.code || row.id))
        .filter(Boolean)
        .join(", ");
      throw new Error(
        `Plusieurs classes correspondent à la série ${officialTrackLabel(officialTrackCode)} (${labels}). Le transfert est bloqué pour éviter de choisir une classe au hasard.`,
      );
    }

    // Une classe commune peut regrouper plusieurs séries (notamment A1/A2).
    // Sans classe cible unique, seule la série officielle de l'inscription est modifiée.
    return currentClass;
  }

  const targetClassByStudentId = new Map<string, StudentSeriesTargetClass>();
  try {
    for (const row of rows) {
      targetClassByStudentId.set(
        row.student_id,
        resolveSeriesTargetClass(row.official_track_code),
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "La classe correspondant à la nouvelle série est ambiguë.",
      },
      { status: 409 },
    );
  }

  async function restoreSchoolProfile(studentId: string) {
    const studentSnapshot: any = studentSnapshots.get(studentId);
    const enrollmentSnapshot: any = enrollmentSnapshots.get(studentId);
    if (!studentSnapshot || !enrollmentSnapshot) return;

    const studentPatch = { ...studentSnapshot };
    delete studentPatch.id;
    await srv.from("students").update(studentPatch).eq("id", studentId);
    await srv
      .from("class_enrollments")
      .update({
        start_date: enrollmentSnapshot.start_date,
        end_date: enrollmentSnapshot.end_date,
        official_track_code: enrollmentSnapshot.official_track_code,
      })
      .eq("id", enrollmentSnapshot.id)
      .eq("institution_id", institutionId);
  }

  let updated = 0;
  const financeSync: FinanceSyncResult = {
    inserted: 0,
    reactivated: 0,
    cancelled: 0,
    cancelled_duplicates: 0,
    preserved_paid_amount: 0,
    updated_amount: 0,
    retargeted: 0,
    option_links_created: 0,
    warnings: [],
  };
  const financeWarnings: string[] = [];
  let classMoves = 0;

  function accumulateFinanceResult(result: FinanceSyncResult) {
    financeSync.inserted += result.inserted;
    financeSync.reactivated += result.reactivated;
    financeSync.cancelled += result.cancelled;
    financeSync.cancelled_duplicates += result.cancelled_duplicates;
    financeSync.preserved_paid_amount += result.preserved_paid_amount;
    financeSync.updated_amount += result.updated_amount;
    financeSync.retargeted += result.retargeted;
    financeSync.option_links_created += result.option_links_created;
    financeWarnings.push(...result.warnings);
  }

  for (const row of rows) {
    if (
      !studentSnapshots.has(row.student_id) ||
      !enrollmentSnapshots.has(row.student_id)
    ) {
      return NextResponse.json(
        {
          error:
            "Modification annulée : l'état initial de l'élève n'a pas pu être sécurisé.",
        },
        { status: 409 },
      );
    }

    const { data: updatedStudent, error } = await srv
      .from("students")
      .update({
        ...row.patch,
        matricule: row.matricule,
        // Répare aussi les anciens élèves importés sans institution_id ou avec
        // une institution incohérente. Le droit d'écriture est déjà sécurisé
        // par l'inscription active dans cette classe de l'établissement.
        institution_id: institutionId,
      } as any)
      .eq("id", row.student_id)
      .select("id")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          error: error.message.includes("lv2")
            ? "La colonne students.lv2 est absente. Exécute la migration 20260521_students_lv2.sql dans Supabase, puis réessaie."
            : error.message,
          details: error.message,
        },
        { status: 400 },
      );
    }

    if (!updatedStudent?.id) {
      return NextResponse.json(
        {
          error:
            "Correction non appliquée : l'élève existe dans la liste de classe, mais sa fiche élève n'a pas pu être mise à jour.",
          details: "student_update_affected_zero_rows",
        },
        { status: 409 },
      );
    }

    try {
      const studentProfile = {
        is_affecte:
          typeof row.patch.is_affecte === "boolean"
            ? row.patch.is_affecte
            : null,
        is_boarder:
          typeof row.patch.is_boarder === "boolean"
            ? row.patch.is_boarder
            : null,
      };
      const targetClass =
        targetClassByStudentId.get(row.student_id) ?? currentClass;

      if (String(targetClass.id) !== classId) {
        const appliedMove = await transferStudentToSeriesClass({
          srv,
          institutionId,
          userId: ctx.user.id,
          studentId: row.student_id,
          sourceClassId: classId,
          targetClass,
          officialTrackCode: row.official_track_code,
          studentProfile,
        });

        accumulateFinanceResult(appliedMove.finance.reconciliation);
        financeSync.cancelled_duplicates +=
          appliedMove.finance.transfer.cancelled_duplicates;
        financeSync.preserved_paid_amount +=
          appliedMove.finance.transfer.preserved_paid_amount;
        financeSync.retargeted += appliedMove.finance.transfer.moved_charges;
        financeWarnings.push(...appliedMove.finance.transfer.warnings);
        classMoves++;
      } else {
        const { data: updatedEnrollment, error: enrollmentErr } = await srv
          .from("class_enrollments")
          .update({ official_track_code: row.official_track_code })
          .eq("institution_id", institutionId)
          .eq("class_id", classId)
          .eq("student_id", row.student_id)
          .is("end_date", null)
          .select("id");

        if (enrollmentErr) throw enrollmentErr;
        if ((updatedEnrollment ?? []).length !== 1) {
          throw new Error(
            "La série n’a pas pu être enregistrée sur l’inscription active.",
          );
        }

        const applied = await applyStudentFinanceReconciliation({
          srv,
          institutionId,
          userId: ctx.user.id,
          studentId: row.student_id,
          classId,
          studentProfile,
        });
        accumulateFinanceResult(applied.summary);
      }
    } catch (error) {
      await restoreSchoolProfile(row.student_id);
      const message =
        error instanceof Error
          ? error.message
          : "Synchronisation finance impossible pour un élève.";
      return NextResponse.json(
        {
          error: isMissingOfficialTrackColumn(error)
            ? "La colonne class_enrollments.official_track_code est absente. Exécutez src/db/class_enrollments_student_series_v1.sql dans Supabase, puis réessayez."
            : message,
          details:
            "Modification annulée : le profil scolaire et financier précédent a été restauré.",
        },
        { status: 409 },
      );
    }

    updated++;
  }

  if (forceFinanceSync) {
    const alreadySynced = new Set(rows.map((row) => row.student_id));
    const idsToSync = requestedIds.filter(
      (studentId) => allowed.has(studentId) && !alreadySynced.has(studentId),
    );

    try {
      const profiles = await loadFinanceProfilesForStudents(
        srv,
        institutionId,
        classId,
        idsToSync,
      );

      for (const item of profiles) {
        const targetClass = resolveSeriesTargetClass(item.official_track_code);

        if (String(targetClass.id) !== classId) {
          const appliedMove = await transferStudentToSeriesClass({
            srv,
            institutionId,
            userId: ctx.user.id,
            studentId: item.student_id,
            sourceClassId: classId,
            targetClass,
            officialTrackCode: item.official_track_code,
            studentProfile: item.profile,
          });

          accumulateFinanceResult(appliedMove.finance.reconciliation);
          financeSync.cancelled_duplicates +=
            appliedMove.finance.transfer.cancelled_duplicates;
          financeSync.preserved_paid_amount +=
            appliedMove.finance.transfer.preserved_paid_amount;
          financeSync.retargeted += appliedMove.finance.transfer.moved_charges;
          financeWarnings.push(...appliedMove.finance.transfer.warnings);
          classMoves++;
        } else {
          const result = await reconcileFinanceChargesForStudent(
            srv,
            institutionId,
            ctx.user.id,
            item.student_id,
            classId,
            item.profile,
          );
          accumulateFinanceResult(result);
        }
      }
    } catch (error) {
      financeWarnings.push(
        error instanceof Error
          ? error.message
          : "Resynchronisation finance impossible.",
      );
    }
  }

  try {
    revalidatePath("/admin/classes");
    revalidatePath("/admin/finance");
    revalidatePath("/admin/finance/charges");
    revalidatePath("/admin/finance/payments");
    revalidatePath("/admin/finance/receipts");
    revalidatePath("/admin/finance/reports");
  } catch {
    // La correction est déjà enregistrée ; la revalidation ne doit pas bloquer la réponse API.
  }

  return NextResponse.json({
    ok: true,
    updated,
    class_moves: classMoves,
    finance_sync: financeSync,
    finance_warnings: Array.from(new Set(financeWarnings)).slice(0, 5),
  });
}
