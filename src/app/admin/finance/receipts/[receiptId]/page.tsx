// src/app/admin/finance/receipts/[receiptId]/page.tsx
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  BadgeCheck,
  GraduationCap,
  Printer,
  Receipt,
  School2,
  UserRound,
  Wallet,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";
import {
  getAdminStudentsServer,
  type AdminStudentRow,
} from "@/lib/admin-students-server";

export const dynamic = "force-dynamic";

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

type ClassRow = {
  id: string;
  label: string;
  level: string | null;
  academic_year: string | null;
};

type InstitutionSettings = {
  institution_name?: string | null;
  institution_label?: string | null;
  name?: string | null;
  institution_logo_url?: string | null;
  institution_phone?: string | null;
  institution_email?: string | null;
  institution_region?: string | null;
  institution_postal_address?: string | null;
  institution_status?: string | null;
  institution_head_name?: string | null;
  institution_head_title?: string | null;
  institution_code?: string | null;
};

function formatMoney(value: number | string) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", { dateStyle: "medium" });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function fullName(student: AdminStudentRow | undefined | null) {
  if (!student) return "Élève inconnu";
  return student.full_name || student.matricule || "Élève sans nom";
}

function institutionDisplayName(cfg: InstitutionSettings) {
  return (
    (cfg.institution_name || "").trim() ||
    (cfg.institution_label || "").trim() ||
    (cfg.name || "").trim() ||
    "Établissement scolaire"
  );
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

function buildOriginFromHeaders(h: Headers) {
  const proto =
    h.get("x-forwarded-proto") ||
    (process.env.NODE_ENV === "development" ? "http" : "https");
  const host = h.get("x-forwarded-host") || h.get("host");

  if (!host) {
    throw new Error("Impossible de déterminer l’hôte courant.");
  }

  return `${proto}://${host}`;
}

async function fetchInstitutionSettingsServer(): Promise<InstitutionSettings> {
  try {
    const h = await headers();
    const c = await cookies();
    const origin = buildOriginFromHeaders(h);

    const res = await fetch(`${origin}/api/admin/institution/settings`, {
      method: "GET",
      headers: {
        cookie: c.toString(),
        accept: "application/json",
      },
      cache: "no-store",
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) return {};

    return {
      institution_name: json?.institution_name ?? "",
      institution_label: json?.institution_label ?? "",
      name: json?.name ?? "",
      institution_logo_url: json?.institution_logo_url ?? "",
      institution_phone: json?.institution_phone ?? "",
      institution_email: json?.institution_email ?? "",
      institution_region: json?.institution_region ?? "",
      institution_postal_address: json?.institution_postal_address ?? "",
      institution_status: json?.institution_status ?? "",
      institution_head_name: json?.institution_head_name ?? "",
      institution_head_title: json?.institution_head_title ?? "",
      institution_code: json?.institution_code ?? "",
    };
  } catch {
    return {};
  }
}

export default async function FinanceReceiptPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ receiptId: string }>;
  searchParams?: Promise<{ autoprint?: string }>;
}) {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const resolvedParams = await params;
  const resolvedSearch = searchParams ? await searchParams : undefined;

  const receiptId = String(resolvedParams?.receiptId || "").trim();
  const autoPrint = String(resolvedSearch?.autoprint || "") === "1";

  if (!receiptId) {
    notFound();
  }

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const supabase = await getSupabaseServerClient();

  const [{ data: receipt, error: recErr }, adminStudents, institutionSettings] =
    await Promise.all([
      supabase
        .schema("finance")
        .from("receipts")
        .select(
          "id,school_id,academic_year_id,academic_year,student_id,receipt_no,receipt_status,payment_date,payer_name,reference_no,total_amount,notes,cancelled_at,cancelled_by,cancel_reason,created_at"
        )
        .eq("school_id", institutionId)
        .eq("id", receiptId)
        .maybeSingle(),
      getAdminStudentsServer(),
      fetchInstitutionSettingsServer(),
    ]);

  if (recErr) throw new Error(recErr.message);
  if (!receipt) notFound();

  const typedReceipt = receipt as ReceiptRow;

  const [
    { data: allocations, error: allocErr },
    { data: classes, error: clsErr },
  ] = await Promise.all([
    supabase
      .schema("finance")
      .from("receipt_allocations")
      .select("id,receipt_id,student_charge_id,amount,created_at")
      .eq("receipt_id", typedReceipt.id)
      .order("created_at", { ascending: true }),

    supabase
      .from("classes")
      .select("id,label,level,academic_year")
      .eq("institution_id", institutionId)
      .order("label", { ascending: true }),
  ]);

  if (allocErr) throw new Error(allocErr.message);
  if (clsErr) throw new Error(clsErr.message);

  const allocationRows = (allocations ?? []) as ReceiptAllocationRow[];
  const classRows = (classes ?? []) as ClassRow[];
  const classMap = new Map(classRows.map((c) => [c.id, c]));

  const chargeIds = Array.from(
    new Set(allocationRows.map((a) => a.student_charge_id))
  );

  const { data: charges, error: chErr } = chargeIds.length
    ? await supabase
        .schema("finance")
        .from("v_charge_balances")
        .select(
          "id,student_id,class_id,label,due_date,net_amount,paid_amount,balance_due"
        )
        .in("id", chargeIds)
    : { data: [], error: null as null | { message?: string } };

  if (chErr) throw new Error(chErr.message);

  const chargeRows = (charges ?? []) as ChargeRow[];
  const chargeMap = new Map(chargeRows.map((c) => [c.id, c]));

  const student = adminStudents.find((s) => s.id === typedReceipt.student_id);
  const currentClass =
    student?.class_id ? classMap.get(student.class_id) : undefined;

  const lines = allocationRows.map((alloc) => ({
    alloc,
    charge: chargeMap.get(alloc.student_charge_id),
  }));

  const totalAllocated = lines.reduce(
    (sum, line) => sum + Number(line.alloc.amount || 0),
    0
  );

  const schoolName = institutionDisplayName(institutionSettings);
  const printHref = `/admin/finance/receipts/${encodeURIComponent(
    receiptId
  )}?autoprint=1`;

  return (
    <div className="receipt-print-root receipt-page-shell mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 print:px-0 print:py-0">
      <style>{`
        @page {
          size: A4 portrait;
          margin: 4mm;
        }

        @media print {
          html,
          body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          body * {
            visibility: hidden !important;
          }

          .receipt-print-root,
          .receipt-print-root * {
            visibility: visible !important;
          }

          .receipt-print-root {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
            background: #ffffff !important;
          }

          .no-print {
            display: none !important;
          }

          .receipt-card {
            width: 202mm !important;
            min-height: 289mm !important;
            height: 289mm !important;
            max-height: 289mm !important;
            margin: 0 auto !important;
            overflow: hidden !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            border: 1px solid #cbd5e1 !important;
          }

          .receipt-header {
            padding: 3.5mm 5mm !important;
          }

          .receipt-main-grid {
            display: grid !important;
            grid-template-columns: 1.15fr 0.85fr !important;
            gap: 3.5mm !important;
            padding: 3.5mm 5mm !important;
          }

          .receipt-col {
            display: flex !important;
            flex-direction: column !important;
            gap: 3.5mm !important;
          }
          .receipt-col > * + * {
            margin-top: 0 !important;
          }

          .receipt-header .gap-4 {
            gap: 3mm !important;
          }

          .receipt-header .gap-6 {
            gap: 3.5mm !important;
          }

          .receipt-logo {
            width: 14mm !important;
            height: 14mm !important;
            border-radius: 10px !important;
            padding: 1.2mm !important;
          }

          .receipt-box {
            break-inside: avoid-page;
            page-break-inside: avoid;
          }

          .receipt-box,
          .receipt-summary-card,
          .receipt-signature-card,
          .receipt-proof-note {
            border-radius: 12px !important;
          }

          .receipt-box {
            padding: 3.5mm !important;
          }

          .receipt-table-wrap {
            overflow: hidden !important;
          }

          .receipt-lines-table th,
          .receipt-lines-table td {
            padding: 2.2mm 2.5mm !important;
            font-size: 11px !important;
          }

          .receipt-lines-table,
          .receipt-lines-table tr,
          .receipt-lines-table td,
          .receipt-lines-table th {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }

          .receipt-school-title {
            margin-top: 1.5mm !important;
            font-size: 20px !important;
            line-height: 1.05 !important;
          }

          .receipt-top-meta {
            margin-top: 1.5mm !important;
            font-size: 11px !important;
            line-height: 1.25 !important;
          }

          .receipt-side-card {
            min-width: 0 !important;
            padding: 3.5mm !important;
            border-radius: 12px !important;
          }

          .receipt-side-lines {
            margin-top: 2.2mm !important;
            gap: 1.2mm !important;
            font-size: 11px !important;
          }

          .receipt-section-title {
            font-size: 11px !important;
            letter-spacing: 0.12em !important;
          }

          .receipt-student-grid {
            margin-top: 2.5mm !important;
            gap: 2mm 3mm !important;
            font-size: 11px !important;
          }

          .receipt-note-box,
          .receipt-cancel-box {
            margin-top: 2.4mm !important;
            padding: 2.4mm 2.8mm !important;
            font-size: 11px !important;
            line-height: 1.3 !important;
          }

          .receipt-summary-shell {
            padding: 3.5mm !important;
          }

          .receipt-summary-card {
            margin-top: 2.5mm !important;
            padding: 3mm !important;
          }

          .receipt-amount-label {
            font-size: 11px !important;
          }

          .receipt-amount-value {
            margin-top: 1mm !important;
            font-size: 22px !important;
            line-height: 1.05 !important;
          }

          .receipt-summary-grid {
            margin-top: 2.4mm !important;
            gap: 1.6mm !important;
            font-size: 11px !important;
          }

          .receipt-status-wrap {
            margin-top: 2.4mm !important;
          }

          .receipt-signature-card {
            padding: 3.5mm !important;
          }

          .receipt-signature-grid {
            margin-top: 3mm !important;
            gap: 4mm !important;
            font-size: 11px !important;
          }

          .receipt-signature-line {
            margin-top: 5mm !important;
          }

          .receipt-signature-name {
            margin-top: 1.6mm !important;
            font-size: 10.5px !important;
          }

          .receipt-proof-note {
            padding: 3mm !important;
            font-size: 10.5px !important;
            line-height: 1.35 !important;
          }

          .receipt-footer {
            padding: 2.5mm 5mm !important;
            font-size: 10px !important;
          }
        }
      `}</style>

      {autoPrint ? (
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.addEventListener('load', function () {
                setTimeout(function () {
                  try {
                    window.print();
                  } catch (e) {}
                }, 350);
              });
            `,
          }}
        />
      ) : null}

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
            Reçu imprimable
          </div>
          <h1 className="mt-1 text-2xl font-black text-slate-900">
            {typedReceipt.receipt_no}
          </h1>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/admin/finance/receipts"
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Retour aux reçus
          </Link>

          <Link
            href={printHref}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700"
          >
            <Printer className="h-4 w-4" />
            Imprimer / PDF
          </Link>
        </div>
      </div>

      <article className="receipt-card overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
        <div className="receipt-header border-b border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-6 py-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4">
              {institutionSettings.institution_logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={institutionSettings.institution_logo_url}
                  alt={schoolName}
                  className="receipt-logo h-16 w-16 rounded-2xl border border-slate-200 object-contain p-2"
                />
              ) : (
                <div className="receipt-logo grid h-16 w-16 place-items-center rounded-2xl border border-slate-200 bg-emerald-50 text-emerald-700">
                  <School2 className="h-8 w-8" />
                </div>
              )}

              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
                  Mon Cahier — Gestion financière
                </div>
                <h2 className="receipt-school-title mt-2 text-2xl font-black tracking-tight text-slate-900">
                  {schoolName}
                </h2>

                <div className="receipt-top-meta mt-2 space-y-1 text-sm text-slate-600">
                  {institutionSettings.institution_postal_address ? (
                    <div>{institutionSettings.institution_postal_address}</div>
                  ) : null}
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {institutionSettings.institution_phone ? (
                      <span>Tél. : {institutionSettings.institution_phone}</span>
                    ) : null}
                    {institutionSettings.institution_email ? (
                      <span>Email : {institutionSettings.institution_email}</span>
                    ) : null}
                    {institutionSettings.institution_region ? (
                      <span>{institutionSettings.institution_region}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="receipt-side-card rounded-3xl border border-slate-200 bg-white px-5 py-4 lg:min-w-[280px]">
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700 ring-1 ring-emerald-200">
                <Receipt className="h-3.5 w-3.5" />
                Reçu de paiement
              </div>

              <div className="receipt-side-lines mt-4 grid gap-2 text-sm text-slate-700">
                <div>
                  <span className="font-semibold text-slate-900">Numéro :</span>{" "}
                  {typedReceipt.receipt_no}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Date :</span>{" "}
                  {formatDateTime(typedReceipt.payment_date)}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Statut :</span>{" "}
                  {typedReceipt.receipt_status === "posted" ? "Validé" : "Annulé"}
                </div>
                {institutionSettings.institution_code ? (
                  <div>
                    <span className="font-semibold text-slate-900">
                      Code établissement :
                    </span>{" "}
                    {institutionSettings.institution_code}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="receipt-main-grid grid gap-6 px-6 py-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="receipt-col space-y-6">
            <section className="receipt-box rounded-3xl border border-slate-200 bg-slate-50/70 p-5">
              <div className="receipt-section-title flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
                <GraduationCap className="h-4 w-4 text-emerald-600" />
                Élève et payeur
              </div>

              <div className="receipt-student-grid mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
                <div>
                  <span className="font-semibold text-slate-900">Élève :</span>{" "}
                  {fullName(student)}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Matricule :</span>{" "}
                  {student?.matricule || "—"}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Classe :</span>{" "}
                  {student?.class_label || currentClass?.label || "—"}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Niveau :</span>{" "}
                  {currentClass?.level || "—"}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">
                    Année scolaire :
                  </span>{" "}
                  {typedReceipt.academic_year || currentClass?.academic_year || "—"}
                </div>
                <div>
                  <span className="font-semibold text-slate-900">Payeur :</span>{" "}
                  {typedReceipt.payer_name || "—"}
                </div>
                <div className="sm:col-span-2">
                  <span className="font-semibold text-slate-900">Référence :</span>{" "}
                  {typedReceipt.reference_no || "—"}
                </div>
              </div>

              {typedReceipt.notes ? (
                <div className="receipt-note-box mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">Note :</span>{" "}
                  {typedReceipt.notes}
                </div>
              ) : null}

              {typedReceipt.receipt_status === "cancelled" &&
              typedReceipt.cancel_reason ? (
                <div className="receipt-cancel-box mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <span className="font-semibold">Motif d’annulation :</span>{" "}
                  {typedReceipt.cancel_reason}
                </div>
              ) : null}
            </section>

            <section className="receipt-box rounded-3xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-5 py-4">
                <div className="receipt-section-title flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
                  <Wallet className="h-4 w-4 text-emerald-600" />
                  Détail du paiement
                </div>
              </div>

              {lines.length === 0 ? (
                <div className="px-5 py-8 text-sm text-slate-600">
                  Aucune ligne de ventilation trouvée pour ce reçu.
                </div>
              ) : (
                <div className="receipt-table-wrap overflow-x-auto">
                  <table className="receipt-lines-table min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-600">
                      <tr>
                        <th className="px-5 py-3 font-bold">Libellé</th>
                        <th className="px-5 py-3 font-bold">Échéance</th>
                        <th className="px-5 py-3 font-bold">Montant réglé</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map(({ alloc, charge }) => (
                        <tr key={alloc.id} className="border-t border-slate-200">
                          <td className="px-5 py-4 text-slate-900">
                            {charge?.label || "Dette introuvable"}
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            {formatDate(charge?.due_date)}
                          </td>
                          <td className="px-5 py-4 font-bold text-slate-900">
                            {formatMoney(alloc.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-200 bg-slate-50">
                        <td
                          className="px-5 py-4 font-black text-slate-900"
                          colSpan={2}
                        >
                          Total ventilé
                        </td>
                        <td className="px-5 py-4 font-black text-emerald-700">
                          {formatMoney(totalAllocated)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div className="receipt-col space-y-6">
            <section className="receipt-summary-shell rounded-3xl border border-slate-200 bg-emerald-50/60 p-5">
              <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
                Synthèse
              </div>

              <div className="receipt-summary-card mt-4 rounded-3xl bg-white px-5 py-5 shadow-sm">
                <div className="receipt-amount-label text-sm text-slate-600">Montant du reçu</div>
                <div className="receipt-amount-value mt-2 text-3xl font-black text-slate-900">
                  {formatMoney(typedReceipt.total_amount)}
                </div>

                <div className="receipt-summary-grid mt-4 grid gap-3 text-sm text-slate-700">
                  <div className="flex items-center justify-between gap-3">
                    <span>Ventilation totale</span>
                    <span className="font-bold text-slate-900">
                      {formatMoney(totalAllocated)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Date d’émission</span>
                    <span className="font-bold text-slate-900">
                      {formatDateTime(typedReceipt.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>Date de paiement</span>
                    <span className="font-bold text-slate-900">
                      {formatDateTime(typedReceipt.payment_date)}
                    </span>
                  </div>
                </div>

                <div className="receipt-status-wrap mt-5">
                  {typedReceipt.receipt_status === "posted" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
                      <BadgeCheck className="h-3.5 w-3.5" />
                      Reçu validé
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
                      Reçu annulé
                    </span>
                  )}
                </div>
              </div>
            </section>

            <section className="receipt-signature-card rounded-3xl border border-slate-200 bg-white p-5">
              <div className="receipt-section-title flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
                <UserRound className="h-4 w-4 text-emerald-600" />
                Signature / cachet
              </div>

              <div className="receipt-signature-grid mt-8 grid gap-10 text-sm text-slate-700">
                <div>
                  <div className="font-semibold text-slate-900">
                    Le caissier / l’administration
                  </div>
                  <div className="receipt-signature-line mt-8 border-b border-slate-300" />
                </div>

                <div>
                  <div className="font-semibold text-slate-900">Le responsable</div>
                  <div className="receipt-signature-line mt-8 border-b border-slate-300" />
                  {institutionSettings.institution_head_title ||
                  institutionSettings.institution_head_name ? (
                    <div className="receipt-signature-name mt-2 text-slate-500">
                      {[
                        institutionSettings.institution_head_title,
                        institutionSettings.institution_head_name,
                      ]
                        .filter(Boolean)
                        .join(" — ")}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="receipt-proof-note rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
              Ce reçu constitue la preuve d’enregistrement du paiement effectué. Aucun duplicata ne pourra être émis.
              
              
            </section>
          </div>
        </div>

        <div className="receipt-footer border-t border-slate-200 px-6 py-4 text-xs text-slate-500">
          Document généré le {formatDateTime(new Date().toISOString())} —{" "}
          {schoolName}
        </div>
      </article>
    </div>
  );
}