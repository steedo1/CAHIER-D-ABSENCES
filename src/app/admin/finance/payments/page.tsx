// src/app/admin/finance/payments/page.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  BadgeCheck,
  CreditCard,
  FileText,
  PlusCircle,
  Receipt,
  UserPlus,
  UserRound,
  Wallet,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getFinanceAccessForCurrentUser } from "@/lib/finance-access";
import {
  AcademicYearSelector,
  getFinanceAcademicYearContext,
} from "../_shared/academic-year";
import {
  getAdminStudentsServer,
  type AdminStudentRow,
} from "@/lib/admin-students-server";
import PaymentsComposer from "./PaymentsComposer";
import { queueFounderFinancePaymentNotification } from "@/lib/push/founder";

export const dynamic = "force-dynamic";

export type ClassOptionRow = {
  id: string;
  label: string;
  level: string | null;
  academic_year: string | null;
};

export type FeeCategoryOptionRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_mandatory: boolean;
  is_active: boolean;
};

export type PaymentStudentRow = {
  id: string;
  full_name: string;
  matricule: string | null;
  class_id: string | null;
  class_label: string | null;
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

export type PaymentSelectionRow = {
  charge_id: string;
  student_id: string;
  student_name: string;
  matricule: string | null;
  class_id: string | null;
  class_label: string;
  level: string | null;
  academic_year: string | null;
  fee_category_id: string;
  fee_label: string;
  due_date: string | null;
  net_amount: number;
  paid_amount: number;
  balance_due: number;
};

const DEFAULT_FEE_CATEGORIES = [
  { code: "frais_inscription", name: "Frais d’inscription", description: "Frais réglés à la rentrée ou lors d’une nouvelle inscription.", is_mandatory: true },
  { code: "scolarite", name: "Scolarité", description: "Frais de scolarité annuels, par tranche ou versement libre.", is_mandatory: true },
  { code: "tenue_uniforme", name: "Tenue / uniforme", description: "Tenues, uniformes ou équipements exigés par l’établissement.", is_mandatory: false },
  { code: "transport", name: "Transport", description: "Frais de transport scolaire.", is_mandatory: false },
  { code: "cantine", name: "Cantine", description: "Frais de restauration scolaire.", is_mandatory: false },
  { code: "frais_examen", name: "Frais d’examen", description: "Frais liés aux examens, concours ou évaluations officielles.", is_mandatory: false },
  { code: "assurance", name: "Assurance", description: "Assurance scolaire.", is_mandatory: false },
  { code: "carnet_badge", name: "Carnet / badge", description: "Carnet de correspondance, badge ou support d’identification.", is_mandatory: false },
  { code: "frais_dossier", name: "Frais de dossier", description: "Ouverture ou traitement de dossier.", is_mandatory: false },
  { code: "autres_frais", name: "Autres frais", description: "Autres frais ponctuels configurables par l’administration.", is_mandatory: false },
];

function fullName(student: AdminStudentRow | undefined | null) {
  if (!student) return "Élève inconnu";
  return student.full_name || student.matricule || "Élève sans nom";
}

function formatMoney(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function normalizeNameKey(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
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

function makeMatricule() {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 90000 + 10000);
  return `MC-${stamp}-${rand}`;
}

async function getCurrentContextOrThrow() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Utilisateur non authentifié.");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!profile?.institution_id) throw new Error("Aucun établissement associé à cet utilisateur.");

  return { userId: user.id, institutionId: profile.institution_id as string };
}

async function ensureDefaultFeeCategories(institutionId: string) {
  const admin = getSupabaseServiceClient();
  const { data: existing, error } = await admin
    .schema("finance")
    .from("fee_categories")
    .select("code")
    .eq("school_id", institutionId);

  if (error) throw new Error(error.message);

  const existingCodes = new Set((existing ?? []).map((row: any) => String(row.code || "")));
  const now = new Date().toISOString();
  const inserts = DEFAULT_FEE_CATEGORIES.filter((item) => !existingCodes.has(item.code)).map((item) => ({
    school_id: institutionId,
    code: item.code,
    name: item.name,
    description: item.description,
    is_mandatory: item.is_mandatory,
    is_active: true,
    created_at: now,
    updated_at: now,
  }));

  if (inserts.length > 0) {
    const { error: insertError } = await admin.schema("finance").from("fee_categories").insert(inserts as any);
    if (insertError && !insertError.message?.toLowerCase().includes("duplicate")) {
      throw new Error(insertError.message);
    }
  }
}

async function getClassAndAcademicYear(admin: ReturnType<typeof getSupabaseServiceClient>, institutionId: string, classId: string) {
  const { data: classRow, error } = await admin
    .from("classes")
    .select("id,label,level,academic_year,institution_id")
    .eq("id", classId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!classRow) throw new Error("Classe introuvable.");

  let academicYearId: string | null = null;
  const academicYear = String((classRow as any).academic_year || "").trim() || null;

  if (academicYear) {
    const { data: yearRow, error: yearErr } = await admin
      .from("academic_years")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("code", academicYear)
      .maybeSingle();

    if (yearErr) throw new Error(yearErr.message);
    academicYearId = yearRow?.id || null;
  }

  return { classRow: classRow as any, academicYear, academicYearId };
}

async function createReceiptForCharge(params: {
  admin: ReturnType<typeof getSupabaseServiceClient>;
  institutionId: string;
  userId: string;
  studentId: string;
  chargeId: string;
  academicYearId: string | null;
  academicYear: string | null;
  amount: number;
  payerName: string | null;
  referenceNo: string | null;
  paymentDate: string | null;
  notes: string | null;
}) {
  const { admin, institutionId, userId, studentId, chargeId, academicYearId, academicYear, amount, payerName, referenceNo, paymentDate, notes } = params;
  const receiptNo = makeReceiptNo();
  const nowIso = new Date().toISOString();
  const paymentDateIso = paymentDate ? `${paymentDate}T12:00:00` : nowIso;

  const { data: receipt, error: receiptErr } = await admin
    .schema("finance")
    .from("receipts")
    .insert({
      school_id: institutionId,
      academic_year_id: academicYearId,
      academic_year: academicYear,
      student_id: studentId,
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
      created_at: nowIso,
      updated_at: nowIso,
    } as any)
    .select("id, receipt_no")
    .single();

  if (receiptErr) throw new Error(receiptErr.message);

  const { error: allocErr } = await admin
    .schema("finance")
    .from("receipt_allocations")
    .insert({ receipt_id: receipt.id, student_charge_id: chargeId, amount, created_at: nowIso } as any);

  if (allocErr) {
    await admin.schema("finance").from("receipts").delete().eq("id", receipt.id);
    throw new Error(allocErr.message);
  }

  try {
    await queueFounderFinancePaymentNotification({
      institutionId,
      amount,
      receiptNo: receipt.receipt_no,
      payerName: payerName || null,
    });
  } catch (e: any) {
    console.warn("[finance/payments] founder finance notification skipped", e?.message || e);
  }

  return receipt as { id: string; receipt_no: string };
}

async function createOrUseCharge(params: {
  admin: ReturnType<typeof getSupabaseServiceClient>;
  institutionId: string;
  userId: string;
  studentId: string;
  classId: string;
  academicYearId: string | null;
  academicYear: string | null;
  feeCategoryId: string;
  label: string;
  expectedAmount: number;
  paymentKind: string;
  notes: string | null;
  existingChargeId?: string | null;
}) {
  const { admin, institutionId, userId, studentId, classId, academicYearId, academicYear, feeCategoryId, label, expectedAmount, paymentKind, notes, existingChargeId } = params;

  if (existingChargeId) return existingChargeId;

  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  const { data: charge, error } = await admin
    .schema("finance")
    .from("student_charges")
    .insert({
      school_id: institutionId,
      academic_year_id: academicYearId,
      academic_year: academicYear,
      student_id: studentId,
      class_id: classId || null,
      fee_schedule_id: null,
      fee_category_id: feeCategoryId,
      label,
      base_amount: expectedAmount,
      due_date: null,
      charge_date: today,
      status: "pending",
      notes: [paymentKind, notes].filter(Boolean).join(" — ") || null,
      created_by: userId,
      created_at: nowIso,
      updated_at: nowIso,
    } as any)
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return String(charge.id);
}

async function createPaymentAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) redirect("/admin/finance/locked");

  const { institutionId, userId } = await getCurrentContextOrThrow();
  const admin = getSupabaseServiceClient();

  const operation = String(formData.get("operation") || "existing_payment").trim();
  const amount = Number(String(formData.get("amount") || "").trim());
  const expectedAmountRaw = Number(String(formData.get("expected_amount") || "").trim());
  const payerName = String(formData.get("payer_name") || "").trim();
  const referenceNo = String(formData.get("reference_no") || "").trim();
  const paymentDate = String(formData.get("payment_date") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  const paymentKind = String(formData.get("payment_kind") || "Versement libre").trim() || "Versement libre";
  const feeCategoryId = String(formData.get("fee_category_id") || "").trim();
  const classId = String(formData.get("class_id") || "").trim();
  let studentId = String(formData.get("student_id") || "").trim();
  let existingChargeId = String(formData.get("student_charge_id") || "").trim() || null;

  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Le montant encaissé doit être supérieur à 0.");
  if (!feeCategoryId) throw new Error("Veuillez choisir une catégorie de frais.");
  if (!classId) throw new Error("Veuillez choisir une classe.");

  const { classRow, academicYear, academicYearId } = await getClassAndAcademicYear(admin, institutionId, classId);

  if (operation === "new_enrollment_payment") {
    const firstName = String(formData.get("first_name") || "").trim();
    const lastName = String(formData.get("last_name") || "").trim();
    const matriculeInput = String(formData.get("matricule") || "").trim();
    const gender = String(formData.get("gender") || "").trim();
    const birthdate = String(formData.get("birthdate") || "").trim();
    const parentPhone = String(formData.get("parent_phone") || "").trim();

    if (!firstName || !lastName) throw new Error("Le nom et le prénom de l’élève sont obligatoires.");

    const matricule = matriculeInput || makeMatricule();
    const fullKey = normalizeNameKey(`${lastName} ${firstName}`);

    const { data: existingStudent, error: existingErr } = await admin
      .from("students")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("matricule", matricule)
      .maybeSingle();

    if (existingErr) throw new Error(existingErr.message);

    if (existingStudent?.id) {
      studentId = existingStudent.id as string;
      const { error: updateErr } = await admin
        .from("students")
        .update({ first_name: firstName, last_name: lastName, gender: gender || null, birthdate: birthdate || null, full_name_key: fullKey } as any)
        .eq("id", studentId)
        .eq("institution_id", institutionId);
      if (updateErr) throw new Error(updateErr.message);
    } else {
      const { data: created, error: createErr } = await admin
        .from("students")
        .insert({
          institution_id: institutionId,
          first_name: firstName,
          last_name: lastName,
          matricule,
          gender: gender || null,
          birthdate: birthdate || null,
          full_name_key: fullKey,
        } as any)
        .select("id")
        .single();

      if (createErr) throw new Error(createErr.message);
      studentId = String(created.id);
    }

    const today = new Date().toISOString().slice(0, 10);
    await admin
      .from("class_enrollments")
      .update({ end_date: today } as any)
      .eq("institution_id", institutionId)
      .eq("student_id", studentId)
      .neq("class_id", classId)
      .is("end_date", null);

    const { error: enrollErr } = await admin
      .from("class_enrollments")
      .upsert(
        { institution_id: institutionId, student_id: studentId, class_id: classId, start_date: today, end_date: null } as any,
        { onConflict: "class_id,student_id" },
      );
    if (enrollErr) throw new Error(enrollErr.message);

    if (parentPhone) {
      // Les bases existantes n’ont pas toutes la même table parent/tuteur ; on garde l’information dans la note du reçu.
    }

    existingChargeId = null;
  }

  if (!studentId) throw new Error("Veuillez sélectionner ou créer un élève.");

  const { data: category, error: catErr } = await admin
    .schema("finance")
    .from("fee_categories")
    .select("id,name")
    .eq("school_id", institutionId)
    .eq("id", feeCategoryId)
    .maybeSingle();

  if (catErr) throw new Error(catErr.message);
  if (!category) throw new Error("Catégorie de frais introuvable.");

  let expectedAmount = Number.isFinite(expectedAmountRaw) && expectedAmountRaw > 0 ? expectedAmountRaw : amount;
  let label = `${category.name} — ${paymentKind}`;

  if (existingChargeId) {
    const { data: charge, error: chargeErr } = await admin
      .schema("finance")
      .from("v_charge_balances")
      .select("id,student_id,class_id,academic_year_id,fee_category_id,label,net_amount,paid_amount,balance_due")
      .eq("id", existingChargeId)
      .eq("school_id", institutionId)
      .maybeSingle();

    if (chargeErr) throw new Error(chargeErr.message);
    if (!charge) throw new Error("Solde élève introuvable.");
    if (String((charge as any).student_id) !== studentId) throw new Error("Ce solde n’appartient pas à l’élève sélectionné.");

    const balanceDue = Number((charge as any).balance_due || 0);
    if (balanceDue <= 0) throw new Error("Ce solde est déjà payé.");
    if (amount > balanceDue) throw new Error(`Le montant saisi dépasse le reste dû (${formatMoney(balanceDue)}).`);

    label = String((charge as any).label || label);
    expectedAmount = Number((charge as any).net_amount || expectedAmount);
  }

  const chargeId = await createOrUseCharge({
    admin,
    institutionId,
    userId,
    studentId,
    classId,
    academicYearId,
    academicYear,
    feeCategoryId,
    label,
    expectedAmount,
    paymentKind,
    notes: [notes, operation === "new_enrollment_payment" ? "Inscription créée depuis le module encaissement" : ""].filter(Boolean).join(" — ") || null,
    existingChargeId,
  });

  const enrichedNotes = [
    paymentKind,
    notes,
    operation === "new_enrollment_payment" ? `Nouvelle inscription — classe ${classRow.label}` : null,
  ]
    .filter(Boolean)
    .join(" — ");

  const receipt = await createReceiptForCharge({
    admin,
    institutionId,
    userId,
    studentId,
    chargeId,
    academicYearId,
    academicYear,
    amount,
    payerName: payerName || null,
    referenceNo: referenceNo || paymentKind,
    paymentDate: paymentDate || null,
    notes: enrichedNotes || null,
  });

  revalidatePath("/admin/finance/payments");
  revalidatePath("/admin/finance/receipts");
  revalidatePath(`/admin/finance/receipts/${receipt.id}`);
  revalidatePath("/admin/finance");

  redirect(`/admin/finance/receipts/${receipt.id}?autoprint=1`);
}

