import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  CalendarClock,
  Layers3,
  Receipt,
  UserRound,
  Wallet,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";
import { fetchFinanceChargeBalancesByClasses } from "@/lib/finance/charge-balances";
import { financeScheduleAppliesToStudent } from "@/lib/finance/charge-rules";
import {
  AcademicYearSelector,
  getFinanceAcademicYearContext,
} from "../_shared/academic-year";
import {
  getAdminStudentsServer,
  type AdminStudentRow,
} from "@/lib/admin-students-server";

export const dynamic = "force-dynamic";

type ClassRow = {
  id: string;
  label: string;
  level: string | null;
  academic_year: string | null;
};

type FeeScheduleRow = {
  id: string;
  school_id: string;
  academic_year: string | null;
  class_id: string | null;
  fee_category_id: string;
  label: string;
  amount: number | string;
  due_date: string | null;
  allow_partial: boolean;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type FeeCategoryRow = {
  id: string;
  code: string | null;
  name: string | null;
  is_mandatory?: boolean | null;
};


type ChargeBalanceRow = {
  id: string;
  school_id: string;
  academic_year_id: string | null;
  student_id: string;
  class_id: string | null;
  fee_schedule_id: string | null;
  fee_category_id: string;
  label: string;
  base_amount: number | string;
  adjustment_total: number | string;
  net_amount: number | string;
  paid_amount: number | string;
  balance_due: number | string;
  due_date: string | null;
  charge_date: string;
  computed_status: "pending" | "partial" | "paid" | "overdue" | "cancelled";
  created_at: string;
  updated_at: string;
};

type ChargeStudentRow = {
  id: string;
  full_name: string;
  class_id: string | null;
  is_affecte: boolean | null;
  is_boarder: boolean | null;
};

function formatMoney(value: number | string) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

async function getCurrentContextOrThrow() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Utilisateur non authentifié.");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);

  if (!profile?.institution_id) {
    throw new Error("Aucun établissement associé à cet utilisateur.");
  }

  return {
    userId: user.id,
    institutionId: profile.institution_id as string,
  };
}

