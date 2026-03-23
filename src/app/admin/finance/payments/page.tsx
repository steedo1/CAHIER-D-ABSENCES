// src/app/admin/finance/payments/page.tsx
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  CalendarClock,
  CreditCard,
  Receipt,
  UserRound,
  Wallet,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
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
  base_amount: number;
  adjustment_total: number;
  net_amount: number;
  paid_amount: number;
  balance_due: number;
  due_date: string | null;
  charge_date: string;
  computed_status: "pending" | "partial" | "paid" | "overdue" | "cancelled";
  created_at: string;
  updated_at: string;
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
  total_amount: number;
  notes: string | null;
  created_at: string;
};

function fullName(student: StudentRow | undefined | null) {
  if (!student) return "Élève inconnu";
  const parts = [student.first_name || "", student.last_name || ""]
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.join(" ") || student.matricule || "Élève sans nom";
}

function formatMoney(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function makeReceiptNo() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `REC-${stamp}-${rand}`;
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

async function createPaymentAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const { institutionId, userId } = await getCurrentContextOrThrow();
  const admin = getSupabaseServiceClient();

  const chargeId = String(formData.get("student_charge_id") || "").trim();
  const amountRaw = String(formData.get("amount") || "").trim();
  const payerName = String(formData.get("payer_name") || "").trim();
  const referenceNo = String(formData.get("reference_no") || "").trim();
  const paymentDate = String(formData.get("payment_date") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  if (!chargeId) {
    throw new Error("Veuillez choisir une dette élève.");
  }

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Le montant doit être supérieur à 0.");
  }

  const { data: charge, error: chargeErr } = await admin
    .schema("finance")
    .from("v_charge_balances")
    .select(
      "id,school_id,academic_year_id,student_id,class_id,fee_schedule_id,fee_category_id,label,base_amount,adjustment_total,net_amount,paid_amount,balance_due,due_date,charge_date,computed_status,created_at,updated_at"
    )
    .eq("id", chargeId)
    .eq("school_id", institutionId)
    .maybeSingle();

  if (chargeErr) throw new Error(chargeErr.message);
  if (!charge) throw new Error("Dette introuvable.");

  const balanceDue = Number(charge.balance_due || 0);
  if (balanceDue <= 0) {
    throw new Error("Cette dette est déjà soldée.");
  }

  if (amount > balanceDue) {
    throw new Error(
      `Le montant saisi dépasse le reste dû (${formatMoney(balanceDue)}).`
    );
  }

  let academicYear: string | null = null;

  if (charge.class_id) {
    const { data: cls, error: clsErr } = await admin
      .from("classes")
      .select("id,academic_year,institution_id")
      .eq("id", charge.class_id)
      .eq("institution_id", institutionId)
      .maybeSingle();

    if (clsErr) throw new Error(clsErr.message);
    academicYear = cls?.academic_year ?? null;
  }

  const receiptNo = makeReceiptNo();
  const paymentDateIso = paymentDate
    ? `${paymentDate}T12:00:00`
    : new Date().toISOString();

  const { data: receipt, error: receiptErr } = await admin
    .schema("finance")
    .from("receipts")
    .insert({
      school_id: institutionId,
      academic_year_id: charge.academic_year_id || null,
      academic_year: academicYear,
      student_id: charge.student_id,
      receipt_no: receiptNo,
      receipt_status: "posted",
      payment_date: paymentDateIso,
      payment_method_id: null,
      cash_account_id: null,
      payer_name: payerName || null,
      reference_no: referenceNo || null,
      total_amount: amount,
      notes: notes || null,
      cancelled_at: null,
      cancelled_by: null,
      cancel_reason: null,
      created_by: userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any)
    .select("id, receipt_no")
    .single();

  if (receiptErr) throw new Error(receiptErr.message);

  const { error: allocErr } = await admin
    .schema("finance")
    .from("receipt_allocations")
    .insert({
      receipt_id: receipt.id,
      student_charge_id: charge.id,
      amount,
      created_at: new Date().toISOString(),
    } as any);

  if (allocErr) {
    await admin
      .schema("finance")
      .from("receipts")
      .delete()
      .eq("id", receipt.id);

    throw new Error(allocErr.message);
  }

  revalidatePath("/admin/finance/payments");
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

function StatusPill({
  label,
  tone = "emerald",
}: {
  label: string;
  tone?: "emerald" | "amber" | "slate";
}) {
  const tones = {
    emerald:
      "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    slate: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${tones[tone]}`}
    >
      <BadgeCheck className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

export default async function FinancePaymentsPage() {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const { institutionId } = await getCurrentContextOrThrow();
  const supabase = await getSupabaseServerClient();

  const { data: classes, error: clsErr } = await supabase
    .from("classes")
    .select("id,label,level,academic_year")
    .eq("institution_id", institutionId)
    .order("label", { ascending: true });

  if (clsErr) throw new Error(clsErr.message);

  const classRows = (classes ?? []) as ClassRow[];
  const classIds = classRows.map((c) => c.id);

  const [
    { data: students, error: stuErr },
    { data: balances, error: balErr },
    { data: receipts, error: recErr },
  ] = await Promise.all([
    classIds.length
      ? supabase
          .from("students")
          .select("id,first_name,last_name,matricule,class_id")
          .in("class_id", classIds)
      : Promise.resolve({ data: [], error: null as any }),

    supabase
      .schema("finance")
      .from("v_charge_balances")
      .select(
        "id,school_id,academic_year_id,student_id,class_id,fee_schedule_id,fee_category_id,label,base_amount,adjustment_total,net_amount,paid_amount,balance_due,due_date,charge_date,computed_status,created_at,updated_at"
      )
      .eq("school_id", institutionId)
      .gt("balance_due", 0)
      .neq("computed_status", "cancelled")
      .order("due_date", { ascending: true, nullsFirst: false }),

    supabase
      .schema("finance")
      .from("receipts")
      .select(
        "id,school_id,academic_year_id,academic_year,student_id,receipt_no,receipt_status,payment_date,payer_name,reference_no,total_amount,notes,created_at"
      )
      .eq("school_id", institutionId)
      .order("payment_date", { ascending: false })
      .limit(12),
  ]);

  if (stuErr) throw new Error(stuErr.message);
  if (balErr) throw new Error(balErr.message);
  if (recErr) throw new Error(recErr.message);

  const studentRows = (students ?? []) as StudentRow[];
  const balanceRows = (balances ?? []) as ChargeBalanceRow[];
  const receiptRows = (receipts ?? []) as ReceiptRow[];

  const studentMap = new Map(studentRows.map((s) => [s.id, s]));
  const classMap = new Map(classRows.map((c) => [c.id, c]));

  const totalDue = balanceRows.reduce(
    (sum, row) => sum + Number(row.balance_due || 0),
    0
  );

  const totalReceipts = receiptRows
    .filter((r) => r.receipt_status === "posted")
    .reduce((sum, row) => sum + Number(row.total_amount || 0), 0);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
              <CreditCard className="h-3.5 w-3.5" />
              Gestion financière premium
            </div>

            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              Encaissements manuels
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Cette page sert à enregistrer manuellement les paiements reçus par
              l’établissement. Aucun paiement en ligne n’est déclenché ici.
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
          icon={<UserRound className="h-5 w-5" />}
          label="Dettes ouvertes"
          value={balanceRows.length}
          hint="Lignes encore à encaisser"
        />
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          label="Reste à recouvrer"
          value={formatMoney(totalDue)}
          hint="Somme des soldes dus"
        />
        <StatCard
          icon={<Receipt className="h-5 w-5" />}
          label="Reçus récents"
          value={receiptRows.length}
          hint="12 derniers reçus"
        />
        <StatCard
          icon={<CalendarClock className="h-5 w-5" />}
          label="Montant récent"
          value={formatMoney(totalReceipts)}
          hint="Total des reçus affichés"
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[430px_1fr]">
        <form
          action={createPaymentAction}
          className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <Receipt className="h-4 w-4 text-emerald-600" />
            Nouveau règlement
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Dette à régler
              </label>
              <select
                name="student_charge_id"
                required
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
              >
                <option value="">— Choisir une dette élève —</option>
                {balanceRows.map((row) => {
                  const student = studentMap.get(row.student_id);
                  const cls = row.class_id ? classMap.get(row.class_id) : null;
                  const name = fullName(student);
                  const classLabel = cls?.label || "Sans classe";
                  const matricule = student?.matricule ? ` — ${student.matricule}` : "";
                  return (
                    <option key={row.id} value={row.id}>
                      {name}
                      {matricule}
                      {" — "}
                      {classLabel}
                      {" — "}
                      {row.label}
                      {" — "}
                      {formatMoney(row.balance_due)}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Montant encaissé
              </label>
              <input
                type="number"
                name="amount"
                min="1"
                step="0.01"
                required
                placeholder="Ex. 25000"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
              />
              <p className="mt-1 text-xs text-slate-500">
                Le montant ne doit pas dépasser le reste dû de la dette choisie.
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Nom du payeur
              </label>
              <input
                type="text"
                name="payer_name"
                placeholder="Ex. Parent / Tuteur"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Référence
              </label>
              <input
                type="text"
                name="reference_no"
                placeholder="Ex. Versement caisse 001"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Date d’encaissement
              </label>
              <input
                type="date"
                name="payment_date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Notes
              </label>
              <textarea
                name="notes"
                rows={4}
                placeholder="Commentaire interne"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>

            <button className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700">
              <Receipt className="h-4 w-4" />
              Enregistrer le paiement
            </button>
          </div>
        </form>

        <div className="space-y-6">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
              <Wallet className="h-4 w-4 text-emerald-600" />
              Dettes ouvertes
            </div>

            {balanceRows.length === 0 ? (
              <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
                Aucune dette ouverte pour le moment.
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {balanceRows.map((row) => {
                  const student = studentMap.get(row.student_id);
                  const cls = row.class_id ? classMap.get(row.class_id) : null;
                  const overdue =
                    row.due_date &&
                    new Date(`${row.due_date}T23:59:59`).getTime() < Date.now();

                  return (
                    <article
                      key={row.id}
                      className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-black text-slate-900">
                              {fullName(student)}
                            </h2>
                            {student?.matricule ? (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
                                {student.matricule}
                              </span>
                            ) : null}
                            <StatusPill
                              label={overdue ? "Échu" : "Ouvert"}
                              tone={overdue ? "amber" : "emerald"}
                            />
                          </div>

                          <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
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
                              <span className="font-semibold text-slate-800">Frais :</span>{" "}
                              {row.label}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-800">Échéance :</span>{" "}
                              {row.due_date || "—"}
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-bold text-slate-700 ring-1 ring-slate-200">
                              Brut : {formatMoney(row.net_amount)}
                            </span>
                            <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 ring-1 ring-emerald-200">
                              Payé : {formatMoney(row.paid_amount)}
                            </span>
                            <span className="rounded-full bg-rose-50 px-3 py-1.5 text-sm font-bold text-rose-700 ring-1 ring-rose-200">
                              Reste : {formatMoney(row.balance_due)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
              <Receipt className="h-4 w-4 text-emerald-600" />
              Reçus récents
            </div>

            {receiptRows.length === 0 ? (
              <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
                Aucun reçu enregistré pour le moment.
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {receiptRows.map((row) => {
                  const student = studentMap.get(row.student_id);
                  const cls = student?.class_id
                    ? classMap.get(student.class_id)
                    : null;

                  return (
                    <article
                      key={row.id}
                      className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-black text-slate-900">
                              {row.receipt_no}
                            </h2>
                            <StatusPill
                              label={row.receipt_status === "posted" ? "Validé" : "Annulé"}
                              tone={row.receipt_status === "posted" ? "emerald" : "slate"}
                            />
                          </div>

                          <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                            <div>
                              <span className="font-semibold text-slate-800">Élève :</span>{" "}
                              {fullName(student)}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-800">Classe :</span>{" "}
                              {cls?.label || "—"}
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
                              <span className="font-semibold text-slate-800">Date :</span>{" "}
                              {new Date(row.payment_date).toLocaleString("fr-FR", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-800">Année :</span>{" "}
                              {row.academic_year || "—"}
                            </div>
                          </div>

                          {row.notes ? (
                            <p className="mt-3 text-sm leading-6 text-slate-600">
                              {row.notes}
                            </p>
                          ) : null}
                        </div>

                        <div className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 ring-1 ring-emerald-200">
                          {formatMoney(row.total_amount)}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}