function StatCard({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string | number; hint: string }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{label}</div>
          <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
          <div className="mt-1 text-sm text-slate-600">{hint}</div>
        </div>
        <div className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">{icon}</div>
      </div>
    </div>
  );
}

function StatusPill({ label, tone = "emerald" }: { label: string; tone?: "emerald" | "amber" | "slate" }) {
  const tones = {
    emerald: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    slate: "bg-slate-100 text-slate-700 ring-1 ring-slate-200",
  };

  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${tones[tone]}`}><BadgeCheck className="h-3.5 w-3.5" />{label}</span>;
}

export default async function FinancePaymentsPage({ searchParams }: { searchParams?: Promise<{ academic_year?: string }> }) {
  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) redirect("/admin/finance/locked");

  const params = searchParams ? await searchParams : undefined;
  const requestedAcademicYear = String(params?.academic_year || "").trim();

  const { institutionId } = await getCurrentContextOrThrow();
  await ensureDefaultFeeCategories(institutionId);

  const supabase = await getSupabaseServerClient();
  const adminStudents = await getAdminStudentsServer();
  const academicYearCtx = await getFinanceAcademicYearContext(institutionId, requestedAcademicYear);
  const { academicYears, selectedAcademicYearCode } = academicYearCtx;

  let classesQuery = supabase.from("classes").select("id,label,level,academic_year").eq("institution_id", institutionId);
  if (selectedAcademicYearCode) classesQuery = classesQuery.eq("academic_year", selectedAcademicYearCode);

  const [{ data: classes, error: clsErr }, { data: categories, error: catErr }, { data: receipts, error: recErr }] = await Promise.all([
    classesQuery.order("level", { ascending: true }).order("label", { ascending: true }),
    supabase
      .schema("finance")
      .from("fee_categories")
      .select("id,code,name,description,is_mandatory,is_active")
      .eq("school_id", institutionId)
      .eq("is_active", true)
      .order("is_mandatory", { ascending: false })
      .order("name", { ascending: true }),
    (() => {
      let query = supabase
        .schema("finance")
        .from("receipts")
        .select("id,school_id,academic_year_id,academic_year,student_id,receipt_no,receipt_status,payment_date,payer_name,reference_no,total_amount,notes,created_at")
        .eq("school_id", institutionId);
      if (selectedAcademicYearCode) query = query.eq("academic_year", selectedAcademicYearCode);
      return query.order("payment_date", { ascending: false }).limit(8);
    })(),
  ]);

  if (clsErr) throw new Error(clsErr.message);
  if (catErr) throw new Error(catErr.message);
  if (recErr) throw new Error(recErr.message);

  const classRows = (classes ?? []) as ClassOptionRow[];
  const classIds = classRows.map((row) => row.id);
  const classMap = new Map(classRows.map((c) => [c.id, c]));
  const categoryRows = (categories ?? []) as FeeCategoryOptionRow[];
  const receiptRows = (receipts ?? []) as ReceiptRow[];

  const { data: balances, error: balErr } = classIds.length > 0
    ? await supabase
        .schema("finance")
        .from("v_charge_balances")
        .select("id,school_id,academic_year_id,student_id,class_id,fee_schedule_id,fee_category_id,label,base_amount,adjustment_total,net_amount,paid_amount,balance_due,due_date,charge_date,computed_status,created_at,updated_at")
        .eq("school_id", institutionId)
        .in("class_id", classIds)
        .gt("balance_due", 0)
        .neq("computed_status", "cancelled")
        .order("due_date", { ascending: true, nullsFirst: false })
    : { data: [], error: null as any };

  if (balErr) throw new Error(balErr.message);

  const balanceRows = (balances ?? []) as ChargeBalanceRow[];
  const studentMap = new Map(adminStudents.map((s) => [s.id, s]));

  const studentRows: PaymentStudentRow[] = adminStudents
    .filter((student) => !selectedAcademicYearCode || classIds.includes(String(student.class_id || "")))
    .map((student) => ({
      id: student.id,
      full_name: fullName(student),
      matricule: student.matricule ?? null,
      class_id: student.class_id ?? null,
      class_label: student.class_label ?? null,
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name, "fr", { sensitivity: "base" }));

  const paymentSelectionRows: PaymentSelectionRow[] = balanceRows.map((row) => {
    const student = studentMap.get(row.student_id);
    const cls = row.class_id ? classMap.get(row.class_id) : student?.class_id ? classMap.get(student.class_id) : null;
    return {
      charge_id: row.id,
      student_id: row.student_id,
      student_name: fullName(student),
      matricule: student?.matricule ?? null,
      class_id: row.class_id ?? student?.class_id ?? null,
      class_label: student?.class_label || cls?.label || "Sans classe",
      level: cls?.level ?? null,
      academic_year: cls?.academic_year ?? null,
      fee_category_id: row.fee_category_id,
      fee_label: row.label,
      due_date: row.due_date,
      net_amount: Number(row.net_amount || 0),
      paid_amount: Number(row.paid_amount || 0),
      balance_due: Number(row.balance_due || 0),
    };
  });

  const totalDue = balanceRows.reduce((sum, row) => sum + Number(row.balance_due || 0), 0);
  const totalReceipts = receiptRows.filter((r) => r.receipt_status === "posted").reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const recentStudentIds = new Set(receiptRows.map((r) => r.student_id));
  const receiptStudentMap = new Map(adminStudents.filter((s) => recentStudentIds.has(s.id)).map((s) => [s.id, s]));

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-6 py-7 text-white shadow-xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
              <CreditCard className="h-3.5 w-3.5" /> Encaissement & inscriptions
            </div>
            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Caisse école privée</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Recherchez un élève existant sans afficher toute la liste, ou inscrivez directement un nouvel élève avec frais d’inscription, tranche ou paiement complet.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/10 p-4 backdrop-blur">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-100">Statut</div>
            <div className="mt-2 text-lg font-black text-white">Premium actif</div>
            <div className="mt-1 text-sm text-slate-200">Expiration : {access.expiresAt || "—"}</div>
          </div>
        </div>
      </section>

      <AcademicYearSelector academicYears={academicYears} selectedAcademicYearCode={selectedAcademicYearCode} currentPath="/admin/finance/payments" />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<UserRound className="h-5 w-5" />} label="Élèves accessibles" value={studentRows.length} hint="Recherche par classe et nom" />
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Reste à recouvrer" value={formatMoney(totalDue)} hint="Soldes ouverts" />
        <StatCard icon={<Receipt className="h-5 w-5" />} label="Reçus récents" value={receiptRows.length} hint="Derniers encaissements" />
        <StatCard icon={<FileText className="h-5 w-5" />} label="Déjà encaissé" value={formatMoney(totalReceipts)} hint="Sur les derniers reçus" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="rounded-[26px] border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-white text-emerald-700 shadow-sm"><UserPlus className="h-5 w-5" /></div>
            <div>
              <div className="font-black">Logique métier renforcée</div>
              <div className="mt-1 leading-6">La dette n’est plus forcément générée en masse. On définit le frais au moment utile, puis le reçu calcule clairement payé, total attendu et reste à payer.</div>
            </div>
          </div>
        </div>
        <Link href="/admin/finance/fees" className="inline-flex items-center justify-center gap-2 rounded-[22px] border border-slate-200 bg-white px-5 py-4 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50">
          <PlusCircle className="h-4 w-4" /> Catégories
        </Link>
      </section>

      <PaymentsComposer classes={classRows} students={studentRows} categories={categoryRows} rows={paymentSelectionRows} action={createPaymentAction} />

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700"><Receipt className="h-4 w-4 text-emerald-600" /> Reçus récents</div>
            <p className="mt-1 text-sm text-slate-500">Affichage volontairement court pour garder l’écran léger.</p>
          </div>
          <Link href="/admin/finance/receipts" className="text-sm font-bold text-emerald-700 hover:text-emerald-800">Voir tout l’historique</Link>
        </div>

        <div className="mt-5 grid gap-3">
          {receiptRows.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-600">Aucun reçu récent.</div>
          ) : (
            receiptRows.map((receipt) => {
              const student = receiptStudentMap.get(receipt.student_id);
              return (
                <Link key={receipt.id} href={`/admin/finance/receipts/${receipt.id}`} className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-slate-50/70 p-4 transition hover:border-emerald-200 hover:bg-emerald-50/50 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-black text-slate-900">{receipt.receipt_no}</span>
                      <StatusPill label={receipt.receipt_status === "posted" ? "Validé" : "Annulé"} tone={receipt.receipt_status === "posted" ? "emerald" : "slate"} />
                    </div>
                    <div className="mt-1 text-sm text-slate-600">{fullName(student)} {receipt.payer_name ? `— Payeur : ${receipt.payer_name}` : ""}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-black text-emerald-700">{formatMoney(Number(receipt.total_amount || 0))}</div>
                    <div className="text-xs font-semibold text-slate-500">{new Date(receipt.payment_date).toLocaleDateString("fr-FR")}</div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