async function generateChargesForClassAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const { institutionId, userId } = await getCurrentContextOrThrow();
  const admin = getSupabaseServiceClient();

  const classId = String(formData.get("class_id") || "").trim();

  if (!classId) {
    throw new Error("Veuillez choisir une classe.");
  }

  const { data: classRow, error: classErr } = await admin
    .from("classes")
    .select("id,label,level,academic_year,institution_id")
    .eq("id", classId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (classErr) throw new Error(classErr.message);
  if (!classRow) throw new Error("Classe introuvable.");

  const { data: schedules, error: schErr } = await admin
    .schema("finance")
    .from("fee_schedules")
    .select(
      "id,school_id,academic_year,class_id,fee_category_id,label,amount,due_date,allow_partial,is_active,notes,created_at,updated_at",
    )
    .eq("school_id", institutionId)
    .eq("is_active", true)
    .range(0, 9999);

  if (schErr) throw new Error(schErr.message);

  const classAcademicYear = String((classRow as any).academic_year || "").trim();
  const scheduleRows = ((schedules ?? []) as FeeScheduleRow[]).filter((schedule) => {
    const scheduleClassId = String(schedule.class_id || "").trim();
    const scheduleAcademicYear = String(schedule.academic_year || "").trim();
    const classMatches = !scheduleClassId || scheduleClassId === classId;
    const yearMatches = !classAcademicYear || !scheduleAcademicYear || scheduleAcademicYear === classAcademicYear;
    return classMatches && yearMatches;
  });
  const scheduleCategoryIds = Array.from(
    new Set(scheduleRows.map((schedule) => String(schedule.fee_category_id || "").trim()).filter(Boolean)),
  );

  let scheduleCategoriesById = new Map<string, FeeCategoryRow>();
  if (scheduleCategoryIds.length > 0) {
    const { data: categoryRows, error: categoryErr } = await admin
      .schema("finance")
      .from("fee_categories")
      .select("id,code,name,is_mandatory")
      .eq("school_id", institutionId)
      .in("id", scheduleCategoryIds);

    if (categoryErr) throw new Error(categoryErr.message);
    scheduleCategoriesById = new Map(
      ((categoryRows ?? []) as FeeCategoryRow[]).map((category) => [String(category.id), category]),
    );
  }

  if (scheduleRows.length === 0) {
    throw new Error(
      "Aucun barème actif trouvé pour cette classe. Crée d’abord les barèmes.",
    );
  }

  const { data: enrollmentRows, error: enrErr } = await admin
    .from("class_enrollments")
    .select(
      `
      class_id,
      student_id,
      students:student_id ( id, full_name, is_affecte, is_boarder )
    `,
    )
    .eq("institution_id", institutionId)
    .eq("class_id", classId)
    .is("end_date", null);

  if (enrErr) throw new Error(enrErr.message);

  const studentRows = ((enrollmentRows ?? []) as any[]).map((row) => {
    const student = row.students ?? {};
    return {
      id: String(student.id || row.student_id),
      full_name: String(student.full_name || ""),
      class_id: String(row.class_id || classId),
      is_affecte:
        typeof student.is_affecte === "boolean" ? student.is_affecte : null,
      is_boarder:
        typeof student.is_boarder === "boolean" ? student.is_boarder : null,
    } satisfies ChargeStudentRow;
  });

  if (studentRows.length === 0) {
    throw new Error("Aucun élève trouvé dans cette classe.");
  }

  const incompleteProfiles = studentRows.filter(
    (student) => student.is_affecte === null || student.is_boarder === null,
  );

  if (incompleteProfiles.length > 0) {
    throw new Error(
      `${incompleteProfiles.length} élève(s) ont un profil financier incomplet : affectation ou internat non renseigné.`,
    );
  }

  const { data: academicYearRow, error: academicYearErr } =
    classRow.academic_year
      ? await admin
          .from("academic_years")
          .select("id,code")
          .eq("institution_id", institutionId)
          .eq("code", classRow.academic_year)
          .maybeSingle()
      : { data: null, error: null as any };

  if (academicYearErr) throw new Error(academicYearErr.message);

  const scheduleIds = scheduleRows.map((s) => s.id);

  const { data: existingCharges, error: exErr } = scheduleIds.length
    ? await admin
        .schema("finance")
        .from("student_charges")
        .select("id,student_id,fee_schedule_id")
        .eq("school_id", institutionId)
        .eq("class_id", classId)
        .in("fee_schedule_id", scheduleIds)
        .range(0, 9999)
    : { data: [], error: null as any };

  if (exErr) throw new Error(exErr.message);

  const existingSet = new Set(
    (
      (existingCharges ?? []) as Array<{
        student_id: string;
        fee_schedule_id: string | null;
      }>
    ).map((row) => `${row.student_id}:${row.fee_schedule_id || ""}`),
  );

  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  const inserts = studentRows.flatMap((student) =>
    scheduleRows
      .filter(
        (schedule) =>
          financeScheduleAppliesToStudent(schedule, student, scheduleCategoriesById) &&
          !existingSet.has(`${student.id}:${schedule.id}`),
      )
      .map((schedule) => ({
        school_id: institutionId,
        academic_year_id: academicYearRow?.id || null,
        academic_year: schedule.academic_year || classRow.academic_year || null,
        student_id: student.id,
        class_id: classId,
        fee_schedule_id: schedule.id,
        fee_category_id: schedule.fee_category_id,
        label: schedule.label,
        base_amount: Number(schedule.amount || 0),
        due_date: schedule.due_date || null,
        charge_date: today,
        status: "pending",
        notes: schedule.notes || `Généré depuis le barème de ${classRow.label}`,
        created_by: userId,
        created_at: nowIso,
        updated_at: nowIso,
      })),
  );

  if (inserts.length > 0) {
    const { error: insErr } = await admin
      .schema("finance")
      .from("student_charges")
      .insert(inserts as any);

    if (insErr) throw new Error(insErr.message);
  }

  revalidatePath("/admin/finance/charges");
  revalidatePath("/admin/finance/payments");
  revalidatePath("/admin/finance/arrears");
  revalidatePath("/admin/finance/reports");
  revalidatePath("/admin/finance");
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
            {label}
          </div>
          <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
          <div className="mt-1 text-sm text-slate-600">{hint}</div>
        </div>
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
          {icon}
        </div>
      </div>
    </div>
  );
}

