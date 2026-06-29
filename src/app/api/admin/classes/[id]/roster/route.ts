// src/app/api/admin/classes/[id]/roster/route.ts
import { revalidatePath } from "next/cache";
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

type FinanceScheduleRow = {
  id: string;
  school_id: string;
  academic_year: string | null;
  class_id: string | null;
  fee_category_id: string;
  label: string | null;
  amount: number | string | null;
  due_date: string | null;
  is_active?: boolean | null;
  notes?: string | null;
};

type FinanceFeeCategoryRow = {
  id: string;
  code: string | null;
  name: string | null;
};

type FinanceStudentProfile = {
  is_affecte: boolean | null;
  is_boarder: boolean | null;
};

type FinanceSyncResult = {
  inserted: number;
  reactivated: number;
  cancelled: number;
  settledPaid: number;
  skippedPaid: number;
  updatedAmount: number;
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
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeFinanceLabel(value: unknown) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function financeCategoryKind(category: FinanceFeeCategoryRow | null | undefined) {
  const text = normalizeFinanceLabel(`${category?.code || ""} ${category?.name || ""}`);

  if (text.includes("internat") || text.includes("pension")) return "internat";
  if (
    text.includes("scolarite") ||
    text.includes("ecolage") ||
    text.includes("inscription")
  ) {
    return "scolarite";
  }
  if (text.includes("renforcement")) return "cours_renforcement";

  return null;
}

function financeScheduleAppliesToStudent(
  schedule: Pick<FinanceScheduleRow, "label" | "fee_category_id">,
  student: FinanceStudentProfile,
  categoriesById: Map<string, FinanceFeeCategoryRow> = new Map(),
) {
  const label = normalizeFinanceLabel(schedule.label);
  const categoryKind = financeCategoryKind(
    categoriesById.get(String(schedule.fee_category_id || "")),
  );

  // Plus robuste que le seul libellé : si le barème est rangé dans la
  // catégorie Internat, il doit suivre le statut interne/externe même si son
  // libellé exact est "Pension", "Frais annexes", "Internat 6e", etc.
  if (
    categoryKind === "internat" ||
    label.includes("internat") ||
    label.includes("pension") ||
    label.includes("trousseau")
  ) {
    return student.is_boarder === true;
  }

  const isNonAffecteFee = label.includes("non affecte") || label.includes("non-affecte");
  const isEcolageFee = label.includes("ecolage");
  const isAffecteFee = label.includes("affecte");

  if (
    categoryKind === "scolarite" ||
    label.includes("scolarite") ||
    label.includes("inscription") ||
    label.includes("frais generaux") ||
    label.includes("frais annexes scolarite") ||
    isEcolageFee
  ) {
    // L'ordre est volontaire : "non affecté" contient aussi "affecté".
    if (isNonAffecteFee) return student.is_affecte === false;
    if (isEcolageFee && isAffecteFee) return student.is_affecte === true;
    return true;
  }

  // Les autres barèmes personnalisés restent appliqués normalement.
  return true;
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

function amountsDiffer(a: number, b: number) {
  return Math.abs(Number(a || 0) - Number(b || 0)) > 0.01;
}

function financeStatusForAmount(expectedAmount: number, paidAmount: number) {
  if (paidAmount >= expectedAmount - 0.01) return "paid";
  if (paidAmount > 0) return "partial";
  return "pending";
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
    ? new Set(["admin", "super_admin", "founder", "finance_manager", "finance"])
    : new Set(["admin", "super_admin", "founder", "finance_manager", "finance"]);

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
  const writeRoles = new Set(["admin", "super_admin", "founder", "finance_manager", "finance"]);
  const canWrite = (roleRows || []).some((row: any) => {
    const role = String(row.role || "");
    return writeRoles.has(role) && roleAppliesToInstitution(row);
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

  return { supa, srv, user, me, institutionId, cls, canWrite };
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const classId = String(id || "").trim();

  if (!classId) return NextResponse.json({ error: "missing_class_id" }, { status: 400 });

  const ctx = await requireAdminContext(classId);
  if ("error" in ctx) return ctx.error;

  const { srv, institutionId, cls, canWrite } = ctx;

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
    can_edit: canWrite,
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

async function loadFinanceProfilesForStudents(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  classId: string,
  studentIds: string[],
): Promise<Array<{ student_id: string; profile: FinanceStudentProfile }>> {
  const ids = Array.from(new Set(studentIds.map((id) => cleanText(id)).filter(Boolean)));
  if (ids.length === 0) return [];

  const { data, error } = await srv
    .from("class_enrollments")
    .select(
      `
      student_id,
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
        profile: {
          is_affecte:
            typeof student.is_affecte === "boolean" ? student.is_affecte : null,
          is_boarder:
            typeof student.is_boarder === "boolean" ? student.is_boarder : null,
        },
      };
    })
    .filter(Boolean) as Array<{ student_id: string; profile: FinanceStudentProfile }>;
}

async function reconcileFinanceChargesForStudent(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  userId: string,
  studentId: string,
  classId: string,
  studentProfile: FinanceStudentProfile,
): Promise<FinanceSyncResult> {
  const empty: FinanceSyncResult = {
    inserted: 0,
    reactivated: 0,
    cancelled: 0,
    settledPaid: 0,
    skippedPaid: 0,
    updatedAmount: 0,
  };

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

  const scheduleRows = (Array.isArray(schedules) ? schedules : []) as FinanceScheduleRow[];
  if (scheduleRows.length === 0) return empty;

  const scheduleIds = scheduleRows.map((row) => String(row.id)).filter(Boolean);
  const feeCategoryIds = Array.from(
    new Set(scheduleRows.map((row) => String(row.fee_category_id || "").trim()).filter(Boolean)),
  );

  let categoriesById = new Map<string, FinanceFeeCategoryRow>();
  if (feeCategoryIds.length > 0) {
    const { data: categories, error: categoryErr } = await srv
      .schema("finance")
      .from("fee_categories")
      .select("id,code,name")
      .eq("school_id", institutionId)
      .in("id", feeCategoryIds);

    if (categoryErr) throw new Error(categoryErr.message);

    categoriesById = new Map(
      ((categories || []) as FinanceFeeCategoryRow[]).map((category) => [
        String(category.id),
        category,
      ]),
    );
  }

  const academicYear = String((classRow as any).academic_year || "").trim() || null;
  const academicYearId = await getAcademicYearIdForFinance(
    srv,
    institutionId,
    academicYear,
  );
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  const { data: existingChargeRows, error: existingDirectErr } = await srv
    .schema("finance")
    .from("student_charges")
    .select("id,fee_schedule_id,status,base_amount,due_date,updated_at")
    .eq("school_id", institutionId)
    .eq("student_id", studentId)
    .eq("class_id", classId)
    .in("fee_schedule_id", scheduleIds)
    .order("updated_at", { ascending: false });

  if (existingDirectErr) throw new Error(existingDirectErr.message);

  const existingChargeIds = (existingChargeRows || [])
    .map((charge: any) => cleanText(charge.id))
    .filter(Boolean);

  const { data: balanceRows, error: existingErr } = existingChargeIds.length
    ? await srv
        .schema("finance")
        .from("v_charge_balances")
        .select("id,fee_schedule_id,paid_amount,balance_due,computed_status")
        .eq("school_id", institutionId)
        .eq("student_id", studentId)
        .eq("class_id", classId)
        .in("id", existingChargeIds)
    : { data: [], error: null as any };

  if (existingErr) throw new Error(existingErr.message);

  const balancesById = new Map<string, any>(
    (balanceRows || []).map((charge: any) => [String(charge.id), charge]),
  );

  const existingBySchedule = new Map<
    string,
    {
      id: string;
      paid_amount: number;
      balance_due: number;
      computed_status: string | null;
      base_amount: number;
      due_date: string | null;
    }
  >();

  for (const charge of existingChargeRows || []) {
    const scheduleId = String((charge as any).fee_schedule_id || "").trim();
    const chargeId = String((charge as any).id || "").trim();
    if (!scheduleId || !chargeId) continue;

    const balance = balancesById.get(chargeId) || {};
    const candidate = {
      id: chargeId,
      paid_amount: Number(balance.paid_amount || 0),
      balance_due: Number(balance.balance_due || 0),
      computed_status: balance.computed_status
        ? String(balance.computed_status)
        : (charge as any).status
          ? String((charge as any).status)
          : null,
      base_amount: Number((charge as any).base_amount || 0),
      due_date: (charge as any).due_date ? String((charge as any).due_date) : null,
    };

    const existing = existingBySchedule.get(scheduleId);
    if (!existing || (existing.computed_status === "cancelled" && candidate.computed_status !== "cancelled")) {
      existingBySchedule.set(scheduleId, candidate);
    }
  }

  const applicableSchedules = scheduleRows.filter((schedule) =>
    financeScheduleAppliesToStudent(schedule, studentProfile, categoriesById),
  );
  const applicableScheduleIds = new Set(applicableSchedules.map((schedule) => String(schedule.id)));

  const rowsToInsert = applicableSchedules
    .filter((schedule) => !existingBySchedule.has(String(schedule.id)))
    .map((schedule) => ({
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
        "Situation créée automatiquement après correction de la liste de classe.",
      created_by: userId,
      created_at: nowIso,
      updated_at: nowIso,
    }));

  let inserted = 0;
  if (rowsToInsert.length > 0) {
    const { error: insertErr } = await srv
      .schema("finance")
      .from("student_charges")
      .insert(rowsToInsert as any[]);

    if (insertErr) throw new Error(insertErr.message);
    inserted = rowsToInsert.length;
  }

  const rowsToRefreshApplicable = applicableSchedules
    .map((schedule) => {
      const existing = existingBySchedule.get(String(schedule.id));
      if (!existing) return null;

      const expectedAmount = Number(schedule.amount || 0);
      const expectedDueDate = schedule.due_date || null;
      const wasCancelled = existing.computed_status === "cancelled";
      const amountChanged = amountsDiffer(existing.base_amount, expectedAmount);
      const dueDateChanged = existing.due_date !== expectedDueDate;

      // Cas important : Interne -> Externe avec paiement partiel peut avoir
      // neutralisé la dette en base_amount = payé et status = paid. Si l'élève
      // repasse Interne, on doit restaurer le montant complet du barème.
      if (!wasCancelled && !amountChanged && !dueDateChanged) return null;

      return {
        chargeId: existing.id,
        schedule,
        wasCancelled,
        amountChanged,
        nextStatus: financeStatusForAmount(expectedAmount, existing.paid_amount),
      };
    })
    .filter(Boolean) as Array<{
      chargeId: string;
      schedule: FinanceScheduleRow;
      wasCancelled: boolean;
      amountChanged: boolean;
      nextStatus: string;
    }>;

  let reactivated = 0;
  let updatedAmount = 0;
  for (const row of rowsToRefreshApplicable) {
    const { error: refreshErr } = await srv
      .schema("finance")
      .from("student_charges")
      .update({
        base_amount: Number(row.schedule.amount || 0),
        due_date: row.schedule.due_date || null,
        status: row.nextStatus,
        notes: row.wasCancelled
          ? "Profil financier modifié depuis la liste de classe : dette réactivée selon le barème actif."
          : "Profil financier modifié depuis la liste de classe : montant restauré selon le barème actif.",
        updated_at: nowIso,
      } as any)
      .eq("id", row.chargeId)
      .eq("school_id", institutionId);

    if (refreshErr) throw new Error(refreshErr.message);
    if (row.wasCancelled) reactivated++;
    else if (row.amountChanged) updatedAmount++;
  }

  const obsoleteChargeIds: string[] = [];
  const obsoletePaidChargeIds: string[] = [];
  let skippedPaid = 0;

  for (const [scheduleId, charge] of existingBySchedule.entries()) {
    if (applicableScheduleIds.has(scheduleId)) continue;
    if (charge.computed_status === "cancelled") continue;

    if (charge.paid_amount > 0) {
      // Cas métier important : si un élève passe Interne -> Externe,
      // on ne doit pas supprimer l'historique des reçus déjà encaissés.
      // En revanche, le reste dû ne doit plus apparaître dans Encaissements.
      // On ramène donc la dette au montant déjà payé : solde dû = 0,
      // historique conservé, aucune nouvelle somme réclamée à tort.
      if (charge.balance_due > 0) {
        obsoletePaidChargeIds.push(charge.id);
      }
      skippedPaid++;
      continue;
    }

    obsoleteChargeIds.push(charge.id);
  }

  let cancelled = 0;
  if (obsoleteChargeIds.length > 0) {
    const { error: cancelErr } = await srv
      .schema("finance")
      .from("student_charges")
      .update({
        status: "cancelled",
        updated_at: nowIso,
      } as any)
      .eq("school_id", institutionId)
      .in("id", obsoleteChargeIds);

    if (cancelErr) throw new Error(cancelErr.message);
    cancelled = obsoleteChargeIds.length;
  }

  let settledPaid = 0;
  if (obsoletePaidChargeIds.length > 0) {
    for (const chargeId of obsoletePaidChargeIds) {
      const charge = Array.from(existingBySchedule.values()).find((item) => item.id === chargeId);
      if (!charge) continue;

      const { error: settleErr } = await srv
        .schema("finance")
        .from("student_charges")
        .update({
          base_amount: charge.paid_amount,
          status: "paid",
          notes: "Profil financier modifié depuis la liste de classe : solde restant neutralisé, encaissement déjà reçu conservé.",
          updated_at: nowIso,
        } as any)
        .eq("school_id", institutionId)
        .eq("id", chargeId);

      if (settleErr) throw new Error(settleErr.message);
      settledPaid++;
    }
  }

  return { inserted, reactivated, cancelled, settledPaid, skippedPaid, updatedAmount };
}

async function ensureFinanceChargesForStudent(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  userId: string,
  studentId: string,
  classId: string,
) {
  const result = await reconcileFinanceChargesForStudent(
    srv,
    institutionId,
    userId,
    studentId,
    classId,
    { is_affecte: null, is_boarder: null },
  );
  return result.inserted + result.reactivated;
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
  const forceFinanceSync = body?.force_finance_sync === true;
  const syncOnlyIds = Array.isArray(body?.student_ids)
    ? Array.from(
        new Set(body.student_ids.map((id: any) => cleanText(id)).filter(Boolean)),
      )
    : [];

  if (!updates.length && !forceFinanceSync) return NextResponse.json({ ok: true, updated: 0 });
  if (updates.length > 200 || syncOnlyIds.length > 200) {
    return NextResponse.json({ error: "too_many_updates" }, { status: 400 });
  }

  const updateIds = updates.map((row: any) => cleanText(row?.student_id)).filter(Boolean);
  const requestedIds = Array.from(new Set([...updateIds, ...syncOnlyIds]));

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

  if (!rows.length && !forceFinanceSync) return NextResponse.json({ ok: true, updated: 0 });

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
  const financeSync: FinanceSyncResult = {
    inserted: 0,
    reactivated: 0,
    cancelled: 0,
    settledPaid: 0,
    skippedPaid: 0,
    updatedAmount: 0,
  };
  const financeWarnings: string[] = [];

  for (const row of rows) {
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
          error:
            error.message.includes("lv2")
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

    try {
      const result = await reconcileFinanceChargesForStudent(
        srv,
        institutionId,
        ctx.user.id,
        row.student_id,
        classId,
        {
          is_affecte:
            typeof row.patch.is_affecte === "boolean" ? row.patch.is_affecte : null,
          is_boarder:
            typeof row.patch.is_boarder === "boolean" ? row.patch.is_boarder : null,
        },
      );
      financeSync.inserted += result.inserted;
      financeSync.reactivated += result.reactivated;
      financeSync.cancelled += result.cancelled;
      financeSync.settledPaid += result.settledPaid;
      financeSync.skippedPaid += result.skippedPaid;
      financeSync.updatedAmount += result.updatedAmount;
    } catch (error) {
      financeWarnings.push(
        error instanceof Error
          ? error.message
          : "Synchronisation finance impossible pour un élève.",
      );
    }

    updated++;
  }

  if (forceFinanceSync) {
    const alreadySynced = new Set(rows.map((row) => row.student_id));
    const idsToSync = requestedIds.filter((studentId) => allowed.has(studentId) && !alreadySynced.has(studentId));

    try {
      const profiles = await loadFinanceProfilesForStudents(
        srv,
        institutionId,
        classId,
        idsToSync,
      );

      for (const item of profiles) {
        const result = await reconcileFinanceChargesForStudent(
          srv,
          institutionId,
          ctx.user.id,
          item.student_id,
          classId,
          item.profile,
        );
        financeSync.inserted += result.inserted;
        financeSync.reactivated += result.reactivated;
        financeSync.cancelled += result.cancelled;
        financeSync.settledPaid += result.settledPaid;
        financeSync.skippedPaid += result.skippedPaid;
        financeSync.updatedAmount += result.updatedAmount;
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
    revalidatePath("/admin/finance/reports");
  } catch {
    // La correction est déjà enregistrée ; la revalidation ne doit pas bloquer la réponse API.
  }

  return NextResponse.json({
    ok: true,
    updated,
    finance_sync: financeSync,
    finance_warnings: Array.from(new Set(financeWarnings)).slice(0, 5),
  });
}
