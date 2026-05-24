// src/app/admin/finance/payments/page.tsx
import Link from "next/link";
import type { ReactNode } from "react";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  CalendarClock,
  CreditCard,
  FileText,
  ListChecks,
  Printer,
  Receipt,
  Settings2,
  UserPlus,
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

type ClassRow = {
  id: string;
  label: string;
  level: string | null;
  academic_year: string | null;
};

export type FeeCategoryRow = {
  id: string;
  school_id: string;
  code: string;
  name: string;
  description: string | null;
  is_mandatory: boolean;
  is_active: boolean;
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
};

type FeeScheduleComponentRow = {
  id: string;
  school_id: string;
  fee_schedule_id: string;
  component_code: string | null;
  label: string;
  amount: number | string;
  order_index: number | null;
  is_active: boolean;
};

type PaidComponentRow = {
  student_charge_id: string;
  fee_schedule_component_id: string;
  receipt_status: string | null;
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
  adjustment_total?: number | string;
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

export type ChargeOptionRow = {
  charge_id: string;
  fee_category_id: string;
  fee_schedule_id: string | null;
  label: string;
  due_date: string | null;
  net_amount: number;
  paid_amount: number;
  balance_due: number;
  components: Array<{
    id: string;
    label: string;
    amount: number;
    order_index: number;
  }>;
};

export type PaymentStudentRow = {
  student_id: string;
  student_name: string;
  matricule: string | null;
  class_id: string;
  class_label: string;
  level: string | null;
  academic_year: string | null;
  total_due: number;
  total_paid: number;
  open_charges: ChargeOptionRow[];
};

const DEFAULT_FEE_CATEGORIES = [
  {
    code: "frais_inscription",
    name: "Frais d’inscription",
    is_mandatory: true,
  },
  { code: "scolarite", name: "Scolarité", is_mandatory: true },
  { code: "tenue_uniforme", name: "Tenue / uniforme", is_mandatory: false },
  { code: "transport", name: "Transport", is_mandatory: false },
  { code: "cantine", name: "Cantine", is_mandatory: false },
  { code: "frais_examen", name: "Frais d’examen", is_mandatory: false },
  { code: "assurance", name: "Assurance", is_mandatory: false },
  { code: "carnet_badge", name: "Carnet / badge", is_mandatory: false },
  { code: "frais_dossier", name: "Frais de dossier", is_mandatory: false },
  { code: "autres_frais", name: "Autres frais", is_mandatory: false },
];

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  cash: "Espèces",
  mobile_money: "Mobile Money",
  bank_deposit: "Versement bancaire",
  bank_transfer: "Virement bancaire",
  cheque: "Chèque",
  card: "Carte bancaire",
  other: "Autre",
  // Compatibilité avec les anciens libellés conservés dans certains formulaires.
  registration: "Frais d’inscription",
  installment_1: "1ère tranche",
  installment_2: "2e tranche",
  installment_3: "3e tranche",
  full: "Paiement complet",
  free: "Versement libre",
};

function fullName(student: AdminStudentRow | undefined | null) {
  if (!student) return "Élève inconnu";
  return student.full_name || student.matricule || "Élève sans nom";
}