export default async function FinanceChargesPage({
  searchParams,
}: {
  searchParams?: Promise<{ academic_year?: string }>;
}) {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const params = searchParams ? await searchParams : undefined;
  const requestedAcademicYear = String(params?.academic_year || "").trim();

  const { institutionId } = await getCurrentContextOrThrow();
  const admin = getSupabaseServiceClient();
  const academicYearCtx = await getFinanceAcademicYearContext(
    institutionId,
    requestedAcademicYear,
  );
  const { academicYears, selectedAcademicYearCode } = academicYearCtx;

  const adminStudents = await getAdminStudentsServer(
    selectedAcademicYearCode || undefined,
  );

  let classesQuery = admin
    .from("classes")
    .select("id,label,level,academic_year")
    .eq("institution_id", institutionId);

  if (selectedAcademicYearCode) {
    classesQuery = classesQuery.eq("academic_year", selectedAcademicYearCode);
  }

  const { data: classes, error: clsErr } = await classesQuery.order("label", {
    ascending: true,
  });

  if (clsErr) throw new Error(clsErr.message);

  const classRows = (classes ?? []) as ClassRow[];
  const classIds = classRows.map((row) => row.id);

  const [
    { data: schedules, error: schErr },
    { data: categories, error: catErr },
    { data: balances, error: balErr },
  ] = await Promise.all([
    admin
      .schema("finance")
      .from("fee_schedules")
      .select(
        "id,school_id,academic_year,class_id,fee_category_id,label,amount,due_date,allow_partial,is_active,notes,created_at,updated_at",
      )
      .eq("school_id", institutionId)
      .eq("is_active", true)
      .range(0, 9999),

    admin
      .schema("finance")
      .from("fee_categories")
      .select("id,code,name,is_mandatory")
      .eq("school_id", institutionId),

    classIds.length > 0
      ? fetchFinanceChargeBalancesByClasses({
          institutionIds: [institutionId],
          classIds,
        })
          .then((data) => ({ data, error: null }))
          .catch((error) => ({ data: [], error }))
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (schErr) throw new Error(schErr.message);
  if (catErr) throw new Error(catErr.message);
  if (balErr) throw new Error(balErr.message);

  const classIdSet = new Set(classIds);
  const studentRows = adminStudents.filter((student) =>
    student.class_id ? classIdSet.has(student.class_id) : false,
  );
  const rawScheduleRows = (schedules ?? []) as FeeScheduleRow[];
  const selectedClassIdSet = new Set(classIds);
  const scheduleRows = rawScheduleRows.filter((schedule) => {
    const scheduleClassId = String(schedule.class_id || "").trim();
    const scheduleAcademicYear = String(schedule.academic_year || "").trim();
    const classMatches = !scheduleClassId || selectedClassIdSet.has(scheduleClassId);
    const yearMatches = !selectedAcademicYearCode || !scheduleAcademicYear || scheduleAcademicYear === selectedAcademicYearCode;
    return classMatches && yearMatches;
  });
  const categoriesById = new Map(
    ((categories ?? []) as FeeCategoryRow[]).map((category) => [String(category.id), category]),
  );
  const balanceRows = (balances ?? []) as ChargeBalanceRow[];

  const studentsByClass = studentRows.reduce<Record<string, AdminStudentRow[]>>(
    (acc, row) => {
      const key = row.class_id || "none";
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    },
    {},
  );

  const schedulesByClass = scheduleRows.reduce<
    Record<string, FeeScheduleRow[]>
  >((acc, row) => {
    const key = row.class_id || "none";
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  const balancesByClass = balanceRows.reduce<
    Record<string, ChargeBalanceRow[]>
  >((acc, row) => {
    const key = row.class_id || "none";
    if (!acc[key]) acc[key] = [];
    acc[key].push(row);
    return acc;
  }, {});

  const totalStudents = studentRows.length;
  const totalSchedules = scheduleRows.length;
  const totalCharges = balanceRows.length;
  const totalDue = balanceRows.reduce(
    (sum, row) => sum + Number(row.balance_due || 0),
    0,
  );

  const classSummaries = classRows.map((cls) => {
    const classStudents = studentsByClass[cls.id] || [];
    const classSchedules = [
      ...(schedulesByClass[cls.id] || []),
      ...(schedulesByClass.none || []),
    ];
    const classBalances = balancesByClass[cls.id] || [];

    const theoreticalCount = classStudents.reduce(
      (total, student) =>
        total +
        classSchedules.filter((schedule) =>
          financeScheduleAppliesToStudent(
            schedule,
            {
              is_affecte: student.is_affecte ?? null,
              is_boarder: student.is_boarder ?? null,
            },
            categoriesById,
          ),
        ).length,
      0,
    );
    const actualCount = classBalances.length;
    const missingCount = Math.max(theoreticalCount - actualCount, 0);
    const dueAmount = classBalances.reduce(
      (sum, row) => sum + Number(row.balance_due || 0),
      0,
    );

    return {
      classRow: cls,
      studentsCount: classStudents.length,
      schedulesCount: classSchedules.length,
      theoreticalCount,
      actualCount,
      missingCount,
      dueAmount,
      recentBalances: classBalances
        .slice()
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
        .slice(0, 4),
    };
  });

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
              <Wallet className="h-3.5 w-3.5" />
              Gestion financière premium
            </div>

            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              Génération des dettes élèves
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Cette page transforme les barèmes d’une classe en dettes réelles
              pour les élèves, sans lecture SQL directe de la table students.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
              Statut
            </div>
            <div className="mt-2 text-lg font-black text-white">
              Premium actif
            </div>
            <div className="mt-1 text-sm text-slate-200">
              Expiration : {access.expiresAt || "—"}
            </div>
          </div>
        </div>
      </section>

      <AcademicYearSelector
        academicYears={academicYears}
        selectedAcademicYearCode={selectedAcademicYearCode}
        currentPath="/admin/finance/charges"
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<UserRound className="h-5 w-5" />}
          label="Élèves"
          value={totalStudents}
          hint="Remontés par l’API admin"
        />
        <StatCard
          icon={<Layers3 className="h-5 w-5" />}
          label="Barèmes actifs"
          value={totalSchedules}
          hint="Tous niveaux confondus"
        />
        <StatCard
          icon={<Receipt className="h-5 w-5" />}
          label="Dettes générées"
          value={totalCharges}
          hint="Lignes existantes"
        />
        <StatCard
          icon={<CalendarClock className="h-5 w-5" />}
          label="Reste dû"
          value={formatMoney(totalDue)}
          hint="Sur les dettes générées"
        />
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">
          Génération par classe
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {classSummaries.map((summary) => (
            <article
              key={summary.classRow.id}
              className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-black text-slate-900">
                  {summary.classRow.label}
                </h2>
                {summary.classRow.level ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
                    {summary.classRow.level}
                  </span>
                ) : null}
                {summary.classRow.academic_year ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
                    {summary.classRow.academic_year}
                  </span>
                ) : null}
              </div>

              <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                <div>
                  <span className="font-semibold text-slate-800">Élèves :</span>{" "}
                  {summary.studentsCount}
                </div>
                <div>
                  <span className="font-semibold text-slate-800">
                    Barèmes :
                  </span>{" "}
                  {summary.schedulesCount}
                </div>
                <div>
                  <span className="font-semibold text-slate-800">
                    Théorique :
                  </span>{" "}
                  {summary.theoreticalCount}
                </div>
                <div>
                  <span className="font-semibold text-slate-800">
                    Générées :
                  </span>{" "}
                  {summary.actualCount}
                </div>
                <div>
                  <span className="font-semibold text-slate-800">
                    Manquantes :
                  </span>{" "}
                  {summary.missingCount}
                </div>
                <div>
                  <span className="font-semibold text-slate-800">
                    Reste dû :
                  </span>{" "}
                  {formatMoney(summary.dueAmount)}
                </div>
              </div>

              <form action={generateChargesForClassAction} className="mt-4">
                <input
                  type="hidden"
                  name="class_id"
                  value={summary.classRow.id}
                />
                <button
                  className="inline-flex w-full items-center justify-center rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={
                    summary.studentsCount === 0 || summary.schedulesCount === 0
                  }
                >
                  Générer les dettes manquantes
                </button>
              </form>

              {summary.studentsCount === 0 ? (
                <p className="mt-3 text-xs text-amber-700">
                  Aucun élève dans cette classe.
                </p>
              ) : null}

              {summary.schedulesCount === 0 ? (
                <p className="mt-3 text-xs text-amber-700">
                  Aucun barème actif pour cette classe.
                </p>
              ) : null}

              {summary.recentBalances.length > 0 ? (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
                    Exemples de dettes générées
                  </div>
                  <div className="mt-3 space-y-2">
                    {summary.recentBalances.map((row) => (
                      <div
                        key={row.id}
                        className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700"
                      >
                        <div className="font-semibold text-slate-800">
                          {row.label}
                        </div>
                        <div>
                          Brut : {formatMoney(row.net_amount)} • Reste :{" "}
                          {formatMoney(row.balance_due)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
