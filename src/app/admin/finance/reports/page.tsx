// src/app/admin/finance/reports/page.tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  CircleDollarSign,
  Layers3,
  Percent,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  getFinanceAccessForCurrentUser,
  getFinanceInstitutionIdForCurrentUser,
} from "@/lib/finance-access";
import {
  getAdminStudentsServer,
  type AdminStudentRow,
} from "@/lib/admin-students-server";
import {
  AcademicYearSelector,
  getFinanceAcademicYearContext,
} from "../_shared/academic-year";
import FinanceReportsExports, {
  type FinanceReportExportPayload,
} from "./FinanceReportsExports";

export const dynamic = "force-dynamic";

type FeeCategoryRow = {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
};

type FeeScheduleRow = {
  id: string;
  label: string;
  amount: number;
  academic_year: string | null;
  class_id: string | null;
  fee_category_id: string;
  due_date: string | null;
  allow_partial: boolean;
  is_active: boolean;
};

type ExpenseCategoryRow = {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
};

type ExpenseRow = {
  id: string;
  category_id: string | null;
  expense_status: "posted" | "cancelled";
  expense_date: string;
  label: string;
  beneficiary: string | null;
  amount: number;
};

type ClassRow = {
  id: string;
  label: string;
  level: string | null;
  academic_year: string | null;
};

type ChargeBalanceRow = {
  id: string;
  school_id: string;
  academic_year_id: string | null;
  academic_year?: string | null;
  student_id: string;
  class_id: string | null;
  fee_schedule_id: string | null;
  fee_category_id: string;
  label: string;
  base_amount: number | string;
  net_amount: number | string;
  paid_amount: number | string;
  balance_due: number | string;
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
  total_amount: number | string;
  notes: string | null;
  created_at: string;
};

type ReceiptAllocationRow = {
  id: string;
  receipt_id: string;
  student_charge_id: string;
  amount: number | string;
};

type ReceiptAllocationComponentRow = {
  id: string;
  receipt_allocation_id: string;
  receipt_id: string;
  student_charge_id: string;
  label: string;
  amount: number | string;
  receipt_status: string;
};

type PaymentRecord = {
  receiptId: string;
  allocationId: string | null;
  studentId: string;
  studentName: string;
  matricule: string;
  classId: string | null;
  classLabel: string;
  level: string;
  cycle: string;
  affectationLabel: string;
  boardingLabel: string;
  categoryName: string;
  subRubric: string;
  amount: number;
};

type PaymentGroupSummary = {
  key: string;
  label: string;
  amount: number;
  count: number;
  studentCount: number;
};

type PaymentCategorySubSummary = PaymentGroupSummary & {
  category: string;
  subRubric: string;
};

type PaymentCycleClassSummary = PaymentGroupSummary & {
  cycle: string;
  classLabel: string;
};

type DebtDetailSummary = {
  matricule: string;
  fullName: string;
  classLabel: string;
  level: string;
  category: string;
  subRubric: string;
  expected: number;
  paid: number;
  due: number;
  status: string;
  dueDate: string;
};

type InstitutionRow = {
  id: string;
  name: string | null;
};

type ReportView =
  | "overview"
  | "encaissements"
  | "categories"
  | "dettes"
  | "depenses"
  | "baremes";

type DateFilterField = "payment_date" | "created_at";

async function getCurrentInstitutionIdOrThrow() {
  return getFinanceInstitutionIdForCurrentUser();
}

function formatMoney(value: number | string) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function formatFullMoney(value: number | string) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F CFA`;
}

function formatPercent(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR", {
    maximumFractionDigits: 1,
  })} %`;
}

function toNumber(value: number | string | null | undefined) {
  return Number(value || 0);
}

function normalizeDateParam(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return "";
  return trimmed;
}

function normalizeDateRange(startDate: string, endDate: string) {
  if (startDate && endDate && startDate > endDate) {
    return { startDate: endDate, endDate: startDate };
  }
  return { startDate, endDate };
}

function ratioPercent(value: number, total: number) {
  if (!total || total <= 0) return 0;
  return (value / total) * 100;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeTextForReport(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function affectationLabelForStudent(student: { is_affecte?: boolean | null; regime?: string | null } | null | undefined) {
  if (student?.is_affecte === true) return "Affecté / réaffecté";
  if (student?.is_affecte === false) return "Non affecté";

  const regime = normalizeTextForReport(student?.regime);
  if (regime.includes("non") && regime.includes("aff")) return "Non affecté";
  if (regime.includes("reaf") || regime.includes("reaff") || regime.includes("affect")) {
    return "Affecté / réaffecté";
  }
  return "Profil à compléter";
}

function boardingLabelForStudent(student: { is_boarder?: boolean | null } | null | undefined) {
  if (student?.is_boarder === true) return "Interne";
  if (student?.is_boarder === false) return "Non interne";
  return "Profil à compléter";
}

function cycleLabelFromLevel(level: string | null | undefined) {
  const text = normalizeTextForReport(level);
  if (!text) return "Cycle à compléter";
  if (/6|5|4|3/.test(text) || text.includes("sixi") || text.includes("cinqui") || text.includes("quatri") || text.includes("troisi")) {
    return "Premier cycle";
  }
  if (text.includes("2de") || text.includes("2nde") || text.includes("seconde") || text.includes("1re") || text.includes("1ere") || text.includes("premiere") || text.includes("tle") || text.includes("term")) {
    return "Second cycle";
  }
  return "Autre cycle";
}

function groupPaymentRecords(
  records: PaymentRecord[],
  getKey: (record: PaymentRecord) => string,
  getLabel: (record: PaymentRecord) => string = getKey,
): PaymentGroupSummary[] {
  const map = new Map<string, { label: string; amount: number; count: number; students: Set<string> }>();

  for (const record of records) {
    if (record.amount <= 0) continue;
    const key = getKey(record) || "Non renseigné";
    if (!map.has(key)) {
      map.set(key, { label: getLabel(record) || key, amount: 0, count: 0, students: new Set<string>() });
    }
    const item = map.get(key)!;
    item.amount += record.amount;
    item.count += 1;
    if (record.studentId) item.students.add(record.studentId);
  }

  return Array.from(map.entries())
    .map(([key, value]) => ({
      key,
      label: value.label,
      amount: value.amount,
      count: value.count,
      studentCount: value.students.size,
    }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, "fr"));
}

function monthKey(dateValue: string) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "Sans date";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  if (key === "Sans date") return key;
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("fr-FR", {
    month: "short",
    year: "numeric",
  });
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  return date.toLocaleDateString("fr-FR");
}

function reportPeriodLabel(startDate: string, endDate: string, fallback: string) {
  if (startDate && endDate) return `Du ${formatDate(startDate)} au ${formatDate(endDate)}`;
  if (startDate) return `À partir du ${formatDate(startDate)}`;
  if (endDate) return `Jusqu’au ${formatDate(endDate)}`;
  return fallback;
}

function isoDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    startDate: isoDateOnly(start),
    endDate: isoDateOnly(end),
  };
}

const reportViews: Array<{ key: ReportView; label: string; hint: string }> = [
  { key: "overview", label: "Vue d’ensemble", hint: "Synthèse direction" },
  { key: "encaissements", label: "Encaissements", hint: "Reçus et ventilations" },
  { key: "categories", label: "Catégories", hint: "Scolarité, internat, kit…" },
  { key: "dettes", label: "Dettes / impayés", hint: "Élèves débiteurs" },
  { key: "depenses", label: "Dépenses", hint: "Sorties de caisse" },
  { key: "baremes", label: "Barèmes", hint: "Frais attendus" },
];

function normalizeReportView(value: string | null | undefined): ReportView {
  const requested = String(value || "").trim() as ReportView;
  return reportViews.some((view) => view.key === requested) ? requested : "overview";
}

function normalizeDateFilterField(value: string | null | undefined): DateFilterField {
  return value === "created_at" ? "created_at" : "payment_date";
}

function dateFieldLabel(value: DateFilterField) {
  return value === "created_at" ? "date d’enregistrement" : "date de paiement";
}

function buildReportsHref(params: {
  academicYear?: string;
  startDate?: string;
  endDate?: string;
  view?: ReportView;
  dateField?: DateFilterField;
}) {
  const sp = new URLSearchParams();
  if (params.academicYear) sp.set("academic_year", params.academicYear);
  if (params.startDate) sp.set("start_date", params.startDate);
  if (params.endDate) sp.set("end_date", params.endDate);
  if (params.view && params.view !== "overview") sp.set("view", params.view);
  if (params.dateField && params.dateField !== "payment_date") sp.set("date_field", params.dateField);
  const query = sp.toString();
  return query ? `/admin/finance/reports?${query}` : "/admin/finance/reports";
}

function balanceStatusLabel(status: ChargeBalanceRow["computed_status"]) {
  if (status === "paid") return "Soldé";
  if (status === "partial") return "Partiellement payé";
  if (status === "overdue") return "En retard";
  if (status === "pending") return "En attente";
  if (status === "cancelled") return "Annulé";
  return "Autre";
}