function formatMoney(value: number | string) {
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

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function paymentTypeLabel(value: string) {
  return PAYMENT_TYPE_LABELS[value] || "Versement";
}

function buildPaymentLabel(categoryName: string, paymentType: string) {
  const typeLabel = paymentTypeLabel(paymentType);
  if (categoryName.toLowerCase().includes(typeLabel.toLowerCase())) {
    return categoryName;
  }
  return `${categoryName} — ${typeLabel}`;
}

function sortByName<T extends { student_name: string }>(rows: T[]) {
  return rows.sort((a, b) =>
    a.student_name.localeCompare(b.student_name, "fr", {
      numeric: true,
      sensitivity: "base",
    }),
  );
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

async function getAcademicYearId(
  admin: ReturnType<typeof getSupabaseServiceClient>,
  institutionId: string,
  academicYear: string | null | undefined,
) {
  if (!academicYear) return null;

  const { data, error } = await admin
    .from("academic_years")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("code", academicYear)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.id || null;
}

async function ensureDefaultFeeCategories(institutionId: string) {
  const admin = getSupabaseServiceClient();

  const { data: existing, error } = await admin
    .schema("finance")
    .from("fee_categories")
    .select("id,code")
    .eq("school_id", institutionId);

  if (error) throw new Error(error.message);

  const existingCodes = new Set(
    ((existing ?? []) as Array<{ code: string | null }>).map((row) => row.code),
  );

  const missing = DEFAULT_FEE_CATEGORIES.filter(
    (item) => !existingCodes.has(item.code),
  );

  if (missing.length === 0) return;

  const now = new Date().toISOString();
  const { error: insertErr } = await admin
    .schema("finance")
    .from("fee_categories")
    .insert(
      missing.map((item) => ({
        school_id: institutionId,
        code: item.code,
        name: item.name,
        description: null,
        is_mandatory: item.is_mandatory,
        is_active: true,
        created_at: now,
        updated_at: now,
      })) as any[],
    );

  if (insertErr && !insertErr.message?.toLowerCase().includes("duplicate")) {
    throw new Error(insertErr.message);
  }
}

async function fetchChargeById(
  chargeId: string,
  institutionId: string,
): Promise<ChargeBalanceRow | null> {
  if (!chargeId) return null;

  const admin = getSupabaseServiceClient();
  const { data, error } = await admin
    .schema("finance")
    .from("v_charge_balances")
    .select(
      "id,school_id,academic_year_id,student_id,class_id,fee_schedule_id,fee_category_id,label,base_amount,net_amount,paid_amount,balance_due,due_date,charge_date,computed_status,created_at,updated_at",
    )
    .eq("id", chargeId)
    .eq("school_id", institutionId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as ChargeBalanceRow | null) ?? null;
}

async function fetchOpenChargesForStudent(
  institutionId: string,
  studentId: string,
  classId: string,
): Promise<ChargeBalanceRow[]> {
  const admin = getSupabaseServiceClient();
  const { data, error } = await admin
    .schema("finance")
    .from("v_charge_balances")
    .select(
      "id,school_id,academic_year_id,student_id,class_id,fee_schedule_id,fee_category_id,label,base_amount,net_amount,paid_amount,balance_due,due_date,charge_date,computed_status,created_at,updated_at",
    )
    .eq("school_id", institutionId)
    .eq("student_id", studentId)
    .eq("class_id", classId)
    .neq("computed_status", "cancelled")
    .gt("balance_due", 0)
    .order("due_date", { ascending: true, nullsFirst: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as ChargeBalanceRow[];
}

async function ensureChargesForStudent(
  institutionId: string,
  userId: string,
  studentId: string,
  classId: string,
) {
  const admin = getSupabaseServiceClient();

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
      "id,school_id,academic_year,class_id,fee_category_id,label,amount,due_date,allow_partial,is_active,notes",
    )
    .eq("school_id", institutionId)
    .eq("class_id", classId)
    .eq("is_active", true);

  if (schErr) throw new Error(schErr.message);

  const scheduleRows = (schedules ?? []) as FeeScheduleRow[];
  if (scheduleRows.length === 0) {
    return [];
  }

  const scheduleIds = scheduleRows.map((row) => row.id);
  const { data: existingCharges, error: exErr } = await admin
    .schema("finance")
    .from("student_charges")
    .select("id,student_id,fee_schedule_id")
    .eq("school_id", institutionId)
    .eq("student_id", studentId)
    .eq("class_id", classId)
    .in("fee_schedule_id", scheduleIds);

  if (exErr) throw new Error(exErr.message);

  const existingSet = new Set(
    ((existingCharges ?? []) as Array<{ fee_schedule_id: string | null }>).map(
      (row) => row.fee_schedule_id || "",
    ),
  );

  const academicYear = (classRow as any).academic_year || null;
  const academicYearId = await getAcademicYearId(
    admin,
    institutionId,
    academicYear,
  );
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  const inserts = scheduleRows
    .filter((schedule) => !existingSet.has(schedule.id))
    .map((schedule) => ({
      school_id: institutionId,
      academic_year_id: academicYearId,
      academic_year: schedule.academic_year || academicYear || null,
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
        `Situation créée automatiquement depuis ${schedule.label}`,
      created_by: userId,
      created_at: nowIso,
      updated_at: nowIso,
    }));

  if (inserts.length > 0) {
    const { error: insErr } = await admin
      .schema("finance")
      .from("student_charges")
      .insert(inserts as any[]);

    if (insErr) throw new Error(insErr.message);
  }

  return fetchOpenChargesForStudent(institutionId, studentId, classId);
}

async function createManualCharge({
  institutionId,
  userId,
  studentId,
  classId,
  feeCategoryId,
  label,
  amount,
  notes,
}: {
  institutionId: string;
  userId: string;
  studentId: string;
  classId: string;
  feeCategoryId: string;
  label: string;
  amount: number;
  notes: string | null;
}) {
  const admin = getSupabaseServiceClient();

  const { data: classRow, error: classErr } = await admin
    .from("classes")
    .select("id,label,academic_year,institution_id")
    .eq("id", classId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (classErr) throw new Error(classErr.message);
  if (!classRow) throw new Error("Classe introuvable.");

  const academicYear = (classRow as any).academic_year || null;
  const academicYearId = await getAcademicYearId(
    admin,
    institutionId,
    academicYear,
  );
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  const { data: inserted, error } = await admin
    .schema("finance")
    .from("student_charges")
    .insert({
      school_id: institutionId,
      academic_year_id: academicYearId,
      academic_year: academicYear,
      student_id: studentId,
      class_id: classId,
      fee_schedule_id: null,
      fee_category_id: feeCategoryId,
      label,
      base_amount: amount,
      due_date: null,
      charge_date: today,
      status: "pending",
      notes,
      created_by: userId,
      created_at: nowIso,
      updated_at: nowIso,
    } as any)
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  const charge = await fetchChargeById(inserted.id, institutionId);
  if (!charge) throw new Error("Impossible de relire la situation créée.");
  return charge;
}

async function createStudentAndEnroll({
  institutionId,
  classId,
  firstName,
  lastName,
  matricule,
}: {
  institutionId: string;
  classId: string;
  firstName: string;
  lastName: string;
  matricule: string | null;
}) {
  const admin = getSupabaseServiceClient();

  const { data: classRow, error: classErr } = await admin
    .from("classes")
    .select("id,institution_id,academic_year,label")
    .eq("id", classId)
    .maybeSingle();

  if (classErr) throw new Error(classErr.message);
  if (!classRow || (classRow as any).institution_id !== institutionId) {
    throw new Error("Classe introuvable pour cet établissement.");
  }

  if (matricule) {
    const { data: duplicate, error: dupErr } = await admin
      .from("students")
      .select("id")
      .eq("institution_id", institutionId)
      .eq("matricule", matricule)
      .maybeSingle();

    if (dupErr) throw new Error(dupErr.message);
    if (duplicate) {
      throw new Error(
        "Ce matricule existe déjà. Recherchez plutôt l’élève existant.",
      );
    }
  }

  const { data: created, error: createErr } = await admin
    .from("students")
    .insert({
      institution_id: institutionId,
      first_name: firstName || null,
      last_name: lastName || null,
      matricule: matricule || null,
    } as any)
    .select("id,first_name,last_name,matricule")
    .maybeSingle();

  if (createErr) throw new Error(createErr.message);
  if (!created?.id) throw new Error("Impossible de créer l’élève.");

  const today = new Date().toISOString().slice(0, 10);

  const { error: enrollErr } = await admin.from("class_enrollments").upsert(
    [
      {
        class_id: classId,
        student_id: created.id,
        institution_id: institutionId,
        start_date: today,
        end_date: null,
      },
    ],
    {
      onConflict: "class_id,student_id",
      ignoreDuplicates: true,
    },
  );

  if (enrollErr) throw new Error(enrollErr.message);

  return created.id as string;
}

async function resolveChargeForPayment({
  institutionId,
  userId,
  studentId,
  classId,
  selectedChargeId,
  feeCategoryId,
  feeCategoryName,
  paymentType,
  amount,
  expectedAmount,
  notes,
}: {
  institutionId: string;
  userId: string;
  studentId: string;
  classId: string;
  selectedChargeId: string | null;
  feeCategoryId: string;
  feeCategoryName: string;
  paymentType: string;
  amount: number;
  expectedAmount: number | null;
  notes: string | null;
}) {
  if (selectedChargeId) {
    const selected = await fetchChargeById(selectedChargeId, institutionId);
    if (!selected) throw new Error("Frais sélectionné introuvable.");
    if (selected.student_id !== studentId) {
      throw new Error("Le frais sélectionné ne correspond pas à cet élève.");
    }
    const balanceDue = Number(selected.balance_due || 0);
    if (balanceDue <= 0) throw new Error("Ce frais est déjà soldé.");
    if (amount > balanceDue) {
      throw new Error(
        `Le montant saisi dépasse le reste dû (${formatMoney(balanceDue)}).`,
      );
    }
    return selected;
  }

  const openCharges = await ensureChargesForStudent(
    institutionId,
    userId,
    studentId,
    classId,
  );

  const categoryCharges = openCharges.filter(
    (charge) => charge.fee_category_id === feeCategoryId,
  );

  // La catégorie est choisie avant le frais ouvert. Si aucun frais précis n'est
  // transmis, on utilise le premier frais ouvert de la catégorie au lieu de
  // chercher par libellé de mode de paiement.
  const fallback = categoryCharges[0] || null;

  if (fallback) {
    const balanceDue = Number(fallback.balance_due || 0);
    if (amount <= balanceDue) return fallback;
  }

  const manualBaseAmount = Math.max(Number(expectedAmount || 0), amount);
  return createManualCharge({
    institutionId,
    userId,
    studentId,
    classId,
    feeCategoryId,
    label: buildPaymentLabel(feeCategoryName, paymentType),
    amount: manualBaseAmount,
    notes,
  });
}

async function fetchActiveScheduleComponents(
  institutionId: string,
  scheduleIds: string[],
): Promise<FeeScheduleComponentRow[]> {
  if (scheduleIds.length === 0) return [];

  const admin = getSupabaseServiceClient();
  const { data, error } = await admin
    .schema("finance")
    .from("fee_schedule_components")
    .select(
      "id,school_id,fee_schedule_id,component_code,label,amount,order_index,is_active",
    )
    .eq("school_id", institutionId)
    .in("fee_schedule_id", scheduleIds)
    .eq("is_active", true)
    .order("order_index", { ascending: true })
    .order("label", { ascending: true });

  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (msg.includes("does not exist") || msg.includes("introuvable"))
      return [];
    throw new Error(error.message);
  }
  return (data ?? []) as FeeScheduleComponentRow[];
}

async function fetchPaidComponentsForCharges(
  institutionId: string,
  chargeIds: string[],
): Promise<PaidComponentRow[]> {
  if (chargeIds.length === 0) return [];

  const admin = getSupabaseServiceClient();
  const { data, error } = await admin
    .schema("finance")
    .from("v_receipt_allocation_components")
    .select("student_charge_id,fee_schedule_component_id,receipt_status")
    .eq("school_id", institutionId)
    .in("student_charge_id", chargeIds);

  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (msg.includes("does not exist") || msg.includes("introuvable"))
      return [];
    throw new Error(error.message);
  }
  return (data ?? []) as PaidComponentRow[];
}

async function resolveSelectedComponentsForPayment({
  institutionId,
  charge,
  componentIds,
  amount,
}: {
  institutionId: string;
  charge: ChargeBalanceRow;
  componentIds: string[];
  amount: number;
}): Promise<FeeScheduleComponentRow[]> {
  const ids = Array.from(new Set(componentIds.filter(Boolean)));
  if (ids.length === 0) return [];

  if (!charge.fee_schedule_id) {
    throw new Error("Ce frais n’est pas lié à un barème détaillable.");
  }

  const admin = getSupabaseServiceClient();

  const { data: components, error: compErr } = await admin
    .schema("finance")
    .from("fee_schedule_components")
    .select(
      "id,school_id,fee_schedule_id,component_code,label,amount,order_index,is_active",
    )
    .eq("school_id", institutionId)
    .eq("fee_schedule_id", charge.fee_schedule_id)
    .in("id", ids)
    .eq("is_active", true);

  if (compErr) throw new Error(compErr.message);

  const rows = (components ?? []) as FeeScheduleComponentRow[];
  if (rows.length !== ids.length) {
    throw new Error(
      "Une sous-rubrique sélectionnée est introuvable ou inactive.",
    );
  }

  const { data: alreadyPaid, error: paidErr } = await admin
    .schema("finance")
    .from("v_receipt_allocation_components")
    .select("student_charge_id,fee_schedule_component_id,receipt_status")
    .eq("school_id", institutionId)
    .eq("student_charge_id", charge.id)
    .in("fee_schedule_component_id", ids);

  if (paidErr) throw new Error(paidErr.message);

  const paidRows = ((alreadyPaid ?? []) as PaidComponentRow[]).filter(
    (row) => row.receipt_status !== "cancelled",
  );
  if (paidRows.length > 0) {
    throw new Error(
      "Une sous-rubrique sélectionnée a déjà été encaissée sur ce frais.",
    );
  }

  const selectedTotal = rows.reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0,
  );
  if (Math.abs(selectedTotal - amount) > 0.01) {
    throw new Error(
      `Le montant encaissé (${formatMoney(amount)}) doit correspondre au total des sous-rubriques cochées (${formatMoney(selectedTotal)}).`,
    );
  }

  return rows.sort(
    (a, b) => Number(a.order_index || 0) - Number(b.order_index || 0),
  );
}

async function createPaymentAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const { institutionId, userId } = await getCurrentContextOrThrow();
  await ensureDefaultFeeCategories(institutionId);

  const admin = getSupabaseServiceClient();
  const mode = normalize(formData.get("mode")) || "existing";
  const selectedChargeId = normalize(formData.get("student_charge_id")) || null;
  const selectedStudentId = normalize(formData.get("student_id"));
  const classId = normalize(formData.get("class_id"));
  const feeCategoryId = normalize(formData.get("fee_category_id"));
  const paymentType = normalize(formData.get("payment_type")) || "cash";
  const amountRaw = normalize(formData.get("amount"));
  const expectedAmountRaw = normalize(formData.get("expected_amount"));
  const payerName = normalize(formData.get("payer_name"));
  const referenceNo = normalize(formData.get("reference_no"));
  const componentIds = formData
    .getAll("component_ids")
    .map((value) => normalize(value))
    .filter(Boolean);
  const paymentDate = normalize(formData.get("payment_date"));
  const notes = normalize(formData.get("notes"));
  const parentPhone = normalize(formData.get("parent_phone"));

  if (!classId) throw new Error("Veuillez choisir une classe.");
  if (!feeCategoryId)
    throw new Error("Veuillez choisir une catégorie de frais.");

  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Le montant encaissé doit être supérieur à 0.");
  }

  const expectedAmount = expectedAmountRaw ? Number(expectedAmountRaw) : null;
  if (
    expectedAmountRaw &&
    (!Number.isFinite(expectedAmount) || Number(expectedAmount) <= 0)
  ) {
    throw new Error(
      "Le montant attendu doit être supérieur à 0 ou rester vide.",
    );
  }

  const { data: feeCategory, error: catErr } = await admin
    .schema("finance")
    .from("fee_categories")
    .select("id,name,school_id,is_active")
    .eq("id", feeCategoryId)
    .eq("school_id", institutionId)
    .maybeSingle();

  if (catErr) throw new Error(catErr.message);
  if (!feeCategory) throw new Error("Catégorie de frais introuvable.");

  let studentId = selectedStudentId;
  const extraNotes: string[] = [
    `Mode d’encaissement : ${paymentTypeLabel(paymentType)}`,
  ];

  if (mode === "new") {
    const lastName = normalize(formData.get("last_name"));
    const firstName = normalize(formData.get("first_name"));
    const matricule = normalize(formData.get("matricule")) || null;

    if (!lastName) throw new Error("Le nom de l’élève est obligatoire.");
    if (!firstName) throw new Error("Le prénom de l’élève est obligatoire.");

    studentId = await createStudentAndEnroll({
      institutionId,
      classId,
      firstName,
      lastName,
      matricule,
    });

    extraNotes.push("Nouvelle inscription depuis le module Finance");
    extraNotes.push("Dossier élève à compléter si nécessaire");
    if (parentPhone) extraNotes.push(`Contact parent/tuteur : ${parentPhone}`);
  }

  if (!studentId) {
    throw new Error("Veuillez choisir ou créer un élève.");
  }

  const charge = await resolveChargeForPayment({
    institutionId,
    userId,
    studentId,
    classId,
    selectedChargeId,
    feeCategoryId,
    feeCategoryName: String((feeCategory as any).name || "Frais scolaire"),
    paymentType,
    amount,
    expectedAmount,
    notes: [notes, ...extraNotes].filter(Boolean).join("\n") || null,
  });

  const balanceDue = Number(charge.balance_due || 0);
  if (balanceDue <= 0) throw new Error("Ce frais est déjà soldé.");
  if (amount > balanceDue) {
    throw new Error(
      `Le montant saisi dépasse le reste dû (${formatMoney(balanceDue)}).`,
    );
  }

  const selectedComponents = await resolveSelectedComponentsForPayment({
    institutionId,
    charge,
    componentIds,
    amount,
  });

  let academicYear: string | null = null;
  let academicYearId: string | null = charge.academic_year_id || null;

  const { data: cls, error: clsErr } = await admin
    .from("classes")
    .select("id,label,academic_year,institution_id")
    .eq("id", classId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (clsErr) throw new Error(clsErr.message);
  academicYear = (cls as any)?.academic_year ?? null;
  const className = normalize((cls as any)?.label) || "Classe non précisée";

  if (!academicYearId && academicYear) {
    academicYearId = await getAcademicYearId(
      admin,
      institutionId,
      academicYear,
    );
  }

  const receiptNo = makeReceiptNo();
  const paymentDateIso = paymentDate
    ? `${paymentDate}T12:00:00`
    : new Date().toISOString();
  const receiptNotes =
    [notes, ...extraNotes].filter(Boolean).join("\n") || null;

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
      notes: receiptNotes,
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

  const { data: allocation, error: allocErr } = await admin
    .schema("finance")
    .from("receipt_allocations")
    .insert({
      receipt_id: receipt.id,
      student_charge_id: charge.id,
      amount,
      created_at: new Date().toISOString(),
    } as any)
    .select("id")
    .single();

  if (allocErr) {
    await admin
      .schema("finance")
      .from("receipts")
      .delete()
      .eq("id", receipt.id);
    throw new Error(allocErr.message);
  }

  if (selectedComponents.length > 0) {
    const nowIso = new Date().toISOString();
    const { error: compAllocErr } = await admin
      .schema("finance")
      .from("receipt_allocation_components")
      .insert(
        selectedComponents.map((component) => ({
          receipt_allocation_id: allocation.id,
          fee_schedule_component_id: component.id,
          label: component.label,
          amount: Number(component.amount || 0),
          order_index: Number(component.order_index || 0),
          created_at: nowIso,
        })) as any[],
      );

    if (compAllocErr) {
      await admin
        .schema("finance")
        .from("receipts")
        .delete()
        .eq("id", receipt.id);
      throw new Error(compAllocErr.message);
    }
  }

  const remainingDueAfterPayment = Math.max(balanceDue - amount, 0);

  let studentNameForNotification = payerName || "";
  try {
    const { data: studentForNotif, error: studentNotifErr } = await admin
      .from("students")
      .select("first_name,last_name,matricule")
      .eq("id", studentId)
      .eq("institution_id", institutionId)
      .maybeSingle();

    if (!studentNotifErr && studentForNotif) {
      const firstName = normalize((studentForNotif as any).first_name);
      const lastName = normalize((studentForNotif as any).last_name);
      const matricule = normalize((studentForNotif as any).matricule);
      studentNameForNotification =
        [firstName, lastName].filter(Boolean).join(" ") ||
        payerName ||
        matricule ||
        "Élève non précisé";
    }
  } catch (e: any) {
    console.warn(
      "[finance/payments] student notification lookup skipped",
      e?.message || e,
    );
  }

  try {
    await queueFounderFinancePaymentNotification({
      institutionId,
      amount,
      receiptNo: receipt.receipt_no,
      payerName: payerName || null,
      studentName: studentNameForNotification || null,
      className,
      categoryName: String(
        (feeCategory as any).name || charge.label || "Frais scolaire",
      ),
      remainingDue: remainingDueAfterPayment,
      paidAt: paymentDateIso,
    });
  } catch (e: any) {
    console.warn(
      "[finance/payments] founder finance notification skipped",
      e?.message || e,
    );
  }

  revalidatePath("/admin/finance/payments");
  revalidatePath("/admin/finance/receipts");
  revalidatePath(`/admin/finance/receipts/${receipt.id}`);
  revalidatePath("/admin/finance/charges");
  revalidatePath("/admin/finance/arrears");
  revalidatePath("/admin/finance");

  redirect(`/admin/finance/receipts/${receipt.id}?autoprint=1`);
}

