// src/app/admin/finance/arrears/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  Receipt,
  Search,
  UserRound,
  Wallet,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";

export const dynamic = "force-dynamic";

type ClassRow = {
  id: string;
  label: string;
  level: string | null;
  academic_year: string | null;
};

type StudentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  matricule: string | null;
  class_id: string | null;
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

function formatMoney(value: number | string) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function fullName(student: StudentRow | undefined | null) {
  if (!student) return "Élève inconnu";
  const parts = [student.first_name || "", student.last_name || ""]
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.join(" ") || student.matricule || "Élève sans nom";
}

function normalize(input: string) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

async function getCurrentInstitutionIdOrThrow() {
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

  return profile.institution_id as string;
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

function StatusPill({
  overdue,
  label,
}: {
  overdue: boolean;
  label: string;
}) {
  return overdue ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 ring-1 ring-amber-200">
      <AlertTriangle className="h-3.5 w-3.5" />
      {label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
      <CalendarClock className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

export default async function FinanceArrearsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; class_id?: string }>;
}) {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const params = searchParams ? await searchParams : undefined;
  const q = String(params?.q || "").trim();
  const classIdFilter = String(params?.class_id || "").trim();

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const supabase = await getSupabaseServerClient();

  const { data: classes, error: clsErr } = await supabase
    .from("classes")
    .select("id,label,level,academic_year")
    .eq("institution_id", institutionId)
    .order("label", { ascending: true });

  if (clsErr) throw new Error(clsErr.message);

  const classRows = (classes ?? []) as ClassRow[];
  const classMap = new Map(classRows.map((c) => [c.id, c]));

  let balancesQuery = supabase
    .schema("finance")
    .from("v_charge_balances")
    .select(
      "id,school_id,academic_year_id,student_id,class_id,fee_schedule_id,fee_category_id,label,base_amount,adjustment_total,net_amount,paid_amount,balance_due,due_date,charge_date,computed_status,created_at,updated_at"
    )
    .eq("school_id", institutionId)
    .gt("balance_due", 0)
    .neq("computed_status", "cancelled")
    .order("due_date", { ascending: true, nullsFirst: false });

  if (classIdFilter) {
    balancesQuery = balancesQuery.eq("class_id", classIdFilter);
  }

  const { data: balances, error: balErr } = await balancesQuery;

  if (balErr) throw new Error(balErr.message);

  const balanceRows = (balances ?? []) as ChargeBalanceRow[];
  const studentIds = Array.from(new Set(balanceRows.map((b) => b.student_id)));

  const { data: students, error: stuErr } = studentIds.length
    ? await supabase
        .from("students")
        .select("id,first_name,last_name,matricule,class_id")
        .in("id", studentIds)
    : { data: [], error: null as any };

  if (stuErr) throw new Error(stuErr.message);

  const studentRows = (students ?? []) as StudentRow[];
  const studentMap = new Map(studentRows.map((s) => [s.id, s]));

  const qn = normalize(q);

  const filteredRows = balanceRows.filter((row) => {
    const student = studentMap.get(row.student_id);
    const cls = row.class_id ? classMap.get(row.class_id) : null;

    if (!qn) return true;

    const haystack = normalize(
      [
        fullName(student),
        student?.matricule || "",
        cls?.label || "",
        cls?.level || "",
        cls?.academic_year || "",
        row.label || "",
      ].join(" ")
    );

    return haystack.includes(qn);
  });

  const totalDue = filteredRows.reduce(
    (sum, row) => sum + Number(row.balance_due || 0),
    0
  );

  const overdueRows = filteredRows.filter((row) => {
    if (!row.due_date) return false;
    return new Date(`${row.due_date}T23:59:59`).getTime() < Date.now();
  });

  const overdueAmount = overdueRows.reduce(
    (sum, row) => sum + Number(row.balance_due || 0),
    0
  );

  const impactedStudentsCount = new Set(filteredRows.map((r) => r.student_id)).size;

  const groupedByStudent = filteredRows.reduce<
    Record<
      string,
      {
        student: StudentRow | undefined;
        classRow: ClassRow | undefined;
        totalDue: number;
        overdueDue: number;
        charges: ChargeBalanceRow[];
      }
    >
  >((acc, row) => {
    const student = studentMap.get(row.student_id);
    const classRow = row.class_id ? classMap.get(row.class_id) : undefined;

    if (!acc[row.student_id]) {
      acc[row.student_id] = {
        student,
        classRow,
        totalDue: 0,
        overdueDue: 0,
        charges: [],
      };
    }

    const amount = Number(row.balance_due || 0);
    const overdue =
      !!row.due_date &&
      new Date(`${row.due_date}T23:59:59`).getTime() < Date.now();

    acc[row.student_id].totalDue += amount;
    if (overdue) acc[row.student_id].overdueDue += amount;
    acc[row.student_id].charges.push(row);

    return acc;
  }, {});

  const studentGroups = Object.values(groupedByStudent).sort(
    (a, b) => b.totalDue - a.totalDue
  );

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
              Impayés
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Vue des dettes encore ouvertes par élève, avec le reste à payer,
              les échéances dépassées et un accès direct à l’enregistrement
              manuel des règlements.
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

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Receipt className="h-5 w-5" />}
          label="Dettes ouvertes"
          value={filteredRows.length}
          hint="Lignes encore impayées"
        />
        <StatCard
          icon={<UserRound className="h-5 w-5" />}
          label="Élèves concernés"
          value={impactedStudentsCount}
          hint="Avec au moins une dette"
        />
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          label="Total à recouvrer"
          value={formatMoney(totalDue)}
          hint="Somme des soldes dus"
        />
        <StatCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Échu"
          value={formatMoney(overdueAmount)}
          hint={`${overdueRows.length} ligne(s) dépassée(s)`}
        />
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <form className="grid gap-3 lg:grid-cols-[1fr_280px_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Rechercher un élève, un matricule, une classe ou un frais"
              className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400"
            />
          </div>

          <select
            name="class_id"
            defaultValue={classIdFilter}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
          >
            <option value="">Toutes les classes</option>
            {classRows.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.label}
                {cls.level ? ` — ${cls.level}` : ""}
                {cls.academic_year ? ` — ${cls.academic_year}` : ""}
              </option>
            ))}
          </select>

          <button className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700">
            Filtrer
          </button>
        </form>
      </section>

      <section className="space-y-5">
        {studentGroups.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-5 py-12 text-center text-sm text-slate-600">
            Aucun impayé trouvé pour ce filtre.
          </div>
        ) : (
          studentGroups.map((group, idx) => {
            const student = group.student;
            const cls = group.classRow;

            return (
              <article
                key={`${student?.id || "unknown"}-${idx}`}
                className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm"
              >
                <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-5 py-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-black tracking-tight text-slate-900">
                          {fullName(student)}
                        </h2>

                        {student?.matricule ? (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
                            {student.matricule}
                          </span>
                        ) : null}

                        {group.overdueDue > 0 ? (
                          <StatusPill overdue label="Au moins une échéance dépassée" />
                        ) : (
                          <StatusPill overdue={false} label="Dettes ouvertes" />
                        )}
                      </div>

                      <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
                        <div>
                          <span className="font-semibold text-slate-800">Classe :</span>{" "}
                          {cls?.label || "—"}
                          {cls?.level ? ` (${cls.level})` : ""}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Année :</span>{" "}
                          {cls?.academic_year || "—"}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Nombre de dettes :</span>{" "}
                          {group.charges.length}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="rounded-full bg-rose-50 px-3 py-1.5 text-sm font-bold text-rose-700 ring-1 ring-rose-200">
                        Total dû : {formatMoney(group.totalDue)}
                      </div>

                      <Link
                        href="/admin/finance/payments"
                        className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700"
                      >
                        Enregistrer un paiement
                      </Link>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 px-5 py-5">
                  {group.charges
                    .sort((a, b) => {
                      const ad = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
                      const bd = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
                      return ad - bd;
                    })
                    .map((row) => {
                      const overdue =
                        !!row.due_date &&
                        new Date(`${row.due_date}T23:59:59`).getTime() < Date.now();

                      return (
                        <div
                          key={row.id}
                          className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-lg font-black text-slate-900">
                                  {row.label}
                                </h3>

                                {overdue ? (
                                  <StatusPill overdue label="Échu" />
                                ) : (
                                  <StatusPill overdue={false} label="À recouvrer" />
                                )}
                              </div>

                              <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
                                <div>
                                  <span className="font-semibold text-slate-800">Brut :</span>{" "}
                                  {formatMoney(row.net_amount)}
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-800">Déjà payé :</span>{" "}
                                  {formatMoney(row.paid_amount)}
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-800">Reste dû :</span>{" "}
                                  {formatMoney(row.balance_due)}
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-800">Échéance :</span>{" "}
                                  {row.due_date || "—"}
                                </div>
                              </div>
                            </div>

                            <Link
                              href="/admin/finance/payments"
                              className="inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm font-bold text-emerald-700 hover:bg-emerald-50"
                            >
                              Régler cette dette
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}