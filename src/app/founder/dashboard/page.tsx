// src/app/founder/dashboard/page.tsx
import { redirect } from "next/navigation";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CalendarCheck2,
  GraduationCap,
  Receipt,
  School2,
  UsersRound,
  Wallet,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type InstitutionRow = {
  id: string;
  name: string | null;
};

type QueryResult<T> = {
  data: T | null;
  error: { message?: string } | null;
};

type StudentStats = {
  total: number;
  assigned: number;
  notAssigned: number;
  assignmentUnknown: number;
  boarders: number;
  notBoarders: number;
  boardingUnknown: number;
  boys: number;
  girls: number;
  genderUnknown: number;
};

const CIV_TIME_ZONE = "Africa/Abidjan";

function todayYmd() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CIV_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function computeAcademicYear(d = new Date()) {
  const month = d.getUTCMonth() + 1;
  const year = d.getUTCFullYear();
  return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function dayBoundsIso(ymd: string) {
  // La Côte d’Ivoire est en UTC toute l’année. On garde donc des bornes ISO strictes
  // pour les colonnes timestamp comme finance.receipts.payment_date.
  const start = new Date(`${ymd}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

function money(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function chunks<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function normalizeGender(value: unknown): "boy" | "girl" | null {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (!raw) return null;
  if (["m", "masculin", "male", "garcon", "garcons", "homme", "boy"].includes(raw)) return "boy";
  if (["f", "feminin", "female", "fille", "filles", "femme", "girl"].includes(raw)) return "girl";
  return null;
}

function emptyStudentStats(): StudentStats {
  return {
    total: 0,
    assigned: 0,
    notAssigned: 0,
    assignmentUnknown: 0,
    boarders: 0,
    notBoarders: 0,
    boardingUnknown: 0,
    boys: 0,
    girls: 0,
    genderUnknown: 0,
  };
}

function buildStudentStats(enrollments: any[]): StudentStats {
  const stats = emptyStudentStats();
  const seen = new Set<string>();

  for (const enrollment of enrollments) {
    const studentId = String(enrollment?.student_id || enrollment?.students?.id || "").trim();
    if (!studentId || seen.has(studentId)) continue;
    seen.add(studentId);

    const student = enrollment?.students ?? {};
    stats.total += 1;

    if (student.is_affecte === true) stats.assigned += 1;
    else if (student.is_affecte === false) stats.notAssigned += 1;
    else stats.assignmentUnknown += 1;

    if (student.is_boarder === true) stats.boarders += 1;
    else if (student.is_boarder === false) stats.notBoarders += 1;
    else stats.boardingUnknown += 1;

    const gender = normalizeGender(student.gender);
    if (gender === "boy") stats.boys += 1;
    else if (gender === "girl") stats.girls += 1;
    else stats.genderUnknown += 1;
  }

  return stats;
}

async function safeData<T>(label: string, query: PromiseLike<QueryResult<T>>, fallback: T): Promise<T> {
  try {
    const res = await query;
    if (res?.error) {
      console.warn(`[founder/dashboard] ${label}:`, res.error.message || res.error);
      return fallback;
    }
    return (res?.data ?? fallback) as T;
  } catch (e: any) {
    console.warn(`[founder/dashboard] ${label}:`, e?.message || e);
    return fallback;
  }
}

async function getFounderContext() {
  const supabase = await getSupabaseServerClient();
  const service = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const roles = await safeData<any[]>(
    "user_roles",
    service
      .from("user_roles")
      .select("institution_id,role")
      .eq("profile_id", user.id)
      .eq("role", "founder"),
    [],
  );

  const institutionIds: string[] = Array.from(
    new Set((roles ?? []).map((row: any) => String(row.institution_id || "")).filter(Boolean)),
  );

  if (!institutionIds.length) redirect("/profile");

  const institutions = await safeData<InstitutionRow[]>(
    "institutions",
    service
      .from("institutions")
      .select("id,name")
      .in("id", institutionIds)
      .order("name", { ascending: true }),
    [],
  );

  return { service, institutionIds, institutions };
}

export default async function FounderDashboardPage() {
  const { service, institutionIds, institutions } = await getFounderContext();
  const today = todayYmd();
  const { startIso, endIso } = dayBoundsIso(today);
  const fallbackAcademicYear = computeAcademicYear();

  const academicYearRows = await safeData<any[]>(
    "academic_years",
    service
      .from("academic_years")
      .select("institution_id,code,label,start_date")
      .in("institution_id", institutionIds)
      .eq("is_current", true)
      .order("start_date", { ascending: false }),
    [],
  );

  const currentYearByInstitution = new Map<string, string>();
  for (const row of academicYearRows ?? []) {
    const institutionId = String(row.institution_id || "").trim();
    const code = String(row.code || "").trim();
    if (institutionId && code && !currentYearByInstitution.has(institutionId)) {
      currentYearByInstitution.set(institutionId, code);
    }
  }
  for (const institutionId of institutionIds) {
    if (!currentYearByInstitution.has(institutionId)) currentYearByInstitution.set(institutionId, fallbackAcademicYear);
  }

  const rawClasses = await safeData<any[]>(
    "classes",
    service
      .from("classes")
      .select("id,institution_id,academic_year")
      .in("institution_id", institutionIds)
      .limit(10000),
    [],
  );

  const classRows = (rawClasses ?? []).filter((row: any) => {
    const institutionId = String(row.institution_id || "");
    return String(row.academic_year || "") === currentYearByInstitution.get(institutionId);
  });
  const classIds = Array.from(new Set(classRows.map((row: any) => String(row.id || "")).filter(Boolean)));

  const enrollments: any[] = [];
  if (classIds.length > 0) {
    for (const part of chunks(classIds)) {
      const rows = await safeData<any[]>(
        "class_enrollments.current_year",
        service
          .from("class_enrollments")
          .select(
            "id,institution_id,class_id,student_id,students:student_id(id,gender,is_affecte,is_boarder)",
          )
          .in("institution_id", institutionIds)
          .in("class_id", part)
          .is("end_date", null)
          .limit(10000),
        [],
      );
      enrollments.push(...rows);
    }
  }

  const [sessions, periods, receipts, expenses] = await Promise.all([
    safeData<any[]>(
      "teacher_sessions",
      service
        .from("teacher_sessions")
        .select("id,institution_id,started_at,ended_at", { count: "exact", head: false })
        .in("institution_id", institutionIds)
        .gte("started_at", startIso)
        .lte("started_at", endIso),
      [],
    ),
    safeData<any[]>(
      "institution_periods",
      service
        .from("institution_periods")
        .select("id,institution_id,is_active")
        .in("institution_id", institutionIds)
        .eq("is_active", true),
      [],
    ),
    safeData<any[]>(
      "finance.receipts",
      service
        .schema("finance")
        .from("receipts")
        .select("id,school_id,total_amount,receipt_status,payment_date")
        .in("school_id", institutionIds)
        .eq("receipt_status", "posted")
        .gte("payment_date", startIso)
        .lt("payment_date", endIso),
      [],
    ),
    safeData<any[]>(
      "finance.expenses",
      service
        .schema("finance")
        .from("expenses")
        .select("id,school_id,amount,expense_status,expense_date")
        .in("school_id", institutionIds)
        .eq("expense_status", "posted")
        .eq("expense_date", today),
      [],
    ),
  ]);

  const totalReceipts = receipts.reduce((sum: number, row: any) => sum + Number(row.total_amount || 0), 0);
  const totalExpenses = expenses.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
  const net = totalReceipts - totalExpenses;
  const totalStudentStats = buildStudentStats(enrollments);

  const rows = institutions.map((school) => {
    const schoolId = school.id;
    const schoolReceipts = receipts.filter((row: any) => row.school_id === schoolId);
    const schoolExpenses = expenses.filter((row: any) => row.school_id === schoolId);
    const schoolSessions = sessions.filter((row: any) => row.institution_id === schoolId);
    const schoolEnrollments = enrollments.filter((row: any) => row.institution_id === schoolId);
    const schoolPeriods = periods.filter((row: any) => row.institution_id === schoolId);
    const receiptTotal = schoolReceipts.reduce((sum: number, row: any) => sum + Number(row.total_amount || 0), 0);
    const expenseTotal = schoolExpenses.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);
    const studentStats = buildStudentStats(schoolEnrollments);

    return {
      school,
      receiptTotal,
      expenseTotal,
      net: receiptTotal - expenseTotal,
      receiptsCount: schoolReceipts.length,
      expensesCount: schoolExpenses.length,
      sessionsCount: schoolSessions.length,
      enrollmentsCount: studentStats.total,
      periodsCount: schoolPeriods.length,
      studentStats,
    };
  });

  const statCards = [
    { label: "Écoles suivies", value: institutions.length, hint: "Établissements rattachés", Icon: School2 },
    { label: "Élèves", value: totalStudentStats.total, hint: "Inscrits actifs année courante", Icon: GraduationCap },
    { label: "Encaissements", value: money(totalReceipts), hint: `${receipts.length} reçu(s) aujourd’hui`, Icon: Receipt },
    { label: "Dépenses", value: money(totalExpenses), hint: `${expenses.length} dépense(s) aujourd’hui`, Icon: Wallet },
    { label: "Solde du jour", value: money(net), hint: "Encaissements moins dépenses", Icon: Activity },
    { label: "Appels détectés", value: sessions.length, hint: "Séances ouvertes aujourd’hui", Icon: CalendarCheck2 },
  ];

  const profileCards = [
    { label: "Affectés", value: totalStudentStats.assigned, hint: "Scolarité affectée", Icon: UsersRound },
    { label: "Non affectés", value: totalStudentStats.notAssigned, hint: "Scolarité non affectée", Icon: UsersRound },
    { label: "Internes", value: totalStudentStats.boarders, hint: "Internat oui", Icon: School2 },
    { label: "Non internes", value: totalStudentStats.notBoarders, hint: "Internat non", Icon: School2 },
    { label: "Garçons", value: totalStudentStats.boys, hint: "Sexe masculin", Icon: GraduationCap },
    { label: "Filles", value: totalStudentStats.girls, hint: "Sexe féminin", Icon: GraduationCap },
  ];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-5 text-white shadow-xl sm:p-7">
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-200">
            Pilotage fondateur
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl">
            Vue globale de vos écoles
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-200 sm:text-base">
            Synthèse consolidée de la finance, des créneaux, de l’activité du jour et du profil des élèves pour les établissements rattachés.
          </p>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {statCards.map(({ label, value, hint, Icon }) => (
          <div key={label} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
                <div className="mt-2 truncate text-2xl font-black text-slate-950">{value}</div>
                <div className="mt-1 text-xs font-medium leading-5 text-slate-500">{hint}</div>
              </div>
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-slate-100 text-slate-700">
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
              <GraduationCap className="h-4 w-4" />
              Profil des élèves
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Lecture consolidée : affectation, internat et répartition filles/garçons.
            </p>
          </div>
          <div className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">
            Année courante
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {profileCards.map(({ label, value, hint, Icon }) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
                  <div className="mt-1 text-2xl font-black text-slate-950">{value}</div>
                  <div className="mt-1 text-xs text-slate-500">{hint}</div>
                </div>
                <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white text-slate-700 ring-1 ring-slate-200">
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {(totalStudentStats.assignmentUnknown > 0 || totalStudentStats.boardingUnknown > 0 || totalStudentStats.genderUnknown > 0) && (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
            À compléter : {totalStudentStats.assignmentUnknown} affectation(s), {totalStudentStats.boardingUnknown} internat(s), {totalStudentStats.genderUnknown} sexe(s) non renseigné(s).
          </div>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-slate-500">
                <Building2 className="h-4 w-4" />
                Écoles rattachées
              </div>
              <p className="mt-1 text-sm text-slate-500">Lecture consolidée par établissement pour aujourd’hui.</p>
            </div>
            <div className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700">
              {today}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {rows.length === 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                Aucune école trouvée pour ce compte fondateur.
              </div>
            ) : (
              rows.map(({ school, receiptTotal, expenseTotal, net, sessionsCount, periodsCount, studentStats }) => (
                <div key={school.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="font-black text-slate-950">{school.name || "Établissement"}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{school.id}</div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-2xl bg-white p-3">
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-emerald-700">
                        <ArrowUpRight className="h-4 w-4" /> Encaissé
                      </div>
                      <div className="mt-1 text-lg font-black text-slate-950">{money(receiptTotal)}</div>
                    </div>
                    <div className="rounded-2xl bg-white p-3">
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-amber-700">
                        <ArrowDownRight className="h-4 w-4" /> Dépensé
                      </div>
                      <div className="mt-1 text-lg font-black text-slate-950">{money(expenseTotal)}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                    <span className="rounded-full bg-white px-3 py-1">Solde : {money(net)}</span>
                    <span className="rounded-full bg-white px-3 py-1">Élèves : {studentStats.total}</span>
                    <span className="rounded-full bg-white px-3 py-1">Affectés : {studentStats.assigned}</span>
                    <span className="rounded-full bg-white px-3 py-1">Non affectés : {studentStats.notAssigned}</span>
                    <span className="rounded-full bg-white px-3 py-1">Internes : {studentStats.boarders}</span>
                    <span className="rounded-full bg-white px-3 py-1">Non internes : {studentStats.notBoarders}</span>
                    <span className="rounded-full bg-white px-3 py-1">G : {studentStats.boys}</span>
                    <span className="rounded-full bg-white px-3 py-1">F : {studentStats.girls}</span>
                    <span className="rounded-full bg-white px-3 py-1">Appels : {sessionsCount}</span>
                    <span className="rounded-full bg-white px-3 py-1">Créneaux : {periodsCount}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-black uppercase tracking-[0.18em] text-slate-500">
            Lecture rapide
          </div>
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.15em] text-emerald-700">Finance nette</div>
              <div className="mt-2 text-2xl font-black text-emerald-900">{money(net)}</div>
              <p className="mt-1 text-xs leading-5 text-emerald-800">Solde journalier consolidé sur toutes les écoles.</p>
            </div>
            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.15em] text-sky-700">Élèves actifs</div>
              <div className="mt-2 text-2xl font-black text-sky-900">{totalStudentStats.total}</div>
              <p className="mt-1 text-xs leading-5 text-sky-800">Total des élèves inscrits dans les classes de l’année courante.</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">Notifications</div>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                Les notifications du fondateur restent concentrées sur les événements financiers importants et les bilans.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