async function fetchAllChargeBalancesForPayments({
  institutionId,
  studentIds,
}: {
  institutionId: string;
  studentIds: string[];
}): Promise<ChargeBalanceRow[]> {
  if (studentIds.length === 0) return [];

  const admin = getSupabaseServiceClient();
  const pageSize = 1000;
  const rows: ChargeBalanceRow[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await admin
      .schema("finance")
      .from("v_charge_balances")
      .select(
        "id,school_id,academic_year_id,student_id,class_id,fee_schedule_id,fee_category_id,label,base_amount,net_amount,paid_amount,balance_due,due_date,charge_date,computed_status,created_at,updated_at",
      )
      .eq("school_id", institutionId)
      .in("student_id", studentIds)
      .neq("computed_status", "cancelled")
      .order("due_date", { ascending: true, nullsFirst: false })
      .range(from, to);

    if (error) throw new Error(error.message);

    const pageRows = (data ?? []) as ChargeBalanceRow[];
    rows.push(...pageRows);

    if (pageRows.length < pageSize) break;
  }

  return rows;
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
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

function StatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
      {label}
    </span>
  );
}

export default async function FinancePaymentsPage({
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
  await ensureDefaultFeeCategories(institutionId);

  const admin = getSupabaseServiceClient();
  const adminStudents = await getAdminStudentsServer();
  const academicYearCtx = await getFinanceAcademicYearContext(
    institutionId,
    requestedAcademicYear,
  );
  const { academicYears, selectedAcademicYearCode } = academicYearCtx;

  let classesQuery = admin
    .from("classes")
    .select("id,label,level,academic_year")
    .eq("institution_id", institutionId);

  if (selectedAcademicYearCode) {
    classesQuery = classesQuery.eq("academic_year", selectedAcademicYearCode);
  }

  const [
    { data: classes, error: clsErr },
    { data: categories, error: catErr },
  ] = await Promise.all([
    classesQuery
      .order("level", { ascending: true })
      .order("label", { ascending: true }),
    admin
      .schema("finance")
      .from("fee_categories")
      .select("id,school_id,code,name,description,is_mandatory,is_active")
      .eq("school_id", institutionId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  if (clsErr) throw new Error(clsErr.message);
  if (catErr) throw new Error(catErr.message);

  const classRows = (classes ?? []) as ClassRow[];
  const feeCategoryRows = (categories ?? []) as FeeCategoryRow[];
  const classIds = classRows.map((row) => row.id);
  const classMap = new Map(classRows.map((c) => [c.id, c]));
  const classIdSet = new Set(classIds);

  const studentRows = adminStudents.filter((student) =>
    student.class_id ? classIdSet.has(student.class_id) : false,
  );
  const studentIds = studentRows.map((student) => student.id);

  const [{ data: balances, error: balErr }, { data: receipts, error: recErr }] =
    await Promise.all([
      studentIds.length > 0
        ? fetchAllChargeBalancesForPayments({ institutionId, studentIds })
            .then((data) => ({ data, error: null }))
            .catch((error) => ({ data: [], error }))
        : Promise.resolve({ data: [], error: null } as any),

      (() => {
        let query = admin
          .schema("finance")
          .from("receipts")
          .select(
            "id,school_id,academic_year_id,academic_year,student_id,receipt_no,receipt_status,payment_date,payer_name,reference_no,total_amount,notes,created_at",
          )
          .eq("school_id", institutionId);

        if (selectedAcademicYearCode) {
          query = query.eq("academic_year", selectedAcademicYearCode);
        }

        return query.order("payment_date", { ascending: false }).limit(8);
      })(),
    ]);

  if (balErr) throw new Error(balErr.message);
  if (recErr) throw new Error(recErr.message);

  const balanceRows = (balances ?? []) as ChargeBalanceRow[];
  const receiptRows = (receipts ?? []) as ReceiptRow[];

  const balanceChargeIds = Array.from(
    new Set(balanceRows.map((row) => row.id)),
  );
  const balanceScheduleIds = Array.from(
    new Set(
      balanceRows
        .map((row) => row.fee_schedule_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const [componentRows, paidComponentRows] = await Promise.all([
    fetchActiveScheduleComponents(institutionId, balanceScheduleIds),
    fetchPaidComponentsForCharges(institutionId, balanceChargeIds),
  ]);

  const componentsBySchedule = new Map<string, FeeScheduleComponentRow[]>();
  for (const component of componentRows) {
    if (!componentsBySchedule.has(component.fee_schedule_id)) {
      componentsBySchedule.set(component.fee_schedule_id, []);
    }
    componentsBySchedule.get(component.fee_schedule_id)!.push(component);
  }

  const paidComponentsByCharge = new Map<string, Set<string>>();
  for (const paid of paidComponentRows) {
    if (paid.receipt_status === "cancelled") continue;
    if (!paidComponentsByCharge.has(paid.student_charge_id)) {
      paidComponentsByCharge.set(paid.student_charge_id, new Set<string>());
    }
    paidComponentsByCharge
      .get(paid.student_charge_id)!
      .add(paid.fee_schedule_component_id);
  }

  const balancesByStudent = new Map<string, ChargeBalanceRow[]>();

  for (const row of balanceRows) {
    const key = row.student_id;
    if (!balancesByStudent.has(key)) balancesByStudent.set(key, []);
    balancesByStudent.get(key)!.push(row);
  }

  const paymentStudentRows = sortByName(
    studentRows
      .map((student) => {
        const cls = student.class_id ? classMap.get(student.class_id) : null;
        if (!student.class_id || !cls) return null;

        const studentBalances = balancesByStudent.get(student.id) ?? [];
        const openCharges = studentBalances
          .filter(
            (row) =>
              row.class_id === student.class_id &&
              Number(row.balance_due || 0) > 0,
          )
          .map((row) => {
            const paidIds =
              paidComponentsByCharge.get(row.id) ?? new Set<string>();
            const components = row.fee_schedule_id
              ? (componentsBySchedule.get(row.fee_schedule_id) ?? [])
                  .filter((component) => !paidIds.has(component.id))
                  .map((component) => ({
                    id: component.id,
                    label: component.label,
                    amount: Number(component.amount || 0),
                    order_index: Number(component.order_index || 0),
                  }))
              : [];

            return {
              charge_id: row.id,
              fee_category_id: row.fee_category_id,
              fee_schedule_id: row.fee_schedule_id,
              label: row.label,
              due_date: row.due_date,
              net_amount: Number(row.net_amount || 0),
              paid_amount: Number(row.paid_amount || 0),
              balance_due: Number(row.balance_due || 0),
              components,
            };
          });

        return {
          student_id: student.id,
          student_name: fullName(student),
          matricule: student.matricule ?? null,
          class_id: student.class_id,
          class_label: student.class_label || cls.label || "Sans classe",
          level: cls.level,
          academic_year: cls.academic_year,
          total_due: openCharges.reduce(
            (sum, row) => sum + Number(row.balance_due || 0),
            0,
          ),
          total_paid: studentBalances.reduce(
            (sum, row) => sum + Number(row.paid_amount || 0),
            0,
          ),
          open_charges: openCharges,
        } satisfies PaymentStudentRow;
      })
      .filter(Boolean) as PaymentStudentRow[],
  );

  const receiptStudentIds = new Set(receiptRows.map((row) => row.student_id));
  const receiptStudents = adminStudents.filter((student) =>
    receiptStudentIds.has(student.id),
  );
  const receiptStudentMap = new Map(receiptStudents.map((s) => [s.id, s]));

  const totalDue = paymentStudentRows.reduce(
    (sum, row) => sum + Number(row.total_due || 0),
    0,
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
              Caisse et inscriptions
            </div>

            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
              Encaissements
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-[15px]">
              Recherchez un élève par nom ou matricule, encaissez directement,
              ou inscrivez rapidement un nouvel élève sans passer par une
              génération manuelle préalable des dettes.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/finance/charges"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-bold text-white hover:bg-white/15"
            >
              <ListChecks className="h-4 w-4" />
              Régulariser les situations
            </Link>
            <Link
              href="/admin/finance/fees"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-bold text-white hover:bg-white/15"
            >
              <Settings2 className="h-4 w-4" />
              Catégories
            </Link>
          </div>
        </div>
      </section>

      <AcademicYearSelector
        academicYears={academicYears}
        selectedAcademicYearCode={selectedAcademicYearCode}
        currentPath="/admin/finance/payments"
      />

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={<Wallet className="h-5 w-5" />}
          label="Reste à recouvrer"
          value={formatMoney(totalDue)}
          hint="Situations ouvertes connues"
        />
        <StatCard
          icon={<Receipt className="h-5 w-5" />}
          label="Reçus récents"
          value={receiptRows.length}
          hint="8 derniers reçus"
        />
        <StatCard
          icon={<CalendarClock className="h-5 w-5" />}
          label="Montant récent"
          value={formatMoney(totalReceipts)}
          hint="Total des reçus affichés"
        />
      </section>

      <PaymentsComposer
        action={createPaymentAction}
        classes={classRows}
        feeCategories={feeCategoryRows}
        rows={paymentStudentRows}
      />

      <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
              <Receipt className="h-4 w-4 text-emerald-600" />
              Reçus récents
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Affichage court pour retrouver vite les dernières opérations.
            </p>
          </div>
          <Link
            href="/admin/finance/receipts"
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            <FileText className="h-4 w-4" />
            Historique complet
          </Link>
        </div>

        {receiptRows.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
            Aucun reçu enregistré pour le moment.
          </div>
        ) : (
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {receiptRows.map((row) => {
              const student = receiptStudentMap.get(row.student_id);

              return (
                <article
                  key={row.id}
                  className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-black text-slate-900">
                          {row.receipt_no}
                        </h2>
                        <StatusPill
                          label={
                            row.receipt_status === "posted"
                              ? "Validé"
                              : "Annulé"
                          }
                        />
                      </div>
                      <div className="mt-2 text-sm text-slate-600">
                        {fullName(student)} · {formatMoney(row.total_amount)} ·{" "}
                        {new Date(row.payment_date).toLocaleDateString("fr-FR")}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Link
                        href={`/admin/finance/receipts/${row.id}`}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        Voir
                      </Link>
                      <Link
                        href={`/admin/finance/receipts/${row.id}?autoprint=1`}
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                      >
                        <Printer className="h-3.5 w-3.5" />
                        Imprimer
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