async function fetchAllChargeBalancesForReports({
  institutionId,
  classIds,
  academicYearId,
  academicYearStart,
  academicYearEnd,
}: {
  institutionId: string;
  classIds: string[];
  academicYearId?: string | null;
  academicYearStart?: string | null;
  academicYearEnd?: string | null;
}): Promise<ChargeBalanceRow[]> {
  const uniqueClassIds = Array.from(new Set(classIds.filter(Boolean)));
  const admin = getSupabaseServiceClient();
  const pageSize = 1000;

  const fetchPages = async (mutate: (query: any) => any) => {
    const rows: ChargeBalanceRow[] = [];

    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1;
      let query = admin
        .schema("finance")
        .from("v_charge_balances")
        .select(
          "id,school_id,academic_year_id,student_id,class_id,fee_schedule_id,fee_category_id,label,base_amount,net_amount,paid_amount,balance_due,due_date,charge_date,computed_status,created_at,updated_at",
        )
        .eq("school_id", institutionId)
        .neq("computed_status", "cancelled");

      query = mutate(query);

      const { data, error } = await query
        .order("due_date", { ascending: true, nullsFirst: false })
        .range(from, to);

      if (error) {
        throw new Error(`Lecture des balances financières impossible : ${error.message}`);
      }

      const pageRows = (data ?? []) as ChargeBalanceRow[];
      rows.push(...pageRows);

      if (pageRows.length < pageSize) break;
    }

    return rows;
  };

  const yearId = String(academicYearId || "").trim();
  if (yearId) {
    const rows = await fetchPages((query) => query.eq("academic_year_id", yearId));
    if (rows.length > 0) return rows;
  }

  if (uniqueClassIds.length > 0) {
    const rows: ChargeBalanceRow[] = [];
    for (const ids of chunkArray(uniqueClassIds, 50)) {
      rows.push(
        ...(await fetchPages((query) => {
          let q = query.in("class_id", ids);
          if (academicYearStart) q = q.gte("charge_date", academicYearStart);
          if (academicYearEnd) q = q.lte("charge_date", academicYearEnd);
          return q;
        })),
      );
    }
    return rows;
  }

  if (academicYearStart || academicYearEnd) {
    return fetchPages((query) => {
      let q = query;
      if (academicYearStart) q = q.gte("charge_date", academicYearStart);
      if (academicYearEnd) q = q.lte("charge_date", academicYearEnd);
      return q;
    });
  }

  return [];
}

async function fetchChargeBalancesByIdsForReports({
  institutionId,
  chargeIds,
}: {
  institutionId: string;
  chargeIds: string[];
}): Promise<ChargeBalanceRow[]> {
  const uniqueChargeIds = Array.from(new Set(chargeIds.filter(Boolean)));
  if (uniqueChargeIds.length === 0) return [];

  const admin = getSupabaseServiceClient();
  const rows: ChargeBalanceRow[] = [];

  for (const ids of chunkArray(uniqueChargeIds, 100)) {
    const { data, error } = await admin
      .schema("finance")
      .from("v_charge_balances")
      .select(
        "id,school_id,academic_year_id,student_id,class_id,fee_schedule_id,fee_category_id,label,base_amount,net_amount,paid_amount,balance_due,due_date,charge_date,computed_status,created_at,updated_at",
      )
      .eq("school_id", institutionId)
      .in("id", ids);

    if (error) {
      throw new Error(`Lecture des frais liés aux encaissements impossible : ${error.message}`);
    }

    rows.push(...((data ?? []) as ChargeBalanceRow[]));
  }

  return rows;
}

async function fetchReceiptAllocationsForReports({
  receiptIds,
}: {
  receiptIds: string[];
}): Promise<ReceiptAllocationRow[]> {
  const uniqueReceiptIds = Array.from(new Set(receiptIds.filter(Boolean)));
  if (uniqueReceiptIds.length === 0) return [];

  const admin = getSupabaseServiceClient();
  const rows: ReceiptAllocationRow[] = [];

  for (const ids of chunkArray(uniqueReceiptIds, 100)) {
    const { data, error } = await admin
      .schema("finance")
      .from("receipt_allocations")
      .select("id,receipt_id,student_charge_id,amount")
      .in("receipt_id", ids);

    if (error) {
      throw new Error(`Lecture des ventilations de reçus impossible : ${error.message}`);
    }

    rows.push(...((data ?? []) as ReceiptAllocationRow[]));
  }

  return rows;
}

async function fetchReceiptAllocationComponentsForReports({
  institutionId,
  allocationIds,
}: {
  institutionId: string;
  allocationIds: string[];
}): Promise<ReceiptAllocationComponentRow[]> {
  const uniqueAllocationIds = Array.from(new Set(allocationIds.filter(Boolean)));
  if (uniqueAllocationIds.length === 0) return [];

  const admin = getSupabaseServiceClient();
  const rows: ReceiptAllocationComponentRow[] = [];

  for (const ids of chunkArray(uniqueAllocationIds, 100)) {
    const { data, error } = await admin
      .schema("finance")
      .from("v_receipt_allocation_components")
      .select("id,receipt_allocation_id,receipt_id,student_charge_id,label,amount,receipt_status")
      .eq("school_id", institutionId)
      .in("receipt_allocation_id", ids);

    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("does not exist") || msg.includes("introuvable")) {
        return [];
      }
      throw new Error(`Lecture des sous-rubriques encaissées impossible : ${error.message}`);
    }

    rows.push(...((data ?? []) as ReceiptAllocationComponentRow[]));
  }

  return rows.filter((row) => row.receipt_status !== "cancelled");
}

async function fetchClassesByIdsForReports({
  institutionId,
  classIds,
}: {
  institutionId: string;
  classIds: string[];
}): Promise<ClassRow[]> {
  const uniqueClassIds = Array.from(new Set(classIds.filter(Boolean)));
  if (uniqueClassIds.length === 0) return [];

  const admin = getSupabaseServiceClient();
  const rows: ClassRow[] = [];

  for (const ids of chunkArray(uniqueClassIds, 100)) {
    const { data, error } = await admin
      .from("classes")
      .select("id,label,level,academic_year")
      .eq("institution_id", institutionId)
      .in("id", ids);

    if (error) {
      throw new Error(`Lecture des classes liées aux rapports impossible : ${error.message}`);
    }

    rows.push(...((data ?? []) as ClassRow[]));
  }

  return rows;
}

async function fetchStudentsByIdsForReports({
  institutionId,
  studentIds,
}: {
  institutionId: string;
  studentIds: string[];
}): Promise<AdminStudentRow[]> {
  const uniqueStudentIds = Array.from(new Set(studentIds.filter(Boolean)));
  if (uniqueStudentIds.length === 0) return [];

  const admin = getSupabaseServiceClient();
  const rows: AdminStudentRow[] = [];

  for (const ids of chunkArray(uniqueStudentIds, 100)) {
    const { data, error } = await admin
      .from("students")
      .select("id,first_name,last_name,full_name,matricule,gender,regime,is_affecte,is_boarder,institution_id")
      .eq("institution_id", institutionId)
      .in("id", ids);

    if (error) {
      throw new Error(`Lecture des élèves liés aux rapports impossible : ${error.message}`);
    }

    for (const raw of data ?? []) {
      const row = raw as any;
      const fullName =
        `${row.last_name ?? ""} ${row.first_name ?? ""}`.trim() ||
        String(row.full_name || "").trim() ||
        "Élève sans nom";

      rows.push({
        id: String(row.id),
        full_name: fullName,
        class_id: null,
        class_label: null,
        matricule: row.matricule ? String(row.matricule) : null,
        level: null,
        class_level: null,
        academic_year: null,
        gender: row.gender ? String(row.gender) : null,
        is_affecte: typeof row.is_affecte === "boolean" ? row.is_affecte : null,
        is_boarder: typeof row.is_boarder === "boolean" ? row.is_boarder : null,
        regime: row.regime ? String(row.regime) : null,
      });
    }
  }

  return rows;
}

function StatCard({
  icon,
  label,
  value,
  hint,
  tone = "emerald",
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  hint: string;
  tone?: "emerald" | "sky" | "amber" | "rose" | "slate";
}) {
  const toneClass = {
    emerald: "bg-emerald-50 text-emerald-700",
    sky: "bg-sky-50 text-sky-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
    slate: "bg-slate-100 text-slate-700",
  }[tone];

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
        <div className={`grid h-11 w-11 place-items-center rounded-2xl ${toneClass}`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "emerald" | "sky" | "amber" | "rose" | "slate";
}) {
  const toneClass = {
    emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    sky: "bg-sky-50 text-sky-800 ring-sky-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    rose: "bg-rose-50 text-rose-800 ring-rose-200",
    slate: "bg-slate-50 text-slate-700 ring-slate-200",
  }[tone];

  return (
    <div className={`rounded-2xl px-3 py-2 text-sm ring-1 ${toneClass}`}>
      <div className="text-[11px] font-bold uppercase tracking-[0.14em] opacity-70">
        {label}
      </div>
      <div className="mt-1 font-black">{value}</div>
    </div>
  );
}

function ProgressLine({ rate }: { rate: number }) {
  const safeRate = Math.max(0, Math.min(100, Number(rate || 0)));
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
      <div
        className="h-full rounded-full bg-emerald-600"
        style={{ width: `${safeRate}%` }}
      />
    </div>
  );
}

