// src/app/admin/finance/receipts/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  CalendarClock,
  FileText,
  Printer,
  Receipt,
  Search,
  UserRound,
  Wallet,
  XCircle,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";
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

type ReceiptRow = {
  id: string;
  school_id: string;
  academic_year_id: string | null;
  academic_year: string | null;
  student_id: string;
  receipt_no: string;
  receipt_status: "posted" | "cancelled";
  payment_date: string;
  payer_name: string | null;
  reference_no: string | null;
  total_amount: number | string;
  notes: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_at: string;
};

type ReceiptAllocationRow = {
  id: string;
  receipt_id: string;
  student_charge_id: string;
  amount: number | string;
  created_at: string;
};

type ChargeRow = {
  id: string;
  student_id: string;
  class_id: string | null;
  label: string;
  due_date: string | null;
  net_amount: number | string;
  paid_amount: number | string;
  balance_due: number | string;
};

function formatMoney(value: number | string) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function fullName(student: AdminStudentRow | undefined | null) {
  if (!student) return "Élève inconnu";
  return student.full_name || student.matricule || "Élève sans nom";
}

function normalize(input: string) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
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
  status,
}: {
  status: "posted" | "cancelled";
}) {
  return status === "posted" ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
      <BadgeCheck className="h-3.5 w-3.5" />
      Validé
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
      <XCircle className="h-3.5 w-3.5" />
      Annulé
    </span>
  );
}

export default async function FinanceReceiptsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string; status?: string; class_id?: string }>;
}) {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const params = searchParams ? await searchParams : undefined;
  const q = String(params?.q || "").trim();
  const statusFilter = String(params?.status || "").trim();
  const classIdFilter = String(params?.class_id || "").trim();

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const supabase = await getSupabaseServerClient();
  const adminStudents = await getAdminStudentsServer();

  const { data: classes, error: clsErr } = await supabase
    .from("classes")
    .select("id,label,level,academic_year")
    .eq("institution_id", institutionId)
    .order("label", { ascending: true });

  if (clsErr) throw new Error(clsErr.message);

  const classRows = (classes ?? []) as ClassRow[];
  const classMap = new Map(classRows.map((c) => [c.id, c]));

  let receiptsQuery = supabase
    .schema("finance")
    .from("receipts")
    .select(
      "id,school_id,academic_year_id,academic_year,student_id,receipt_no,receipt_status,payment_date,payer_name,reference_no,total_amount,notes,cancelled_at,cancelled_by,cancel_reason,created_at"
    )
    .eq("school_id", institutionId)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (statusFilter === "posted" || statusFilter === "cancelled") {
    receiptsQuery = receiptsQuery.eq("receipt_status", statusFilter);
  }

  const { data: receipts, error: recErr } = await receiptsQuery;
  if (recErr) throw new Error(recErr.message);

  const receiptRows = (receipts ?? []) as ReceiptRow[];

  const receiptStudentIds = new Set(receiptRows.map((r) => r.student_id));
  const studentRows = adminStudents.filter((s) => receiptStudentIds.has(s.id));
  const studentMap = new Map(studentRows.map((s) => [s.id, s]));

  let filteredReceipts = receiptRows;

  if (classIdFilter) {
    filteredReceipts = filteredReceipts.filter((row) => {
      const student = studentMap.get(row.student_id);
      return student?.class_id === classIdFilter;
    });
  }

  const qn = normalize(q);
  if (qn) {
    filteredReceipts = filteredReceipts.filter((row) => {
      const student = studentMap.get(row.student_id);
      const cls =
        student?.class_id ? classMap.get(student.class_id) : undefined;

      const haystack = normalize(
        [
          row.receipt_no,
          row.payer_name || "",
          row.reference_no || "",
          row.academic_year || "",
          fullName(student),
          student?.matricule || "",
          student?.class_label || "",
          cls?.label || "",
          cls?.level || "",
        ].join(" ")
      );

      return haystack.includes(qn);
    });
  }

  const receiptIds = filteredReceipts.map((r) => r.id);

  const { data: allocations, error: allocErr } = receiptIds.length
    ? await supabase
        .schema("finance")
        .from("receipt_allocations")
        .select("id,receipt_id,student_charge_id,amount,created_at")
        .in("receipt_id", receiptIds)
    : { data: [], error: null as any };

  if (allocErr) throw new Error(allocErr.message);

  const allocationRows = (allocations ?? []) as ReceiptAllocationRow[];
  const chargeIds = Array.from(new Set(allocationRows.map((a) => a.student_charge_id)));

  const { data: charges, error: chErr } = chargeIds.length
    ? await supabase
        .schema("finance")
        .from("v_charge_balances")
        .select(
          "id,student_id,class_id,label,due_date,net_amount,paid_amount,balance_due"
        )
        .in("id", chargeIds)
    : { data: [], error: null as any };

  if (chErr) throw new Error(chErr.message);

  const chargeRows = (charges ?? []) as ChargeRow[];
  const chargeMap = new Map(chargeRows.map((c) => [c.id, c]));

  const allocationsByReceipt = allocationRows.reduce<Record<string, ReceiptAllocationRow[]>>(
    (acc, row) => {
      if (!acc[row.receipt_id]) acc[row.receipt_id] = [];
      acc[row.receipt_id].push(row);
      return acc;
    },
    {}
  );

  const postedReceipts = filteredReceipts.filter((r) => r.receipt_status === "posted");
  const cancelledReceipts = filteredReceipts.filter(
    (r) => r.receipt_status === "cancelled"
  );

  const postedAmount = postedReceipts.reduce(
    (sum, row) => sum + Number(row.total_amount || 0),
    0
  );

  const cancelledAmount = cancelledReceipts.reduce(
    (sum, row) => sum + Number(row.total_amount || 0),
    0
  );

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
              <Receipt className="h-3.5 w-3.5" />
              Gestion financière premium
            </div>

            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              Reçus
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Historique des encaissements manuels enregistrés par
              l’établissement, avec détail des montants ventilés sur les dettes
              élèves.
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
          label="Reçus"
          value={filteredReceipts.length}
          hint="Après filtrage"
        />
        <StatCard
          icon={<BadgeCheck className="h-5 w-5" />}
          label="Validés"
          value={postedReceipts.length}
          hint={formatMoney(postedAmount)}
        />
        <StatCard
          icon={<XCircle className="h-5 w-5" />}
          label="Annulés"
          value={cancelledReceipts.length}
          hint={formatMoney(cancelledAmount)}
        />
        <StatCard
          icon={<UserRound className="h-5 w-5" />}
          label="Élèves"
          value={new Set(filteredReceipts.map((r) => r.student_id)).size}
          hint="Concernés par les reçus"
        />
      </section>

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <form className="grid gap-3 lg:grid-cols-[1fr_220px_260px_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Rechercher un reçu, un élève, un payeur ou une référence"
              className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400"
            />
          </div>

          <select
            name="status"
            defaultValue={statusFilter}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
          >
            <option value="">Tous les statuts</option>
            <option value="posted">Validés</option>
            <option value="cancelled">Annulés</option>
          </select>

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
        {filteredReceipts.length === 0 ? (
          <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-5 py-12 text-center text-sm text-slate-600">
            Aucun reçu trouvé pour ce filtre.
          </div>
        ) : (
          filteredReceipts.map((row) => {
            const student = studentMap.get(row.student_id);
            const cls =
              student?.class_id ? classMap.get(student.class_id) : null;
            const items = (allocationsByReceipt[row.id] || []).map((alloc) => ({
              alloc,
              charge: chargeMap.get(alloc.student_charge_id),
            }));

            return (
              <article
                key={row.id}
                className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm"
              >
                <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-5 py-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-black tracking-tight text-slate-900">
                          {row.receipt_no}
                        </h2>
                        <StatusPill status={row.receipt_status} />
                      </div>

                      <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                          <span className="font-semibold text-slate-800">Élève :</span>{" "}
                          {fullName(student)}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Matricule :</span>{" "}
                          {student?.matricule || "—"}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Classe :</span>{" "}
                          {student?.class_label || cls?.label || "—"}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Payeur :</span>{" "}
                          {row.payer_name || "—"}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Référence :</span>{" "}
                          {row.reference_no || "—"}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Année :</span>{" "}
                          {row.academic_year || cls?.academic_year || "—"}
                        </div>
                      </div>

                      {row.notes ? (
                        <p className="mt-3 text-sm leading-6 text-slate-600">
                          {row.notes}
                        </p>
                      ) : null}

                      {row.receipt_status === "cancelled" && row.cancel_reason ? (
                        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                          <span className="font-semibold text-slate-800">
                            Motif d’annulation :
                          </span>{" "}
                          {row.cancel_reason}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-col items-start gap-2 lg:items-end">
                      <div className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 ring-1 ring-emerald-200">
                        {formatMoney(row.total_amount)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatDateTime(row.payment_date)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-5 px-5 py-5 lg:grid-cols-[1.25fr_0.95fr]">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
                      <Wallet className="h-4 w-4 text-emerald-600" />
                      Ventilation du reçu
                    </div>

                    {items.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
                        Aucune ventilation trouvée pour ce reçu.
                      </div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {items.map(({ alloc, charge }) => (
                          <div
                            key={alloc.id}
                            className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <div className="text-base font-black text-slate-900">
                                  {charge?.label || "Dette introuvable"}
                                </div>
                                <div className="mt-1 text-sm text-slate-600">
                                  Échéance : {charge?.due_date || "—"}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  Brut : {formatMoney(charge?.net_amount || 0)} • Déjà payé :{" "}
                                  {formatMoney(charge?.paid_amount || 0)} • Reste :{" "}
                                  {formatMoney(charge?.balance_due || 0)}
                                </div>
                              </div>

                              <div className="rounded-full bg-sky-50 px-3 py-1.5 text-sm font-bold text-sky-700 ring-1 ring-sky-200">
                                {formatMoney(alloc.amount)}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
                      <CalendarClock className="h-4 w-4 text-emerald-600" />
                      Informations complémentaires
                    </div>

                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-700">
                      <div className="grid gap-3">
                        <div>
                          <span className="font-semibold text-slate-800">Date de paiement :</span>{" "}
                          {formatDateTime(row.payment_date)}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Créé le :</span>{" "}
                          {formatDateTime(row.created_at)}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Année :</span>{" "}
                          {row.academic_year || cls?.academic_year || "—"}
                        </div>
                        <div>
                          <span className="font-semibold text-slate-800">Statut :</span>{" "}
                          {row.receipt_status === "posted" ? "Validé" : "Annulé"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <Link
                        href={`/admin/finance/receipts/${row.id}`}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700"
                      >
                        <FileText className="h-4 w-4" />
                        Ouvrir le reçu
                      </Link>

                      <Link
                        href={`/admin/finance/receipts/${row.id}?autoprint=1`}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <Printer className="h-4 w-4" />
                        Imprimer
                      </Link>

                      <Link
                        href="/admin/finance/payments"
                        className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
                      >
                        Retour aux encaissements
                      </Link>
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}