function MoneyGroupTable({
  title,
  icon,
  rows,
  emptyLabel,
}: {
  title: string;
  icon?: ReactNode;
  rows: PaymentGroupSummary[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
        {icon}
        {title}
      </div>

      {rows.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
          {emptyLabel}
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200">
          <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr] bg-slate-100 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-slate-600 sm:grid-cols-[1.7fr_0.7fr_0.7fr_0.8fr]">
            <div>Libellé</div>
            <div className="text-right">Montant</div>
            <div className="hidden text-right sm:block">Élèves</div>
            <div className="text-right">Lignes</div>
          </div>
          <div className="divide-y divide-slate-200">
            {rows.map((row) => (
              <div
                key={row.key}
                className="grid grid-cols-[1.4fr_0.8fr_0.8fr] items-center px-4 py-3 text-sm sm:grid-cols-[1.7fr_0.7fr_0.7fr_0.8fr]"
              >
                <div className="font-bold text-slate-800">{row.label}</div>
                <div className="text-right font-black text-emerald-700">
                  {formatMoney(row.amount)}
                </div>
                <div className="hidden text-right font-bold text-slate-700 sm:block">
                  {row.studentCount}
                </div>
                <div className="text-right font-bold text-slate-700">{row.count}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CategorySubRubricTable({ rows }: { rows: PaymentCategorySubSummary[] }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
        <Layers3 className="h-4 w-4 text-emerald-600" />
        Encaissé par catégorie et sous-rubrique
      </div>

      {rows.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
          Aucun encaissement ventilé sur la période.
        </div>
      ) : (
        <div className="mt-5 max-h-[560px] overflow-auto rounded-3xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 text-xs font-black uppercase tracking-[0.12em] text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Catégorie</th>
                <th className="px-4 py-3 text-left">Sous-rubrique</th>
                <th className="px-4 py-3 text-right">Montant encaissé</th>
                <th className="px-4 py-3 text-right">Élèves</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((row) => (
                <tr key={row.key} className="bg-white">
                  <td className="px-4 py-3 font-bold text-slate-800">{row.category}</td>
                  <td className="px-4 py-3 text-slate-700">{row.subRubric}</td>
                  <td className="px-4 py-3 text-right font-black text-emerald-700">
                    {formatMoney(row.amount)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-700">
                    {row.studentCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CycleClassPaymentTable({ rows }: { rows: PaymentCycleClassSummary[] }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
        <Users className="h-4 w-4 text-sky-600" />
        Encaissé par classe et par cycle
      </div>

      {rows.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
          Aucun encaissement de classe sur la période.
        </div>
      ) : (
        <div className="mt-5 max-h-[560px] overflow-auto rounded-3xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 text-xs font-black uppercase tracking-[0.12em] text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Cycle</th>
                <th className="px-4 py-3 text-left">Classe</th>
                <th className="px-4 py-3 text-right">Montant encaissé</th>
                <th className="px-4 py-3 text-right">Élèves</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((row) => (
                <tr key={row.key} className="bg-white">
                  <td className="px-4 py-3 font-bold text-slate-800">{row.cycle}</td>
                  <td className="px-4 py-3 text-slate-700">{row.classLabel}</td>
                  <td className="px-4 py-3 text-right font-black text-emerald-700">
                    {formatMoney(row.amount)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-700">
                    {row.studentCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StudentDebtTable({ rows }: { rows: Array<{ matricule: string; fullName: string; classLabel: string; expected: number; paid: number; due: number; status: string }> }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
        <ArrowDownRight className="h-4 w-4 text-amber-600" />
        Liste des élèves et leurs dettes par classe
      </div>

      {rows.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
          Aucun élève débiteur sur l’année sélectionnée.
        </div>
      ) : (
        <div className="mt-5 max-h-[620px] overflow-auto rounded-3xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 text-xs font-black uppercase tracking-[0.12em] text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Classe</th>
                <th className="px-4 py-3 text-left">Élève</th>
                <th className="px-4 py-3 text-right">Attendu</th>
                <th className="px-4 py-3 text-right">Payé</th>
                <th className="px-4 py-3 text-right">Dette</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((row, index) => (
                <tr key={`${row.classLabel}-${row.matricule}-${row.fullName}-${index}`} className="bg-white">
                  <td className="px-4 py-3 font-bold text-slate-800">{row.classLabel}</td>
                  <td className="px-4 py-3 text-slate-700">
                    <span className="font-bold">{row.fullName}</span>
                    <span className="block text-xs text-slate-500">Matricule : {row.matricule}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-700">{formatMoney(row.expected)}</td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-700">{formatMoney(row.paid)}</td>
                  <td className="px-4 py-3 text-right font-black text-amber-700">{formatMoney(row.due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DebtDetailTable({ rows }: { rows: DebtDetailSummary[] }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
        <Receipt className="h-4 w-4 text-amber-600" />
        Détail des dettes par élève, catégorie et classe
      </div>

      {rows.length === 0 ? (
        <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
          Aucune dette détaillée à afficher.
        </div>
      ) : (
        <div className="mt-5 max-h-[680px] overflow-auto rounded-3xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-slate-100 text-xs font-black uppercase tracking-[0.12em] text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Classe</th>
                <th className="px-4 py-3 text-left">Élève</th>
                <th className="px-4 py-3 text-left">Catégorie</th>
                <th className="px-4 py-3 text-left">Sous-rubrique</th>
                <th className="px-4 py-3 text-right">Dette</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((row, index) => (
                <tr key={`${row.classLabel}-${row.matricule}-${row.category}-${row.subRubric}-${index}`} className="bg-white">
                  <td className="px-4 py-3 font-bold text-slate-800">{row.classLabel}</td>
                  <td className="px-4 py-3 text-slate-700">
                    <span className="font-bold">{row.fullName}</span>
                    <span className="block text-xs text-slate-500">{row.matricule}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.category}</td>
                  <td className="px-4 py-3 text-slate-700">{row.subRubric}</td>
                  <td className="px-4 py-3 text-right font-black text-amber-700">{formatMoney(row.due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DateRangeSelector({
  academicYear,
  startDate,
  endDate,
  periodLabel,
  selectedView,
  dateField,
}: {
  academicYear: string;
  startDate: string;
  endDate: string;
  periodLabel: string;
  selectedView: ReportView;
  dateField: DateFilterField;
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
      <form
        method="GET"
        action="/admin/finance/reports"
        className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-sky-100">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-800">
              Période du rapport
            </div>
            <div className="mt-1 text-sm leading-6 text-slate-600">
              Par défaut, la page ouvre le mois courant. Le comptable peut changer la période et choisir si elle s’applique à la date de paiement ou à la date d’enregistrement : <strong>{periodLabel}</strong>.
            </div>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-end">
          {academicYear ? (
            <input type="hidden" name="academic_year" value={academicYear} />
          ) : null}
          <input type="hidden" name="view" value={selectedView} />
          <label className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
            Date début
            <input
              type="date"
              name="start_date"
              defaultValue={startDate}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-400"
            />
          </label>
          <label className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
            Date fin
            <input
              type="date"
              name="end_date"
              defaultValue={endDate}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-400"
            />
          </label>
          <label className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
            Type de date
            <select
              name="date_field"
              defaultValue={dateField}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-bold text-slate-800 outline-none focus:border-emerald-400"
            >
              <option value="payment_date">Date de paiement</option>
              <option value="created_at">Date d’enregistrement</option>
            </select>
          </label>
          <button className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-slate-800">
            Filtrer
          </button>
          <a
            href={buildReportsHref({ academicYear, view: selectedView, dateField })}
            className="inline-flex items-center justify-center rounded-2xl bg-slate-100 px-4 py-3 text-sm font-black text-slate-700 ring-1 ring-slate-200 hover:bg-slate-200"
          >
            Mois courant
          </a>
        </div>
      </form>
    </section>
  );
}

function ReportViewNavigation({
  academicYear,
  startDate,
  endDate,
  selectedView,
  dateField,
}: {
  academicYear: string;
  startDate: string;
  endDate: string;
  selectedView: ReportView;
  dateField: DateFilterField;
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm print:hidden">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-800">
            Ce que le comptable veut voir
          </div>
          <div className="mt-1 text-sm text-slate-600">
            Chaque onglet est une vue indépendante. L’impression et l’export concernent uniquement la vue sélectionnée.
          </div>
        </div>
        <div className="rounded-2xl bg-slate-100 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-600 ring-1 ring-slate-200">
          Filtre : {dateFieldLabel(dateField)}
        </div>
      </div>

      <nav className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {reportViews.map((view) => {
          const active = view.key === selectedView;
          return (
            <a
              key={view.key}
              href={buildReportsHref({
                academicYear,
                startDate,
                endDate,
                view: view.key,
                dateField,
              })}
              className={`rounded-2xl px-4 py-3 ring-1 transition ${
                active
                  ? "bg-slate-950 text-white ring-slate-950 shadow-sm"
                  : "bg-slate-50 text-slate-700 ring-slate-200 hover:bg-white"
              }`}
            >
              <span className="block text-sm font-black">{view.label}</span>
              <span className={`mt-1 block text-xs ${active ? "text-slate-300" : "text-slate-500"}`}>
                {view.hint}
              </span>
            </a>
          );
        })}
      </nav>
    </section>
  );
}

export default async function FinanceReportsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    academic_year?: string;
    start_date?: string;
    end_date?: string;
    view?: string;
    date_field?: string;
  }>;
}) {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const params = searchParams ? await searchParams : undefined;
  const requestedAcademicYear = String(params?.academic_year || "").trim();
  const requestedStartDate = normalizeDateParam(params?.start_date);
  const requestedEndDate = normalizeDateParam(params?.end_date);
  const selectedReportView = normalizeReportView(params?.view);
  const selectedDateField = normalizeDateFilterField(params?.date_field);

  const institutionId = await getCurrentInstitutionIdOrThrow();
  const supabase = await getSupabaseServerClient();
  const academicYearCtx = await getFinanceAcademicYearContext(
    institutionId,
    requestedAcademicYear,
  );
  const {
    academicYears,
    selectedAcademicYearId,
    selectedAcademicYearCode,
    selectedAcademicYearLabel,
    selectedAcademicYearStart,
    selectedAcademicYearEnd,
  } = academicYearCtx;

  const monthDefaultRange = currentMonthRange();
  const normalizedRange = normalizeDateRange(
    requestedStartDate || monthDefaultRange.startDate,
    requestedEndDate || monthDefaultRange.endDate,
  );
  const selectedStartDate = normalizedRange.startDate;
  const selectedEndDate = normalizedRange.endDate;
  const selectedPeriodLabel = reportPeriodLabel(
    selectedStartDate,
    selectedEndDate,
    selectedAcademicYearLabel || "Toutes les périodes",
  );

  const [
    { data: institution, error: institutionErr },
    { data: feeCategories, error: feeCatErr },
    { data: feeSchedules, error: feeSchErr },
    { data: expenseCategories, error: expCatErr },
    { data: expenses, error: expErr },
    { data: classes, error: clsErr },
    { data: receipts, error: receiptErr },
    adminStudents,
  ] = await Promise.all([
    supabase
      .from("institutions")
      .select("id,name")
      .eq("id", institutionId)
      .maybeSingle(),

    supabase
      .schema("finance")
      .from("fee_categories")
      .select("id,name,code,is_active")
      .eq("school_id", institutionId)
      .order("name", { ascending: true }),

    (() => {
      let query = supabase
        .schema("finance")
        .from("fee_schedules")
        .select(
          "id,label,amount,academic_year,class_id,fee_category_id,due_date,allow_partial,is_active",
        )
        .eq("school_id", institutionId);

      if (selectedAcademicYearCode) {
        query = query.eq("academic_year", selectedAcademicYearCode);
      }

      return query.order("created_at", { ascending: false });
    })(),

    supabase
      .schema("finance")
      .from("expense_categories")
      .select("id,name,code,is_active")
      .eq("school_id", institutionId)
      .order("name", { ascending: true }),

    (() => {
      let query = supabase
        .schema("finance")
        .from("expenses")
        .select(
          "id,category_id,expense_status,expense_date,label,beneficiary,amount",
        )
        .eq("school_id", institutionId);

      if (selectedStartDate) {
        query = query.gte("expense_date", selectedStartDate);
      }
      if (selectedEndDate) {
        query = query.lte("expense_date", selectedEndDate);
      }

      return query
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false });
    })(),

    supabase
      .from("classes")
      .select("id,label,level,academic_year")
      .eq("institution_id", institutionId)
      .order("label", { ascending: true }),

    (() => {
      let query = supabase
        .schema("finance")
        .from("receipts")
        .select(
          "id,school_id,academic_year_id,academic_year,student_id,receipt_no,receipt_status,payment_date,payer_name,reference_no,total_amount,notes,created_at",
        )
        .eq("school_id", institutionId);

      if (selectedAcademicYearCode) {
        query = query.eq("academic_year", selectedAcademicYearCode);
      }
      const filterColumn = selectedDateField === "created_at" ? "created_at" : "payment_date";
      if (selectedStartDate) {
        query = query.gte(filterColumn, `${selectedStartDate}T00:00:00`);
      }
      if (selectedEndDate) {
        query = query.lte(filterColumn, `${selectedEndDate}T23:59:59.999`);
      }

      return query
        .order(filterColumn, { ascending: false })
        .order("created_at", { ascending: false });
    })(),

    getAdminStudentsServer("all"),
  ]);

  if (institutionErr) throw new Error(institutionErr.message);
  if (feeCatErr) throw new Error(feeCatErr.message);
  if (feeSchErr) throw new Error(feeSchErr.message);
  if (expCatErr) throw new Error(expCatErr.message);
  if (expErr) throw new Error(expErr.message);
  if (clsErr) throw new Error(clsErr.message);
  if (receiptErr) throw new Error(receiptErr.message);

  const institutionRow = (institution ?? null) as InstitutionRow | null;
  const feeCategoryRows = (feeCategories ?? []) as FeeCategoryRow[];
  const feeScheduleRows = (feeSchedules ?? []) as FeeScheduleRow[];
  const expenseCategoryRows = (expenseCategories ?? []) as ExpenseCategoryRow[];
  const expenseRows = (expenses ?? []) as ExpenseRow[];
  const classRows = (classes ?? []) as ClassRow[];
  const receiptRows = (receipts ?? []) as ReceiptRow[];

  let reportClassRows = [...classRows];
  let classIds = reportClassRows.map((row) => row.id);
  let classIdSet = new Set(classIds);
  let classMap = new Map(reportClassRows.map((c) => [c.id, c]));
  const feeCategoryMap = new Map(feeCategoryRows.map((c) => [c.id, c]));
  const expenseCategoryMap = new Map(expenseCategoryRows.map((c) => [c.id, c]));

  const activeFeeCategories = feeCategoryRows.filter((r) => r.is_active).length;
  const activeSchedules = feeScheduleRows.filter((r) => r.is_active);
  const postedExpenses = expenseRows.filter(
    (r) => r.expense_status === "posted",
  );
  const postedReceipts = receiptRows.filter(
    (r) => r.receipt_status === "posted",
  );

  let balanceRows = await fetchAllChargeBalancesForReports({
    institutionId,
    classIds,
    academicYearId: selectedAcademicYearId,
    academicYearStart: selectedAcademicYearStart,
    academicYearEnd: selectedAcademicYearEnd,
  });

  const receiptIds = postedReceipts.map((row) => row.id);
  const receiptAllocations = await fetchReceiptAllocationsForReports({
    receiptIds,
  });
  const allocatedChargeRows = await fetchChargeBalancesByIdsForReports({
    institutionId,
    chargeIds: receiptAllocations.map((row) => row.student_charge_id),
  });
  const allocationComponents = await fetchReceiptAllocationComponentsForReports({
    institutionId,
    allocationIds: receiptAllocations.map((row) => row.id),
  });

  if (balanceRows.length === 0 && allocatedChargeRows.length > 0) {
    balanceRows = allocatedChargeRows;
  }

  const chargeMap = new Map<string, ChargeBalanceRow>();
  for (const row of [...balanceRows, ...allocatedChargeRows]) {
    chargeMap.set(row.id, row);
  }

  const financeClassIds = Array.from(
    new Set(
      [...balanceRows, ...allocatedChargeRows]
        .map((row) => row.class_id)
        .filter(Boolean) as string[],
    ),
  );
  const missingClassIds = financeClassIds.filter((id) => !classMap.has(id));
  if (missingClassIds.length > 0) {
    const missingClasses = await fetchClassesByIdsForReports({
      institutionId,
      classIds: missingClassIds,
    });
    reportClassRows = [...reportClassRows, ...missingClasses];
    classIds = reportClassRows.map((row) => row.id);
    classIdSet = new Set(classIds);
    classMap = new Map(reportClassRows.map((c) => [c.id, c]));
  }

  const studentIdsFromFinance = Array.from(
    new Set(
      [
        ...postedReceipts.map((row) => row.student_id),
        ...balanceRows.map((row) => row.student_id),
        ...allocatedChargeRows.map((row) => row.student_id),
      ].filter(Boolean),
    ),
  );
  const adminStudentsById = new Map(adminStudents.map((student) => [student.id, student]));
  const missingStudentIds = studentIdsFromFinance.filter((id) => !adminStudentsById.has(id));
  const directStudentRows = await fetchStudentsByIdsForReports({
    institutionId,
    studentIds: missingStudentIds,
  });

  const studentClassById = new Map<string, string>();
  for (const row of [...balanceRows, ...allocatedChargeRows]) {
    if (row.student_id && row.class_id && !studentClassById.has(row.student_id)) {
      studentClassById.set(row.student_id, row.class_id);
    }
  }

  const combinedStudentRows = [...adminStudents, ...directStudentRows];
  const studentMap = new Map<string, AdminStudentRow>();
  for (const student of combinedStudentRows) {
    const classId = student.class_id || studentClassById.get(student.id) || null;
    const cls = classId ? classMap.get(classId) : null;
    studentMap.set(student.id, {
      ...student,
      class_id: classId,
      class_label: student.class_label || cls?.label || null,
      class_level: student.class_level || cls?.level || null,
      level: student.level || cls?.level || null,
      academic_year: student.academic_year || cls?.academic_year || selectedAcademicYearCode || null,
    });
  }

  const studentRows = Array.from(studentMap.values()).filter((student) => {
    if (studentIdsFromFinance.includes(student.id)) return true;
    return student.class_id ? classIdSet.has(student.class_id) : false;
  });

  const allocationsByReceipt = new Map<string, ReceiptAllocationRow[]>();
  for (const row of receiptAllocations) {
    if (!allocationsByReceipt.has(row.receipt_id)) {
      allocationsByReceipt.set(row.receipt_id, []);
    }
    allocationsByReceipt.get(row.receipt_id)!.push(row);
  }

  const componentsByAllocation = new Map<string, ReceiptAllocationComponentRow[]>();
  for (const row of allocationComponents) {
    if (!componentsByAllocation.has(row.receipt_allocation_id)) {
      componentsByAllocation.set(row.receipt_allocation_id, []);
    }
    componentsByAllocation.get(row.receipt_allocation_id)!.push(row);
  }

  const studentsByClass = new Map<string, number>();

  for (const student of studentRows) {
    if (!student.class_id) continue;
    studentsByClass.set(
      student.class_id,
      (studentsByClass.get(student.class_id) ?? 0) + 1,
    );
  }

  const paymentRecords: PaymentRecord[] = [];
  for (const receipt of postedReceipts) {
    const allocations = allocationsByReceipt.get(receipt.id) ?? [];

    if (allocations.length === 0) {
      const student = studentMap.get(receipt.student_id);
      const cls = student?.class_id ? classMap.get(student.class_id) : null;
      const level = student?.class_level || student?.level || cls?.level || "Niveau à compléter";
      paymentRecords.push({
        receiptId: receipt.id,
        allocationId: null,
        studentId: receipt.student_id,
        studentName: student?.full_name || receipt.payer_name || "Élève non identifié",
        matricule: student?.matricule || "—",
        classId: student?.class_id || null,
        classLabel: student?.class_label || cls?.label || "Classe à compléter",
        level,
        cycle: cycleLabelFromLevel(level),
        affectationLabel: affectationLabelForStudent(student),
        boardingLabel: boardingLabelForStudent(student),
        categoryName: "Non ventilé",
        subRubric: receipt.reference_no || "Reçu global",
        amount: toNumber(receipt.total_amount),
      });
      continue;
    }

    for (const allocation of allocations) {
      const charge = chargeMap.get(allocation.student_charge_id);
      const student = studentMap.get(charge?.student_id || receipt.student_id);
      const cls = charge?.class_id
        ? classMap.get(charge.class_id)
        : student?.class_id
          ? classMap.get(student.class_id)
          : null;
      const level = student?.class_level || student?.level || cls?.level || "Niveau à compléter";
      const category = charge?.fee_category_id
        ? feeCategoryMap.get(charge.fee_category_id)
        : null;
      const components = (componentsByAllocation.get(allocation.id) ?? []).filter(
        (component) => toNumber(component.amount) > 0,
      );
      const baseRecord = {
        receiptId: receipt.id,
        allocationId: allocation.id,
        studentId: student?.id || receipt.student_id,
        studentName: student?.full_name || receipt.payer_name || "Élève non identifié",
        matricule: student?.matricule || "—",
        classId: charge?.class_id || student?.class_id || null,
        classLabel: student?.class_label || cls?.label || "Classe à compléter",
        level,
        cycle: cycleLabelFromLevel(level),
        affectationLabel: affectationLabelForStudent(student),
        boardingLabel: boardingLabelForStudent(student),
        categoryName: category?.name || "Sans catégorie",
      };

      if (components.length > 0) {
        for (const component of components) {
          paymentRecords.push({
            ...baseRecord,
            subRubric: component.label || charge?.label || "Sous-rubrique à compléter",
            amount: toNumber(component.amount),
          });
        }
      } else {
        paymentRecords.push({
          ...baseRecord,
          subRubric: charge?.label || "Sous-rubrique à compléter",
          amount: toNumber(allocation.amount),
        });
      }
    }
  }

  const totalScheduledAmount = activeSchedules.reduce(
    (sum, row) => sum + toNumber(row.amount),
    0,
  );

  const totalExpectedAmount = balanceRows.reduce(
    (sum, row) => sum + toNumber(row.net_amount),
    0,
  );
  const totalPaidFromBalances = balanceRows.reduce(
    (sum, row) => sum + toNumber(row.paid_amount),
    0,
  );
  const totalBalanceDue = balanceRows.reduce(
    (sum, row) => sum + Math.max(0, toNumber(row.balance_due)),
    0,
  );
  const totalReceiptsAmount = postedReceipts.reduce(
    (sum, row) => sum + toNumber(row.total_amount),
    0,
  );
  const totalExpensesAmount = postedExpenses.reduce(
    (sum, row) => sum + toNumber(row.amount),
    0,
  );
  const netBalance = totalReceiptsAmount - totalExpensesAmount;
  const recoveryRate = ratioPercent(totalPaidFromBalances, totalExpectedAmount);
  const expenseRatio = ratioPercent(totalExpensesAmount, totalReceiptsAmount);

  const balancesByStudent = new Map<string, ChargeBalanceRow[]>();
  for (const row of balanceRows) {
    if (!balancesByStudent.has(row.student_id)) {
      balancesByStudent.set(row.student_id, []);
    }
    balancesByStudent.get(row.student_id)!.push(row);
  }

  const studentsWithDebt = studentRows.filter((student) => {
    const items = balancesByStudent.get(student.id) ?? [];
    return items.some((item) => toNumber(item.balance_due) > 0);
  }).length;

  const studentsPaidUp = studentRows.filter((student) => {
    const items = balancesByStudent.get(student.id) ?? [];
    const expected = items.reduce((sum, row) => sum + toNumber(row.net_amount), 0);
    const due = items.reduce((sum, row) => sum + toNumber(row.balance_due), 0);
    return expected > 0 && due <= 0;
  }).length;

  const studentFinancialSummary = studentRows
    .map((student) => {
      const items = balancesByStudent.get(student.id) ?? [];
      const expected = items.reduce((sum, row) => sum + toNumber(row.net_amount), 0);
      const paid = items.reduce((sum, row) => sum + toNumber(row.paid_amount), 0);
      const due = items.reduce(
        (sum, row) => sum + Math.max(0, toNumber(row.balance_due)),
        0,
      );
      const overdue = items.some((row) => row.computed_status === "overdue");
      const partial = items.some((row) => row.computed_status === "partial");
      const status =
        expected <= 0
          ? "Sans frais"
          : due <= 0
            ? "Soldé"
            : overdue
              ? "En retard"
              : partial
                ? "Partiel"
                : "À payer";

      return {
        matricule: student.matricule || "—",
        fullName: student.full_name || "Élève sans nom",
        classLabel: student.class_label || classMap.get(String(student.class_id || ""))?.label || "—",
        level: student.class_level || student.level || classMap.get(String(student.class_id || ""))?.level || "—",
        expected,
        paid,
        due,
        rate: ratioPercent(paid, expected),
        status,
      };
    })
    .filter((row) => row.expected > 0 || row.due > 0)
    .sort((a, b) => b.due - a.due || a.fullName.localeCompare(b.fullName));

  const balanceStatusSummary = ["paid", "partial", "pending", "overdue"].map((status) => {
    const items = balanceRows.filter((row) => row.computed_status === status);
    return {
      label: balanceStatusLabel(status as ChargeBalanceRow["computed_status"]),
      count: items.length,
      amount: items.reduce(
        (sum, row) =>
          sum +
          (status === "paid"
            ? toNumber(row.net_amount)
            : Math.max(0, toNumber(row.balance_due))),
        0,
      ),
    };
  }).filter((row) => row.count > 0 || row.amount > 0);

  const feePerformanceByCategory = feeCategoryRows
    .map((cat) => {
      const items = balanceRows.filter((row) => row.fee_category_id === cat.id);
      const expected = items.reduce((sum, row) => sum + toNumber(row.net_amount), 0);
      const paid = items.reduce((sum, row) => sum + toNumber(row.paid_amount), 0);
      const due = items.reduce(
        (sum, row) => sum + Math.max(0, toNumber(row.balance_due)),
        0,
      );
      return {
        id: cat.id,
        name: cat.name,
        count: items.length,
        expected,
        paid,
        due,
        rate: ratioPercent(paid, expected),
      };
    })
    .filter((x) => x.count > 0 || x.expected > 0)
    .sort((a, b) => b.due - a.due || b.expected - a.expected);

  const schedulesByCategory = feeCategoryRows
    .map((cat) => {
      const items = activeSchedules.filter((s) => s.fee_category_id === cat.id);
      const total = items.reduce((sum, s) => sum + toNumber(s.amount), 0);
      return {
        id: cat.id,
        name: cat.name,
        count: items.length,
        total,
      };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.total - a.total);

  const expensesByCategory = expenseCategoryRows
    .map((cat) => {
      const items = postedExpenses.filter((e) => e.category_id === cat.id);
      const total = items.reduce((sum, e) => sum + toNumber(e.amount), 0);
      return {
        id: cat.id,
        name: cat.name,
        count: items.length,
        total,
      };
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.total - a.total);

  const classSummary = reportClassRows
    .map((cls) => {
      const items = balanceRows.filter((row) => row.class_id === cls.id);
      const expected = items.reduce((sum, row) => sum + toNumber(row.net_amount), 0);
      const paid = items.reduce((sum, row) => sum + toNumber(row.paid_amount), 0);
      const due = items.reduce(
        (sum, row) => sum + Math.max(0, toNumber(row.balance_due)),
        0,
      );
      const students = studentsByClass.get(cls.id) ?? 0;
      return {
        classId: cls.id,
        classLabel: cls.label || "Classe sans nom",
        level: cls.level || "—",
        academicYear: cls.academic_year || selectedAcademicYearCode || "—",
        students,
        expected,
        paid,
        due,
        rate: ratioPercent(paid, expected),
      };
    })
    .filter((row) => row.students > 0 || row.expected > 0)
    .sort((a, b) => b.due - a.due || b.expected - a.expected);

  const paymentByAffectation = groupPaymentRecords(
    paymentRecords,
    (record) => record.affectationLabel,
  );
  const paymentByBoarding = groupPaymentRecords(
    paymentRecords,
    (record) => record.boardingLabel,
  );
  const paymentByLevel = groupPaymentRecords(
    paymentRecords,
    (record) => record.level || "Niveau à compléter",
  );

  const paymentByCategorySubRubric = groupPaymentRecords(
    paymentRecords,
    (record) => `${record.categoryName}|||${record.subRubric}`,
    (record) => `${record.categoryName} — ${record.subRubric}`,
  ).map((row) => {
    const [category, subRubric] = row.key.split("|||");
    return {
      ...row,
      category: category || "Sans catégorie",
      subRubric: subRubric || "Sous-rubrique à compléter",
    };
  }) as PaymentCategorySubSummary[];

  const paymentByCycleClass = groupPaymentRecords(
    paymentRecords,
    (record) => `${record.cycle}|||${record.classLabel}`,
    (record) => `${record.cycle} — ${record.classLabel}`,
  ).map((row) => {
    const [cycle, classLabel] = row.key.split("|||");
    return {
      ...row,
      cycle: cycle || "Cycle à compléter",
      classLabel: classLabel || "Classe à compléter",
    };
  }) as PaymentCycleClassSummary[];

  const hasInternatData =
    studentRows.some((student) => student.is_boarder === true) ||
    feeCategoryRows.some((category) => normalizeTextForReport(category.name).includes("internat")) ||
    balanceRows.some((row) => normalizeTextForReport(row.label).includes("internat"));

  const studentDebtByClass = studentFinancialSummary
    .filter((row) => row.due > 0)
    .sort(
      (a, b) =>
        a.classLabel.localeCompare(b.classLabel, "fr", { numeric: true }) ||
        a.fullName.localeCompare(b.fullName, "fr"),
    );

  const debtDetailsByStudentCategory = balanceRows
    .filter((row) => Math.max(0, toNumber(row.balance_due)) > 0)
    .map((row): DebtDetailSummary => {
      const student = studentMap.get(row.student_id);
      const cls = row.class_id ? classMap.get(row.class_id) : null;
      const category = feeCategoryMap.get(row.fee_category_id);
      const level = student?.class_level || student?.level || cls?.level || "—";

      return {
        matricule: student?.matricule || "—",
        fullName: student?.full_name || "Élève sans nom",
        classLabel: student?.class_label || cls?.label || "Classe à compléter",
        level,
        category: category?.name || "Sans catégorie",
        subRubric: row.label || "Sous-rubrique à compléter",
        expected: toNumber(row.net_amount),
        paid: toNumber(row.paid_amount),
        due: Math.max(0, toNumber(row.balance_due)),
        status: balanceStatusLabel(row.computed_status),
        dueDate: row.due_date ? formatDate(row.due_date) : "—",
      };
    })
    .sort(
      (a, b) =>
        a.classLabel.localeCompare(b.classLabel, "fr", { numeric: true }) ||
        a.fullName.localeCompare(b.fullName, "fr") ||
        a.category.localeCompare(b.category, "fr"),
    );

  const monthlyMap = new Map<
    string,
    { month: string; receipts: number; expenses: number; balance: number }
  >();

  for (const receipt of postedReceipts) {
    const key = monthKey(selectedDateField === "created_at" ? receipt.created_at : receipt.payment_date);
    if (!monthlyMap.has(key)) {
      monthlyMap.set(key, { month: monthLabel(key), receipts: 0, expenses: 0, balance: 0 });
    }
    const row = monthlyMap.get(key)!;
    row.receipts += toNumber(receipt.total_amount);
    row.balance = row.receipts - row.expenses;
  }

  for (const expense of postedExpenses) {
    const key = monthKey(expense.expense_date);
    if (!monthlyMap.has(key)) {
      monthlyMap.set(key, { month: monthLabel(key), receipts: 0, expenses: 0, balance: 0 });
    }
    const row = monthlyMap.get(key)!;
    row.expenses += toNumber(expense.amount);
    row.balance = row.receipts - row.expenses;
  }

  const monthlySummary = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value);


  const schedulesForExport = activeSchedules
    .map((row) => {
      const cat = feeCategoryMap.get(row.fee_category_id);
      const cls = row.class_id ? classMap.get(row.class_id) : null;
      return {
        label: row.label || "Barème sans libellé",
        category: cat?.name || "Sans catégorie",
        classLabel: cls?.label || "Toutes les classes",
        dueDate: row.due_date ? formatDate(row.due_date) : "—",
        amount: toNumber(row.amount),
        active: row.is_active ? "Actif" : "Inactif",
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.classLabel.localeCompare(b.classLabel));

  const exportPayload: FinanceReportExportPayload = {
    title: `Rapport financier — ${reportViews.find((view) => view.key === selectedReportView)?.label || "Vue"}`,
    institutionName: institutionRow?.name || "Établissement",
    academicYear: selectedAcademicYearLabel || selectedAcademicYearCode || "Année courante",
    periodLabel: selectedPeriodLabel,
    periodStart: selectedStartDate,
    periodEnd: selectedEndDate,
    generatedAt: new Date().toISOString(),
    summary: [
      {
        label: "Élèves suivis",
        value: String(studentRows.length),
        hint: `${classRows.length} classe${classRows.length > 1 ? "s" : ""}`,
      },
      {
        label: "Montant attendu",
        value: formatFullMoney(totalExpectedAmount),
        hint: `${balanceRows.length} ligne${balanceRows.length > 1 ? "s" : ""} de frais`,
      },
      {
        label: "Total encaissé",
        value: formatFullMoney(totalReceiptsAmount),
        hint: `${postedReceipts.length} reçu${postedReceipts.length > 1 ? "s" : ""} validé${postedReceipts.length > 1 ? "s" : ""}`,
      },
      {
        label: "Reste à recouvrer",
        value: formatFullMoney(totalBalanceDue),
        hint: `${studentsWithDebt} élève${studentsWithDebt > 1 ? "s" : ""} avec solde`,
      },
      {
        label: "Taux de recouvrement",
        value: formatPercent(recoveryRate),
        hint: `${studentsPaidUp} élève${studentsPaidUp > 1 ? "s" : ""} soldé${studentsPaidUp > 1 ? "s" : ""}`,
      },
      {
        label: "Dépenses",
        value: formatFullMoney(totalExpensesAmount),
        hint: `${postedExpenses.length} dépense${postedExpenses.length > 1 ? "s" : ""} validée${postedExpenses.length > 1 ? "s" : ""}`,
      },
      {
        label: "Solde net",
        value: formatFullMoney(netBalance),
        hint: "Encaissements moins dépenses",
      },
      {
        label: "Ratio dépenses",
        value: formatPercent(expenseRatio),
        hint: "Dépenses / encaissements",
      },
    ],
    categories: feePerformanceByCategory.map((row) => ({
      name: row.name,
      count: row.count,
      expected: row.expected,
      paid: row.paid,
      due: row.due,
      rate: row.rate,
    })),
    expenseCategories: expensesByCategory.map((row) => ({
      name: row.name,
      count: row.count,
      total: row.total,
    })),
    classes: classSummary.map((row) => ({
      classLabel: row.classLabel,
      level: row.level,
      academicYear: row.academicYear,
      students: row.students,
      expected: row.expected,
      paid: row.paid,
      due: row.due,
      rate: row.rate,
    })),
    statuses: balanceStatusSummary,
    students: studentFinancialSummary.map((row) => ({
      matricule: row.matricule,
      fullName: row.fullName,
      classLabel: row.classLabel,
      expected: row.expected,
      paid: row.paid,
      due: row.due,
      rate: row.rate,
      status: row.status,
    })),
    paymentByAffectation: paymentByAffectation.map((row) => ({
      label: row.label,
      amount: row.amount,
      count: row.count,
      studentCount: row.studentCount,
    })),
    paymentByBoarding: paymentByBoarding.map((row) => ({
      label: row.label,
      amount: row.amount,
      count: row.count,
      studentCount: row.studentCount,
    })),
    paymentByCategorySubRubric: paymentByCategorySubRubric.map((row) => ({
      category: row.category,
      subRubric: row.subRubric,
      amount: row.amount,
      count: row.count,
      studentCount: row.studentCount,
    })),
    paymentByLevel: paymentByLevel.map((row) => ({
      label: row.label,
      amount: row.amount,
      count: row.count,
      studentCount: row.studentCount,
    })),
    paymentByCycleClass: paymentByCycleClass.map((row) => ({
      cycle: row.cycle,
      classLabel: row.classLabel,
      amount: row.amount,
      count: row.count,
      studentCount: row.studentCount,
    })),
    studentDebtsByClass: studentDebtByClass.map((row) => ({
      matricule: row.matricule,
      fullName: row.fullName,
      classLabel: row.classLabel,
      expected: row.expected,
      paid: row.paid,
      due: row.due,
      status: row.status,
    })),
    debtDetails: debtDetailsByStudentCategory.map((row) => ({
      matricule: row.matricule,
      fullName: row.fullName,
      classLabel: row.classLabel,
      level: row.level,
      category: row.category,
      subRubric: row.subRubric,
      expected: row.expected,
      paid: row.paid,
      due: row.due,
      status: row.status,
      dueDate: row.dueDate,
    })),
    schedules: schedulesForExport,
    months: monthlySummary,
    receipts: postedReceipts.map((row) => ({
      date: formatDate(selectedDateField === "created_at" ? row.created_at : row.payment_date),
      label: `${row.receipt_no}${row.payer_name ? ` — ${row.payer_name}` : ""}`,
      category: row.reference_no || "Encaissement validé",
      amount: toNumber(row.total_amount),
    })),
    expenses: postedExpenses.map((row) => {
      const cat = row.category_id ? expenseCategoryMap.get(row.category_id) : null;
      return {
        date: formatDate(row.expense_date),
        label: row.label,
        category: `${cat?.name || "Sans catégorie"}${row.beneficiary ? ` — ${row.beneficiary}` : ""}`,
        amount: toNumber(row.amount),
      };
    }),
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
              <BarChart3 className="h-3.5 w-3.5" />
              Gestion financière premium
            </div>

            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              Rapports financiers
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Rapport centré sur les vrais indicateurs : encaissements par statut,
              internat, catégorie, sous-rubrique, niveau, classe et dettes détaillées.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">
              Période
            </div>
            <div className="mt-2 text-lg font-black text-white">
              {selectedPeriodLabel}
            </div>
            <div className="mt-1 text-sm text-slate-200">
              Année : {selectedAcademicYearLabel || selectedAcademicYearCode || "—"}
            </div>
          </div>
        </div>
      </section>

      <AcademicYearSelector
        academicYears={academicYears}
        selectedAcademicYearCode={selectedAcademicYearCode}
        currentPath="/admin/finance/reports"
        hiddenParams={{
          start_date: selectedStartDate || undefined,
          end_date: selectedEndDate || undefined,
          view: selectedReportView !== "overview" ? selectedReportView : undefined,
          date_field: selectedDateField !== "payment_date" ? selectedDateField : undefined,
        }}
      />

      <DateRangeSelector
        academicYear={selectedAcademicYearCode}
        startDate={selectedStartDate}
        endDate={selectedEndDate}
        periodLabel={selectedPeriodLabel}
        selectedView={selectedReportView}
        dateField={selectedDateField}
      />

      <ReportViewNavigation
        academicYear={selectedAcademicYearCode}
        startDate={selectedStartDate}
        endDate={selectedEndDate}
        selectedView={selectedReportView}
        dateField={selectedDateField}
      />

      <FinanceReportsExports payload={exportPayload} view={selectedReportView} />

      {selectedReportView === "overview" ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={<Users className="h-5 w-5" />}
              label="Élèves suivis"
              value={studentRows.length}
              hint={`${classRows.length} classe${classRows.length > 1 ? "s" : ""} dans l’année`}
              tone="sky"
            />
            <StatCard
              icon={<CircleDollarSign className="h-5 w-5" />}
              label="Montant attendu"
              value={formatMoney(totalExpectedAmount)}
              hint={`${balanceRows.length} ligne${balanceRows.length > 1 ? "s" : ""} de frais`}
              tone="emerald"
            />
            <StatCard
              icon={<Receipt className="h-5 w-5" />}
              label="Total encaissé"
              value={formatMoney(totalReceiptsAmount)}
              hint={`${postedReceipts.length} reçu${postedReceipts.length > 1 ? "s" : ""} validé${postedReceipts.length > 1 ? "s" : ""}`}
              tone="emerald"
            />
            <StatCard
              icon={<ArrowDownRight className="h-5 w-5" />}
              label="Reste à recouvrer"
              value={formatMoney(totalBalanceDue)}
              hint={`${studentsWithDebt} élève${studentsWithDebt > 1 ? "s" : ""} avec solde`}
              tone="amber"
            />
            <StatCard
              icon={<Percent className="h-5 w-5" />}
              label="Taux recouvrement"
              value={formatPercent(recoveryRate)}
              hint={`${studentsPaidUp} élève${studentsPaidUp > 1 ? "s" : ""} soldé${studentsPaidUp > 1 ? "s" : ""}`}
              tone="sky"
            />
            <StatCard
              icon={<Wallet className="h-5 w-5" />}
              label="Dépenses"
              value={formatMoney(totalExpensesAmount)}
              hint={`${postedExpenses.length} dépense${postedExpenses.length > 1 ? "s" : ""} validée${postedExpenses.length > 1 ? "s" : ""}`}
              tone="rose"
            />
            <StatCard
              icon={<ArrowUpRight className="h-5 w-5" />}
              label="Solde net"
              value={formatMoney(netBalance)}
              hint="Encaissements moins dépenses"
              tone={netBalance >= 0 ? "emerald" : "rose"}
            />
            <StatCard
              icon={<TrendingUp className="h-5 w-5" />}
              label="Ratio dépenses"
              value={formatPercent(expenseRatio)}
              hint="Dépenses / encaissements"
              tone="slate"
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
                <Layers3 className="h-4 w-4 text-emerald-600" />
                Recouvrement par catégorie de frais
              </div>

              {feePerformanceByCategory.length === 0 ? (
                <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
                  Aucune balance financière disponible pour le moment.
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  {feePerformanceByCategory.map((row) => (
                    <article key={row.id} className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h2 className="text-lg font-black text-slate-900">{row.name}</h2>
                          <div className="mt-1 text-sm text-slate-600">
                            {row.count} écriture{row.count > 1 ? "s" : ""} • Taux {formatPercent(row.rate)}
                          </div>
                        </div>
                        <div className="rounded-full bg-amber-50 px-3 py-1.5 text-sm font-bold text-amber-800 ring-1 ring-amber-200">
                          Reste {formatMoney(row.due)}
                        </div>
                      </div>
                      <ProgressLine rate={row.rate} />
                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        <MiniMetric label="Attendu" value={formatMoney(row.expected)} tone="slate" />
                        <MiniMetric label="Encaissé" value={formatMoney(row.paid)} tone="emerald" />
                        <MiniMetric label="Reste" value={formatMoney(row.due)} tone="amber" />
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
                <CalendarClock className="h-4 w-4 text-emerald-600" />
                Flux de la période
              </div>

              {monthlySummary.length === 0 ? (
                <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
                  Aucun flux financier enregistré sur la période.
                </div>
              ) : (
                <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200">
                  <div className="grid grid-cols-4 bg-slate-100 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-slate-600">
                    <div>Mois</div>
                    <div className="text-right">Encaissements</div>
                    <div className="text-right">Dépenses</div>
                    <div className="text-right">Solde</div>
                  </div>
                  <div className="divide-y divide-slate-200">
                    {monthlySummary.map((row) => (
                      <div key={row.month} className="grid grid-cols-4 items-center px-4 py-3 text-sm">
                        <div className="font-bold text-slate-800">{row.month}</div>
                        <div className="text-right font-bold text-emerald-700">{formatMoney(row.receipts)}</div>
                        <div className="text-right font-bold text-rose-700">{formatMoney(row.expenses)}</div>
                        <div className={`text-right font-black ${row.balance >= 0 ? "text-slate-900" : "text-rose-700"}`}>
                          {formatMoney(row.balance)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">
              Recouvrement par classe
            </div>

            {classSummary.length === 0 ? (
              <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
                Aucune synthèse disponible.
              </div>
            ) : (
              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                {classSummary.map((row) => (
                  <article key={row.classId} className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h2 className="text-lg font-black text-slate-900">{row.classLabel}</h2>
                        <div className="mt-1 text-sm text-slate-600">
                          {row.level} • {row.academicYear} • {row.students} élève{row.students > 1 ? "s" : ""}
                        </div>
                      </div>
                      <div className="rounded-full bg-sky-50 px-3 py-1.5 text-sm font-bold text-sky-700 ring-1 ring-sky-200">
                        Taux {formatPercent(row.rate)}
                      </div>
                    </div>
                    <ProgressLine rate={row.rate} />
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      <MiniMetric label="Attendu" value={formatMoney(row.expected)} tone="slate" />
                      <MiniMetric label="Encaissé" value={formatMoney(row.paid)} tone="emerald" />
                      <MiniMetric label="Reste" value={formatMoney(row.due)} tone="amber" />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      {selectedReportView === "encaissements" ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={<Receipt className="h-5 w-5" />} label="Total encaissé" value={formatMoney(totalReceiptsAmount)} hint={`${postedReceipts.length} reçu${postedReceipts.length > 1 ? "s" : ""} sur la période`} tone="emerald" />
            <StatCard icon={<CalendarClock className="h-5 w-5" />} label="Filtre utilisé" value={dateFieldLabel(selectedDateField)} hint={selectedPeriodLabel} tone="sky" />
            <StatCard icon={<Users className="h-5 w-5" />} label="Élèves concernés" value={new Set(paymentRecords.map((row) => row.studentId).filter(Boolean)).size} hint="Selon les ventilations de reçus" tone="slate" />
            <StatCard icon={<Layers3 className="h-5 w-5" />} label="Lignes ventilées" value={paymentRecords.length} hint="Catégories et sous-rubriques" tone="emerald" />
          </section>

          <section className={`grid gap-6 ${hasInternatData ? "xl:grid-cols-2" : ""}`}>
            <MoneyGroupTable title="Encaissé : affectés / non affectés" icon={<Users className="h-4 w-4 text-sky-600" />} rows={paymentByAffectation} emptyLabel="Aucun encaissement par statut d’affectation sur la période." />
            {hasInternatData ? (
              <MoneyGroupTable title="Encaissé : internes / non internes" icon={<Wallet className="h-4 w-4 text-emerald-600" />} rows={paymentByBoarding} emptyLabel="Aucun encaissement lié au statut d’internat sur la période." />
            ) : null}
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <CategorySubRubricTable rows={paymentByCategorySubRubric} />
            <MoneyGroupTable title="Encaissé par niveau" icon={<BarChart3 className="h-4 w-4 text-emerald-600" />} rows={paymentByLevel} emptyLabel="Aucun encaissement par niveau sur la période." />
          </section>

          <CycleClassPaymentTable rows={paymentByCycleClass} />

          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">Encaissements validés sur la période</div>
            {postedReceipts.length === 0 ? (
              <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">Aucun encaissement sur la période sélectionnée.</div>
            ) : (
              <div className="mt-5 space-y-4">
                {postedReceipts.map((row) => (
                  <article key={row.id} className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="text-lg font-black text-slate-900">{row.receipt_no}</h2>
                        <div className="mt-1 text-sm text-slate-600">
                          Paiement : {formatDate(row.payment_date)} • Enregistrement : {formatDate(row.created_at)}{row.payer_name ? ` • ${row.payer_name}` : ""}{row.reference_no ? ` • Réf. ${row.reference_no}` : ""}
                        </div>
                      </div>
                      <div className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 ring-1 ring-emerald-200">{formatMoney(row.total_amount)}</div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      {selectedReportView === "categories" ? (
        <>
          <section className="grid gap-6 xl:grid-cols-2">
            <CategorySubRubricTable rows={paymentByCategorySubRubric} />
            <MoneyGroupTable title="Encaissé par niveau" icon={<BarChart3 className="h-4 w-4 text-emerald-600" />} rows={paymentByLevel} emptyLabel="Aucun encaissement par niveau sur la période." />
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
              <Layers3 className="h-4 w-4 text-emerald-600" />
              Recouvrement annuel par catégorie de frais
            </div>
            {feePerformanceByCategory.length === 0 ? (
              <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">Aucune catégorie disponible.</div>
            ) : (
              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                {feePerformanceByCategory.map((row) => (
                  <article key={row.id} className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h2 className="text-lg font-black text-slate-900">{row.name}</h2>
                        <div className="mt-1 text-sm text-slate-600">{row.count} écriture{row.count > 1 ? "s" : ""} • Taux {formatPercent(row.rate)}</div>
                      </div>
                      <div className="rounded-full bg-amber-50 px-3 py-1.5 text-sm font-bold text-amber-800 ring-1 ring-amber-200">Reste {formatMoney(row.due)}</div>
                    </div>
                    <ProgressLine rate={row.rate} />
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      <MiniMetric label="Attendu" value={formatMoney(row.expected)} tone="slate" />
                      <MiniMetric label="Encaissé" value={formatMoney(row.paid)} tone="emerald" />
                      <MiniMetric label="Reste" value={formatMoney(row.due)} tone="amber" />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}

      {selectedReportView === "dettes" ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={<CircleDollarSign className="h-5 w-5" />} label="Montant attendu" value={formatMoney(totalExpectedAmount)} hint={`${balanceRows.length} lignes de frais`} tone="slate" />
            <StatCard icon={<Receipt className="h-5 w-5" />} label="Déjà payé" value={formatMoney(totalPaidFromBalances)} hint="Selon les dettes de l’année" tone="emerald" />
            <StatCard icon={<ArrowDownRight className="h-5 w-5" />} label="Reste à recouvrer" value={formatMoney(totalBalanceDue)} hint={`${studentsWithDebt} élève${studentsWithDebt > 1 ? "s" : ""} débiteur${studentsWithDebt > 1 ? "s" : ""}`} tone="amber" />
            <StatCard icon={<Percent className="h-5 w-5" />} label="Taux recouvrement" value={formatPercent(recoveryRate)} hint="Payé / attendu" tone="sky" />
          </section>
          <StudentDebtTable rows={studentDebtByClass} />
          <DebtDetailTable rows={debtDetailsByStudentCategory} />
        </>
      ) : null}

      {selectedReportView === "depenses" ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={<Wallet className="h-5 w-5" />} label="Dépenses" value={formatMoney(totalExpensesAmount)} hint={`${postedExpenses.length} dépense${postedExpenses.length > 1 ? "s" : ""} validée${postedExpenses.length > 1 ? "s" : ""}`} tone="rose" />
            <StatCard icon={<Receipt className="h-5 w-5" />} label="Encaissements" value={formatMoney(totalReceiptsAmount)} hint="Sur la même période" tone="emerald" />
            <StatCard icon={<ArrowUpRight className="h-5 w-5" />} label="Solde net" value={formatMoney(netBalance)} hint="Encaissements - dépenses" tone={netBalance >= 0 ? "emerald" : "rose"} />
            <StatCard icon={<TrendingUp className="h-5 w-5" />} label="Ratio dépenses" value={formatPercent(expenseRatio)} hint="Dépenses / encaissements" tone="slate" />
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700"><Wallet className="h-4 w-4 text-rose-600" />Dépenses par catégorie</div>
              {expensesByCategory.length === 0 ? (
                <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">Aucune dépense sur la période.</div>
              ) : (
                <div className="mt-5 space-y-4">
                  {expensesByCategory.map((row) => (
                    <article key={row.id} className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div><h2 className="text-lg font-black text-slate-900">{row.name}</h2><div className="mt-1 text-sm text-slate-600">{row.count} dépense{row.count > 1 ? "s" : ""}</div></div>
                        <div className="rounded-full bg-rose-50 px-3 py-1.5 text-sm font-bold text-rose-700 ring-1 ring-rose-200">{formatMoney(row.total)}</div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-black uppercase tracking-[0.16em] text-slate-700">Dépenses validées sur la période</div>
              {postedExpenses.length === 0 ? (
                <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">Aucune dépense récente.</div>
              ) : (
                <div className="mt-5 space-y-4">
                  {postedExpenses.map((row) => {
                    const cat = row.category_id ? expenseCategoryMap.get(row.category_id) : null;
                    return (
                      <article key={row.id} className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div><h2 className="text-lg font-black text-slate-900">{row.label}</h2><div className="mt-1 text-sm text-slate-600">{formatDate(row.expense_date)} • {cat?.name || "Sans catégorie"}{row.beneficiary ? ` • ${row.beneficiary}` : ""}</div></div>
                          <div className="rounded-full bg-rose-50 px-3 py-1.5 text-sm font-bold text-rose-700 ring-1 ring-rose-200">{formatMoney(row.amount)}</div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}

      {selectedReportView === "baremes" ? (
        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <Layers3 className="h-4 w-4 text-emerald-600" />
            Barèmes configurés par catégorie
          </div>

          {schedulesByCategory.length === 0 ? (
            <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">Aucun barème actif pour le moment.</div>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {schedulesByCategory.map((row) => (
                <article key={row.id} className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4">
                  <h2 className="text-lg font-black text-slate-900">{row.name}</h2>
                  <div className="mt-1 text-sm text-slate-600">{row.count} barème{row.count > 1 ? "s" : ""}</div>
                  <div className="mt-3 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700 ring-1 ring-emerald-200">{formatMoney(row.total)}</div>
                </article>
              ))}
            </div>
          )}

          <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Barèmes actifs : <strong>{activeSchedules.length}</strong> • Catégories de frais actives : <strong>{activeFeeCategories}</strong> • Montant barémé : <strong>{formatMoney(totalScheduledAmount)}</strong>
          </div>
        </section>
      ) : null}
    </div>
  );
}
