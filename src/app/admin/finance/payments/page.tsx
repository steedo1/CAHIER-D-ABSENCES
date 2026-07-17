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
import {
  financeComponentIsOptional,
  financeScheduleAppliesToStudent,
  selectFinanceSchedulesForClass,
} from "@/lib/finance/charge-rules";
import {
  reconcileFinanceChargesForStudent,
  setStudentChargeOptionalComponents,
} from "@/lib/finance/student-finance-sync";

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
  is_optional?: boolean | null;
  paid_amount?: number;
};

type ComponentPaymentInput = {
  componentId: string;
  amount: number;
};

type PaidComponentRow = {
  student_charge_id: string;
  fee_schedule_component_id: string;
  receipt_status: string | null;
  amount?: number | string | null;
};

type SelectedComponentRow = {
  student_charge_id: string;
  fee_schedule_component_id: string;
};

type PaymentAllocationPlanItem = {
  chargeId: string;
  amount: number;
  componentIds: string[];
  componentAmounts: ComponentPaymentInput[];
  componentMode: "detail" | "hidden";
  closeUnselectedComponents: boolean;
  includeOnReceipt: boolean;
};

type ResolvedPaymentAllocation = {
  charge: ChargeBalanceRow;
  amount: number;
  selectedComponents: FeeScheduleComponentRow[];
  skippedComponents: FeeScheduleComponentRow[];
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
    paid_amount: number;
    remaining_amount: number;
    is_optional: boolean;
    is_engaged: boolean;
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
  is_affecte: boolean | null;
  is_boarder: boolean | null;
  profile_complete: boolean;
  total_expected: number;
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

function parseRequiredBoolean(value: unknown, label: string) {
  const normalized = normalize(value).toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${label} doit être renseigné.`);
}

function normalizeSearch(value: unknown) {
  return normalize(value).toLowerCase();
}

function isFinanceInternatCategory(
  category: Pick<FeeCategoryRow, "code" | "name"> | null | undefined,
) {
  const text = normalizeSearch(`${category?.code || ""} ${category?.name || ""}`);
  return text.includes("internat");
}

function isFinanceScolariteCategory(
  category: Pick<FeeCategoryRow, "code" | "name"> | null | undefined,
) {
  const text = normalizeSearch(`${category?.code || ""} ${category?.name || ""}`);
  return (
    text.includes("scolar") ||
    text.includes("ecolage") ||
    text.includes("écolage") ||
    text.includes("inscription")
  );
}

function isFinanceRenforcementCategory(
  category: Pick<FeeCategoryRow, "code" | "name"> | null | undefined,
) {
  const text = normalizeSearch(`${category?.code || ""} ${category?.name || ""}`);
  return text.includes("renforcement");
}

function isFinanceKitLivreCategory(
  category: Pick<FeeCategoryRow, "code" | "name"> | null | undefined,
) {
  const text = normalizeSearch(`${category?.code || ""} ${category?.name || ""}`);
  return (
    text.includes("kit_livre") ||
    text.includes("kit livre") ||
    (text.includes("kit") && text.includes("livre"))
  );
}

function receiptGroupKeyForCategory(
  category: Pick<FeeCategoryRow, "id" | "code" | "name"> | null | undefined,
) {
  if (isFinanceRenforcementCategory(category)) return "cours_renforcement";
  if (isFinanceKitLivreCategory(category)) return "kit_livre";
  if (isFinanceScolariteCategory(category) || isFinanceInternatCategory(category)) {
    return "scolarite_internat";
  }
  return `category:${category?.id || "autres"}`;
}

function receiptGroupLabelForCategory(
  category: Pick<FeeCategoryRow, "code" | "name"> | null | undefined,
  fallback: string,
) {
  if (isFinanceRenforcementCategory(category)) return "Cours de renforcement";
  if (isFinanceKitLivreCategory(category)) return "Kit livre";
  if (isFinanceScolariteCategory(category) && isFinanceInternatCategory(category)) {
    return "Scolarité & internat";
  }
  if (isFinanceScolariteCategory(category)) return "Scolarité";
  if (isFinanceInternatCategory(category)) return "Internat";
  return normalize((category as any)?.name) || fallback || "Frais scolaire";
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

  await reconcileFinanceChargesForStudent(
    admin,
    institutionId,
    userId,
    studentId,
    classId,
  );
  return fetchOpenChargesForStudent(institutionId, studentId, classId);

  const [
    { data: classRow, error: classErr },
    { data: studentRow, error: studentErr },
    { data: schedules, error: schErr },
    { data: allClasses, error: classesErr },
    { data: categories, error: categoriesErr },
  ] = await Promise.all([
    admin
      .from("classes")
      .select("id,label,level,academic_year,institution_id")
      .eq("id", classId)
      .eq("institution_id", institutionId)
      .maybeSingle(),
    admin
      .from("students")
      .select("id,is_affecte,is_boarder")
      .eq("id", studentId)
      .eq("institution_id", institutionId)
      .maybeSingle(),
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
      .from("classes")
      .select("id,label,level,academic_year")
      .eq("institution_id", institutionId)
      .range(0, 9999),
    admin
      .schema("finance")
      .from("fee_categories")
      .select("id,code,name,is_mandatory")
      .eq("school_id", institutionId),
  ]);

  if (classErr) {
    throw new Error(classErr?.message || "Impossible de charger la classe.");
  }
  if (studentErr) {
    throw new Error(studentErr?.message || "Impossible de charger l’élève.");
  }
  if (schErr) {
    throw new Error(schErr?.message || "Impossible de charger les barèmes financiers.");
  }
  if (classesErr) {
    throw new Error(classesErr?.message || "Impossible de charger les classes.");
  }
  if (categoriesErr) {
    throw new Error(categoriesErr?.message || "Impossible de charger les catégories financières.");
  }
  if (!classRow) throw new Error("Classe introuvable.");
  if (!studentRow) throw new Error("Élève introuvable.");

  const studentProfile = {
    is_affecte:
      typeof (studentRow as any).is_affecte === "boolean"
        ? Boolean((studentRow as any).is_affecte)
        : null,
    is_boarder:
      typeof (studentRow as any).is_boarder === "boolean"
        ? Boolean((studentRow as any).is_boarder)
        : null,
  };

  if (
    studentProfile.is_affecte === null ||
    studentProfile.is_boarder === null
  ) {
    throw new Error(
      "Profil financier incomplet : choisissez Affecté/Non affecté et Interne/Externe avant de générer les dettes.",
    );
  }

  const classesById = new Map(
    ((allClasses ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id || ""),
      row,
    ]),
  );
  classesById.set(String((classRow as any).id), classRow as any);

  const categoriesById = new Map(
    ((categories ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id || ""),
      row,
    ]),
  );

  const selectedSchedules = selectFinanceSchedulesForClass({
    schedules: (schedules ?? []) as FeeScheduleRow[],
    targetClass: classRow as any,
    classesById: classesById as any,
    categoriesById: categoriesById as any,
  });

  const scheduleRows = selectedSchedules.filter((schedule) =>
    financeScheduleAppliesToStudent(
      schedule,
      studentProfile,
      categoriesById as any,
    ),
  );

  if (scheduleRows.length === 0) return [];

  const scheduleIds = scheduleRows.map((row) => row.id);
  const componentRows = await fetchActiveScheduleComponents(
    institutionId,
    scheduleIds,
  );
  const componentsBySchedule = new Map<string, FeeScheduleComponentRow[]>();
  for (const component of componentRows) {
    if (!componentsBySchedule.has(component.fee_schedule_id)) {
      componentsBySchedule.set(component.fee_schedule_id, []);
    }
    componentsBySchedule.get(component.fee_schedule_id)!.push(component);
  }

  const initialAmountForSchedule = (schedule: FeeScheduleRow) => {
    if (!isInternatAnnexesCharge(schedule.label)) {
      return Number(schedule.amount || 0);
    }

    const components = componentsBySchedule.get(schedule.id) ?? [];
    const mandatoryBase = sumMandatoryInternatAnnexes(components);
    return mandatoryBase > 0 ? mandatoryBase : Number(schedule.amount || 0);
  };

  const { data: existingCharges, error: exErr } = await admin
    .schema("finance")
    .from("student_charges")
    .select("id,student_id,fee_schedule_id")
    .eq("school_id", institutionId)
    .eq("student_id", studentId)
    .eq("class_id", classId)
    .in("fee_schedule_id", scheduleIds);

  if (exErr) throw new Error(exErr?.message || "Impossible de lire les dettes existantes.");

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
      base_amount: initialAmountForSchedule(schedule),
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

    if (insErr) throw new Error(insErr?.message || "Impossible de créer les dettes manquantes.");
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
  userId,
  classId,
  firstName,
  lastName,
  matricule,
  isAffecte,
  isBoarder,
}: {
  institutionId: string;
  userId: string;
  classId: string;
  firstName: string;
  lastName: string;
  matricule: string | null;
  isAffecte: boolean;
  isBoarder: boolean;
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
      is_affecte: isAffecte,
      is_boarder: isBoarder,
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

  if (enrollErr) {
    await admin
      .from("students")
      .delete()
      .eq("id", created.id)
      .eq("institution_id", institutionId);
    throw new Error(enrollErr.message);
  }

  // Les profils Affecté/Non affecté et Interne/Externe sont enregistrés
  // avant la génération. Le moteur applique ensuite uniquement les barèmes
  // compatibles avec le profil financier de l'élève.
  try {
    await ensureChargesForStudent(
      institutionId,
      userId,
      created.id as string,
      classId,
    );
  } catch (error) {
    await admin
      .from("class_enrollments")
      .delete()
      .eq("institution_id", institutionId)
      .eq("class_id", classId)
      .eq("student_id", created.id);
    await admin
      .from("students")
      .delete()
      .eq("id", created.id)
      .eq("institution_id", institutionId);
    throw error;
  }

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

  // IMPORTANT :
  // L'écran Encaissements ne doit pas générer automatiquement les dettes
  // depuis les barèmes. Les dettes fixes viennent du module Dettes/Barèmes.
  // Les frais annexes internat, eux, sont variables et se régularisent
  // uniquement selon les sous-rubriques réellement cochées.
  const openCharges = await fetchOpenChargesForStudent(
    institutionId,
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

function chunkArray<T>(items: T[], size = 100): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchActiveScheduleComponents(
  institutionId: string,
  scheduleIds: string[],
): Promise<FeeScheduleComponentRow[]> {
  const uniqueScheduleIds = Array.from(new Set(scheduleIds.filter(Boolean)));
  if (uniqueScheduleIds.length === 0) return [];

  const admin = getSupabaseServiceClient();
  const rows: FeeScheduleComponentRow[] = [];

  for (const ids of chunkArray(uniqueScheduleIds, 100)) {
    const { data, error } = await admin
      .schema("finance")
      .from("fee_schedule_components")
      .select(
        "id,school_id,fee_schedule_id,component_code,label,amount,order_index,is_active,is_optional",
      )
      .eq("school_id", institutionId)
      .in("fee_schedule_id", ids)
      .eq("is_active", true)
      .order("order_index", { ascending: true })
      .order("label", { ascending: true });

    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("does not exist") || msg.includes("introuvable")) {
        return [];
      }
      throw new Error(
        `Lecture des composants de frais impossible : ${error.message}`,
      );
    }

    rows.push(...((data ?? []) as FeeScheduleComponentRow[]));
  }

  return rows.sort(
    (a, b) =>
      Number(a.order_index || 0) - Number(b.order_index || 0) ||
      a.label.localeCompare(b.label, "fr", {
        numeric: true,
        sensitivity: "base",
      }),
  );
}

async function fetchPaidComponentsForCharges(
  institutionId: string,
  chargeIds: string[],
): Promise<PaidComponentRow[]> {
  const uniqueChargeIds = Array.from(new Set(chargeIds.filter(Boolean)));
  if (uniqueChargeIds.length === 0) return [];

  const admin = getSupabaseServiceClient();
  const rows: PaidComponentRow[] = [];

  // Important : il peut y avoir plus de 1 800 dettes ouvertes.
  // Un seul .in("student_charge_id", chargeIds) produit une URL trop longue
  // côté PostgREST/Vercel. On découpe donc les IDs.
  for (const ids of chunkArray(uniqueChargeIds, 100)) {
    const { data, error } = await admin
      .schema("finance")
      .from("v_receipt_allocation_components")
      .select("student_charge_id,fee_schedule_component_id,receipt_status,amount")
      .eq("school_id", institutionId)
      .in("student_charge_id", ids);

    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("does not exist") || msg.includes("introuvable")) {
        return [];
      }
      throw new Error(
        `Lecture des sous-rubriques déjà payées impossible : ${error.message}`,
      );
    }

    rows.push(...((data ?? []) as PaidComponentRow[]));
  }

  return rows;
}

async function fetchSelectedComponentsForCharges(
  institutionId: string,
  chargeIds: string[],
): Promise<SelectedComponentRow[]> {
  const uniqueChargeIds = Array.from(new Set(chargeIds.filter(Boolean)));
  if (uniqueChargeIds.length === 0) return [];

  const admin = getSupabaseServiceClient();
  const rows: SelectedComponentRow[] = [];
  for (const ids of chunkArray(uniqueChargeIds, 100)) {
    const { data, error } = await admin
      .schema("finance")
      .from("student_charge_component_selections")
      .select("student_charge_id,fee_schedule_component_id")
      .eq("school_id", institutionId)
      .in("student_charge_id", ids);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as SelectedComponentRow[]));
  }
  return rows;
}


function isInternatAnnexesCharge(label: string | null | undefined) {
  const text = normalize(label)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return (
    text.includes("internat") &&
    text.includes("frais") &&
    text.includes("annexe")
  );
}

function isOptionalInternatAnnexeComponent(
  component:
    | string
    | null
    | undefined
    | { label?: string | null; is_optional?: boolean | null },
) {
  return financeComponentIsOptional(
    typeof component === "object" && component !== null
      ? component
      : { label: component },
  );
}

function sumMandatoryInternatAnnexes(
  components: Array<{
    label: string | null;
    amount: number | string;
    is_optional?: boolean | null;
  }>,
) {
  return components
    .filter((component) => !isOptionalInternatAnnexeComponent(component))
    .reduce((sum, component) => sum + Number(component.amount || 0), 0);
}

function inferEngagedOptionalComponentIds({
  components,
  currentExpectedAmount,
  explicitlyPaidIds = new Set<string>(),
}: {
  components: Array<{
    id: string;
    label: string | null;
    amount: number | string;
    is_optional?: boolean | null;
  }>;
  currentExpectedAmount: number;
  explicitlyPaidIds?: Set<string>;
}) {
  const optionalComponents = components.filter((component) =>
    isOptionalInternatAnnexeComponent(component),
  );
  const mandatoryBase = sumMandatoryInternatAnnexes(components);
  const targetOptionalCents = Math.max(
    Math.round((Number(currentExpectedAmount || 0) - mandatoryBase) * 100),
    0,
  );

  const paidIds = new Set(
    optionalComponents
      .filter((component) => explicitlyPaidIds.has(component.id))
      .map((component) => component.id),
  );

  let best: Set<string> | null = null;
  let bestScore = -1;
  const combinations = 1 << optionalComponents.length;

  for (let mask = 0; mask < combinations; mask++) {
    const ids = new Set<string>();
    let totalCents = 0;

    for (let index = 0; index < optionalComponents.length; index++) {
      if ((mask & (1 << index)) === 0) continue;
      const component = optionalComponents[index];
      ids.add(component.id);
      totalCents += Math.round(Number(component.amount || 0) * 100);
    }

    if (totalCents !== targetOptionalCents) continue;
    if (Array.from(paidIds).some((id) => !ids.has(id))) continue;

    const score =
      Array.from(ids).filter((id) => paidIds.has(id)).length * 100 -
      ids.size;
    if (score > bestScore) {
      best = ids;
      bestScore = score;
    }
  }

  if (best) return best;

  // Si une ancienne dette ne correspond pas exactement à une combinaison
  // connue, on ne devine rien : seules les options prouvées par un reçu
  // restent engagées.
  return paidIds;
}

async function syncVariableAnnexChargeAmounts({
  institutionId,
  userId,
  studentId,
  allocations,
}: {
  institutionId: string;
  userId: string;
  studentId: string;
  allocations: ResolvedPaymentAllocation[];
}) {
  const variableItems = allocations.filter(
    (item) =>
      isInternatAnnexesCharge(item.charge.label) &&
      (item.selectedComponents.length > 0 || item.skippedComponents.length > 0),
  );

  if (variableItems.length === 0) return;

  const admin = getSupabaseServiceClient();

  for (const item of variableItems) {
    await setStudentChargeOptionalComponents({
      srv: admin,
      institutionId,
      userId,
      studentId,
      chargeId: item.charge.id,
      selectedComponentIds: item.selectedComponents
        .filter((component) => financeComponentIsOptional(component))
        .map((component) => component.id),
      preserveExisting: true,
    });
  }
  return;

  for (const item of variableItems) {
    const { data: allocationRows, error: allocationErr } = await admin
      .schema("finance")
      .from("receipt_allocations")
      .select("id,receipt_id,amount")
      .eq("student_charge_id", item.charge.id);

    if (allocationErr) throw new Error(allocationErr?.message || "Impossible de lire les ventilations du reçu.");

    const receiptIds = Array.from(
      new Set(
        ((allocationRows ?? []) as any[])
          .map((row) => row.receipt_id)
          .filter(Boolean),
      ),
    );
    let cancelledReceiptIds = new Set<string>();

    if (receiptIds.length > 0) {
      const { data: receiptRows, error: receiptErr } = await admin
        .schema("finance")
        .from("receipts")
        .select("id,receipt_status")
        .in("id", receiptIds);

      if (receiptErr) throw new Error(receiptErr?.message || "Impossible de lire les reçus.");

      cancelledReceiptIds = new Set(
        ((receiptRows ?? []) as Array<{ id: string; receipt_status: string }>)
          .filter((row) => row.receipt_status === "cancelled")
          .map((row) => row.id),
      );
    }

    const activeAllocationRows = ((allocationRows ?? []) as any[]).filter(
      (row) => !cancelledReceiptIds.has(row.receipt_id),
    );
    const activeAllocationIds = activeAllocationRows.map((row) => row.id);
    const allocationTotal = activeAllocationRows.reduce(
      (sum, row) => sum + Number(row.amount || 0),
      0,
    );

    let mandatoryBaseTotal = 0;
    let allComponents: Array<{
      id: string;
      label: string | null;
      amount: number | string;
    }> = [];

    if (item.charge.fee_schedule_id) {
      const { data: allExpectedRows, error: allExpectedErr } = await admin
        .schema("finance")
        .from("fee_schedule_components")
        .select("id,label,amount")
        .eq("school_id", institutionId)
        .eq("fee_schedule_id", item.charge.fee_schedule_id)
        .eq("is_active", true);

      if (allExpectedErr) throw new Error(allExpectedErr?.message || "Impossible de lire les sous-rubriques attendues.");

      allComponents = (allExpectedRows ?? []) as Array<{
        id: string;
        label: string | null;
        amount: number | string;
      }>;
      const computedMandatoryBase = sumMandatoryInternatAnnexes(allComponents);
      if (computedMandatoryBase > 0) mandatoryBaseTotal = computedMandatoryBase;
    }

    const explicitlyEngagedOptionalIds = new Set<string>();

    if (activeAllocationIds.length > 0) {
      const { data: componentRows, error: componentErr } = await admin
        .schema("finance")
        .from("receipt_allocation_components")
        .select("fee_schedule_component_id,amount")
        .in("receipt_allocation_id", activeAllocationIds);

      if (componentErr) throw new Error(componentErr?.message || "Impossible de lire les sous-rubriques encaissées.");

      for (const row of (componentRows ?? []) as Array<{
        fee_schedule_component_id: string;
        amount: number | string;
      }>) {
        if (Number(row.amount || 0) <= 0) continue;
        const component = allComponents.find(
          (candidate) => candidate.id === row.fee_schedule_component_id,
        );
        if (
          component &&
          isOptionalInternatAnnexeComponent(component)
        ) {
          explicitlyEngagedOptionalIds.add(component!.id);
        }
      }
    }

    // Une ancienne dette peut déjà contenir une option sans ventilation
    // détaillée. On la reconstitue à partir du montant brut (ex. 191 500 F =
    // socle 178 500 F + Bréviaire 13 000 F) afin qu'un nouveau reçu ne fasse
    // jamais disparaître une option déjà engagée.
    const engagedOptionalIds = inferEngagedOptionalComponentIds({
      components: allComponents,
      currentExpectedAmount: Number(item.charge.net_amount || item.charge.base_amount || 0),
      explicitlyPaidIds: explicitlyEngagedOptionalIds,
    });

    for (const id of explicitlyEngagedOptionalIds) {
      engagedOptionalIds.add(id);
    }

    const optionalExpectedTotal = allComponents
      .filter(
        (component) =>
          isOptionalInternatAnnexeComponent(component) &&
          engagedOptionalIds.has(component.id),
      )
      .reduce((sum, component) => sum + Number(component.amount || 0), 0);

    // Règle CSCA : le socle obligatoire reste dû. Bréviaire, Bible Africaine
    // et Convoi internat entrent intégralement dans la dette dès qu'un montant
    // positif est saisi sur la sous-rubrique correspondante.
    const confirmedAmount = mandatoryBaseTotal + optionalExpectedTotal;
    const nextStatus =
      allocationTotal >= confirmedAmount - 0.01
        ? "paid"
        : allocationTotal > 0
          ? "partial"
          : "pending";

    const { error: updateErr } = await admin
      .schema("finance")
      .from("student_charges")
      .update({
        base_amount: confirmedAmount,
        status: nextStatus,
        notes:
          "Frais annexes internat recalculés selon le socle obligatoire et les options réellement engagées.",
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", item.charge.id)
      .eq("school_id", institutionId);

    if (updateErr) throw new Error(updateErr?.message || "Impossible de mettre à jour la dette d’internat.");
  }
}

async function resolveSelectedComponentsForPayment({
  institutionId,
  charge,
  componentIds,
  componentAmounts,
  amount,
}: {
  institutionId: string;
  charge: ChargeBalanceRow;
  componentIds: string[];
  componentAmounts: ComponentPaymentInput[];
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
    .select("student_charge_id,fee_schedule_component_id,receipt_status,amount")
    .eq("school_id", institutionId)
    .eq("student_charge_id", charge.id)
    .in("fee_schedule_component_id", ids);

  if (paidErr) throw new Error(paidErr.message);

  const paidRows = ((alreadyPaid ?? []) as PaidComponentRow[]).filter(
    (row) => row.receipt_status !== "cancelled" && Number(row.amount || 0) > 0,
  );
  const paidByComponent = new Map<string, number>();
  for (const row of paidRows) {
    paidByComponent.set(
      row.fee_schedule_component_id,
      (paidByComponent.get(row.fee_schedule_component_id) ?? 0) +
        Number(row.amount || 0),
    );
  }

  const amountByComponent = new Map(
    componentAmounts.map((component) => [component.componentId, component.amount]),
  );

  const selectedTotal = rows.reduce((sum, row) => {
    const paidNow = amountByComponent.get(row.id) ?? Number(row.amount || 0);
    const alreadyPaidForComponent = paidByComponent.get(row.id) ?? 0;
    const remainingForComponent = Math.max(
      Number(row.amount || 0) - alreadyPaidForComponent,
      0,
    );

    if (paidNow <= 0) {
      throw new Error(`Veuillez saisir un montant pour ${row.label}.`);
    }
    if (paidNow > remainingForComponent + 0.01) {
      throw new Error(
        `Le montant saisi pour ${row.label} dépasse le reste de cette sous-rubrique (${formatMoney(remainingForComponent)}).`,
      );
    }

    row.paid_amount = paidNow;
    return sum + paidNow;
  }, 0);

  if (Math.abs(selectedTotal - amount) > 0.01) {
    throw new Error(
      `Le montant encaissé (${formatMoney(amount)}) doit correspondre au total des sous-rubriques saisies (${formatMoney(selectedTotal)}).`,
    );
  }

  return rows.sort(
    (a, b) => Number(a.order_index || 0) - Number(b.order_index || 0),
  );
}

function parsePaymentAllocationPlan(
  raw: FormDataEntryValue | null,
): PaymentAllocationPlanItem[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("La ventilation du paiement est invalide.");
  }

  if (!Array.isArray(parsed)) return [];

  const merged = new Map<string, PaymentAllocationPlanItem>();

  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const chargeId = normalize((item as any).chargeId);
    if (!chargeId) continue;

    const rawAmount = Number((item as any).amount || 0);
    const amount = Number.isFinite(rawAmount) ? Math.max(rawAmount, 0) : 0;
    const componentIds = Array.isArray((item as any).componentIds)
      ? (item as any).componentIds
          .map((value: unknown) => normalize(value))
          .filter(Boolean)
      : [];
    const componentAmounts: ComponentPaymentInput[] = Array.isArray(
      (item as any).componentAmounts,
    )
      ? (item as any).componentAmounts
          .map((value: unknown) => {
            const componentId = normalize((value as any)?.componentId);
            const raw = Number((value as any)?.amount || 0);
            const amountValue = Number.isFinite(raw) ? Math.max(raw, 0) : 0;
            return componentId && amountValue > 0
              ? { componentId, amount: amountValue }
              : null;
          })
          .filter(Boolean) as ComponentPaymentInput[]
      : [];
    const componentMode =
      (item as any).componentMode === "hidden" ? "hidden" : "detail";
    const closeUnselectedComponents = Boolean(
      (item as any).closeUnselectedComponents,
    );
    const includeOnReceipt = Boolean((item as any).includeOnReceipt);

    const existing = merged.get(chargeId);
    if (existing) {
      existing.amount += amount;
      existing.componentIds = Array.from(
        new Set([...existing.componentIds, ...componentIds]),
      );
      const amountByComponent = new Map<string, number>();
      for (const component of existing.componentAmounts) {
        amountByComponent.set(
          component.componentId,
          (amountByComponent.get(component.componentId) ?? 0) + component.amount,
        );
      }
      for (const component of componentAmounts) {
        amountByComponent.set(
          component.componentId,
          (amountByComponent.get(component.componentId) ?? 0) + component.amount,
        );
      }
      existing.componentAmounts = Array.from(amountByComponent.entries()).map(
        ([componentId, amountValue]) => ({ componentId, amount: amountValue }),
      );
      existing.closeUnselectedComponents =
        existing.closeUnselectedComponents || closeUnselectedComponents;
      existing.includeOnReceipt = existing.includeOnReceipt || includeOnReceipt;
      existing.componentMode =
        existing.componentMode === "hidden" || componentMode === "hidden"
          ? "hidden"
          : "detail";
    } else {
      merged.set(chargeId, {
        chargeId,
        amount,
        componentIds: Array.from(new Set(componentIds)),
        componentAmounts,
        componentMode,
        closeUnselectedComponents,
        includeOnReceipt,
      });
    }
  }

  return Array.from(merged.values()).filter(
    (item) =>
      item.amount > 0 || item.includeOnReceipt || item.closeUnselectedComponents,
  );
}

async function resolveAllocationPlanForPayment({
  institutionId,
  studentId,
  classId,
  feeCategoryId,
  plan,
}: {
  institutionId: string;
  studentId: string;
  classId: string;
  feeCategoryId: string;
  plan: PaymentAllocationPlanItem[];
}): Promise<ResolvedPaymentAllocation[]> {
  if (plan.length === 0) return [];

  const resolved: ResolvedPaymentAllocation[] = [];

  for (const item of plan) {
    const charge = await fetchChargeById(item.chargeId, institutionId);
    if (!charge) throw new Error("Un frais sélectionné est introuvable.");
    if (charge.student_id !== studentId) {
      throw new Error("Un frais sélectionné ne correspond pas à cet élève.");
    }
    if (classId && charge.class_id !== classId) {
      throw new Error(
        "Un frais sélectionné ne correspond pas à la classe choisie.",
      );
    }
    if (feeCategoryId && charge.fee_category_id !== feeCategoryId) {
      throw new Error(
        "Un frais sélectionné ne correspond pas à la catégorie choisie.",
      );
    }

    const balanceDue = Number(charge.balance_due || 0);
    const isVariableAnnexCharge =
      isInternatAnnexesCharge(charge.label) && item.componentIds.length > 0;

    // Les frais annexes internat sont variables : la dette technique peut avoir
    // un solde comptable à 0 F tant qu'aucun composant n'est confirmé. Dans ce
    // cas, on valide le paiement par les sous-rubriques cochées, pas par
    // balance_due. Les autres frais gardent le contrôle classique du solde.
    if (!isVariableAnnexCharge) {
      if (balanceDue <= 0) throw new Error(`${charge.label} est déjà soldé.`);
      if (item.amount > balanceDue) {
        throw new Error(
          `Le montant saisi pour ${charge.label} dépasse le reste dû (${formatMoney(balanceDue)}).`,
        );
      }
    }

    let selectedComponents: FeeScheduleComponentRow[] = [];
    let skippedComponents: FeeScheduleComponentRow[] = [];

    if (item.componentIds.length > 0) {
      selectedComponents = await resolveSelectedComponentsForPayment({
        institutionId,
        charge,
        componentIds: item.componentIds,
        componentAmounts: item.componentAmounts,
        amount: item.amount,
      });

      if (isVariableAnnexCharge && charge.fee_schedule_id) {
        const [allComponents, paidComponents] = await Promise.all([
          fetchActiveScheduleComponents(institutionId, [charge.fee_schedule_id]),
          fetchPaidComponentsForCharges(institutionId, [charge.id]),
        ]);
        const explicitlyPaidOptionalIds = new Set(
          paidComponents
            .filter(
              (row) =>
                row.receipt_status !== "cancelled" &&
                Number(row.amount || 0) > 0,
            )
            .map((row) => row.fee_schedule_component_id),
        );
        const alreadyEngagedOptionalIds = inferEngagedOptionalComponentIds({
          components: allComponents.map((component) => ({
            id: component.id,
            label: component.label,
            amount: component.amount,
            is_optional: component.is_optional,
          })),
          currentExpectedAmount: Number(
            charge.net_amount || charge.base_amount || 0,
          ),
          explicitlyPaidIds: explicitlyPaidOptionalIds,
        });
        const newOptionalExpectedTotal = selectedComponents
          .filter(
            (component) =>
              isOptionalInternatAnnexeComponent(component) &&
              !alreadyEngagedOptionalIds.has(component.id),
          )
          .reduce(
            (sum, component) => sum + Number(component.amount || 0),
            0,
          );
        const maximumAllowed = balanceDue + newOptionalExpectedTotal;

        if (item.amount > maximumAllowed + 0.01) {
          throw new Error(
            `Le montant saisi pour ${charge.label} dépasse le reste actualisé (${formatMoney(maximumAllowed)}).`,
          );
        }
      }

      if (item.closeUnselectedComponents && charge.fee_schedule_id) {
        const [activeComponents, alreadyPaidComponents] = await Promise.all([
          fetchActiveScheduleComponents(institutionId, [
            charge.fee_schedule_id,
          ]),
          fetchPaidComponentsForCharges(institutionId, [charge.id]),
        ]);
        const selectedIds = new Set(selectedComponents.map((c) => c.id));
        const alreadyPaidIds = new Set(
          alreadyPaidComponents
            .filter((row) => row.receipt_status !== "cancelled" && Number(row.amount || 0) > 0)
            .map((row) => row.fee_schedule_component_id),
        );
        skippedComponents = activeComponents.filter(
          (component) =>
            !selectedIds.has(component.id) && !alreadyPaidIds.has(component.id),
        );
      }
    } else if (item.closeUnselectedComponents && charge.fee_schedule_id) {
      const [activeComponents, alreadyPaidComponents] = await Promise.all([
        fetchActiveScheduleComponents(institutionId, [charge.fee_schedule_id]),
        fetchPaidComponentsForCharges(institutionId, [charge.id]),
      ]);
      const alreadyPaidIds = new Set(
        alreadyPaidComponents
          .filter((row) => row.receipt_status !== "cancelled" && Number(row.amount || 0) > 0)
          .map((row) => row.fee_schedule_component_id),
      );
      skippedComponents = activeComponents.filter(
        (component) => !alreadyPaidIds.has(component.id),
      );
    } else if (charge.fee_schedule_id && item.componentMode !== "hidden") {
      const activeComponents = await fetchActiveScheduleComponents(
        institutionId,
        [charge.fee_schedule_id],
      );
      if (activeComponents.length > 0) {
        throw new Error(
          `Veuillez cocher les sous-rubriques réglées pour ${charge.label}.`,
        );
      }
    }

    resolved.push({
      charge,
      amount: item.amount,
      selectedComponents,
      skippedComponents,
    });
  }

  return resolved;
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
  const feeCategoryIdRaw = normalize(formData.get("fee_category_id"));
  const feeCategoryId = feeCategoryIdRaw === "__mixed__" ? "" : feeCategoryIdRaw;
  const mixedReceipt = feeCategoryIdRaw === "__mixed__";
  const paymentType = normalize(formData.get("payment_type")) || "cash";
  const amountRaw = normalize(formData.get("amount"));
  const expectedAmountRaw = normalize(formData.get("expected_amount"));
  const payerName = normalize(formData.get("payer_name"));
  const referenceNo = normalize(formData.get("reference_no"));
  const componentIds = formData
    .getAll("component_ids")
    .map((value) => normalize(value))
    .filter(Boolean);
  const allocationPlan = parsePaymentAllocationPlan(
    formData.get("allocation_plan"),
  );
  const paymentDate = normalize(formData.get("payment_date"));
  const notes = normalize(formData.get("notes"));
  const parentPhone = normalize(formData.get("parent_phone"));

  if (!classId) throw new Error("Veuillez choisir une classe.");
  if (mode !== "new" && !feeCategoryId && !mixedReceipt)
    throw new Error("Veuillez choisir une catégorie de frais.");

  let amount = Number(amountRaw);
  const hasAllocationPlan = allocationPlan.length > 0;
  if (mode !== "new" && (!Number.isFinite(amount) || amount <= 0) && !hasAllocationPlan) {
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

  let feeCategory: { id?: string; name?: string; school_id?: string; is_active?: boolean } | null = null;
  if (feeCategoryId) {
    const { data: feeCategoryData, error: catErr } = await admin
      .schema("finance")
      .from("fee_categories")
      .select("id,name,school_id,is_active")
      .eq("id", feeCategoryId)
      .eq("school_id", institutionId)
      .maybeSingle();

    if (catErr) throw new Error(catErr.message);
    if (!feeCategoryData) throw new Error("Catégorie de frais introuvable.");
    feeCategory = feeCategoryData as any;
  }

  let studentId = selectedStudentId;
  const extraNotes: string[] = [
    `Mode d’encaissement : ${paymentTypeLabel(paymentType)}`,
  ];

  if (mode === "new") {
    const lastName = normalize(formData.get("last_name"));
    const firstName = normalize(formData.get("first_name"));
    const matricule = normalize(formData.get("matricule")) || null;
    const isAffecte = parseRequiredBoolean(
      formData.get("is_affecte"),
      "Le statut Affecté/Non affecté",
    );
    const isBoarder = parseRequiredBoolean(
      formData.get("is_boarder"),
      "Le statut Interne/Externe",
    );

    if (!lastName) throw new Error("Le nom de l’élève est obligatoire.");
    if (!firstName) throw new Error("Le prénom de l’élève est obligatoire.");

    studentId = await createStudentAndEnroll({
      institutionId,
      userId,
      classId,
      firstName,
      lastName,
      matricule,
      isAffecte,
      isBoarder,
    });

    extraNotes.push("Nouvelle inscription depuis le module Finance");
    extraNotes.push("Dossier élève à compléter si nécessaire");
    if (parentPhone) extraNotes.push(`Contact parent/tuteur : ${parentPhone}`);

    revalidatePath("/admin/finance/payments");
    revalidatePath("/admin/classes");
    revalidatePath("/admin/finance");
    redirect(
      `/admin/finance/payments?student_id=${encodeURIComponent(studentId)}&class_id=${encodeURIComponent(classId)}`,
    );
  }

  if (!studentId) {
    throw new Error("Veuillez choisir ou créer un élève.");
  }

  let allocationDrafts: ResolvedPaymentAllocation[] = [];

  if (hasAllocationPlan) {
    allocationDrafts = await resolveAllocationPlanForPayment({
      institutionId,
      studentId,
      classId,
      feeCategoryId,
      plan: allocationPlan,
    });

    const plannedAmount = allocationDrafts.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    );
    if (plannedAmount <= 0) {
      throw new Error("Veuillez saisir au moins un montant à encaisser.");
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      amount = plannedAmount;
    } else if (Math.abs(amount - plannedAmount) > 0.01) {
      throw new Error(
        `Le montant encaissé (${formatMoney(amount)}) ne correspond pas à la ventilation (${formatMoney(plannedAmount)}).`,
      );
    }
  } else {
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
      componentAmounts: [],
      amount,
    });

    allocationDrafts = [{ charge, amount, selectedComponents, skippedComponents: [] }];
  }

  // Les options sont enregistrées avant la création du reçu. Ainsi, une erreur
  // de paramétrage ne peut jamais laisser un reçu posté alors que le recalcul de
  // la dette a échoué.
  await syncVariableAnnexChargeAmounts({
    institutionId,
    userId,
    studentId,
    allocations: allocationDrafts,
  });

  const primaryCharge = allocationDrafts[0]?.charge;
  if (!primaryCharge) {
    throw new Error(
      "Aucune ventilation valide n’a été trouvée pour ce paiement.",
    );
  }

  let academicYear: string | null = null;
  let academicYearId: string | null = primaryCharge.academic_year_id || null;

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

  const paymentDateIso = paymentDate
    ? `${paymentDate}T12:00:00`
    : new Date().toISOString();
  const receiptNotes =
    [notes, ...extraNotes].filter(Boolean).join("\n") || null;

  const categoryIds = Array.from(
    new Set(allocationDrafts.map((item) => item.charge.fee_category_id).filter(Boolean)),
  );
  const { data: receiptCategoryRows, error: receiptCategoryErr } = await admin
    .schema("finance")
    .from("fee_categories")
    .select("id,code,name")
    .in("id", categoryIds);

  if (receiptCategoryErr) throw new Error(receiptCategoryErr.message);

  const receiptCategoryById = new Map(
    ((receiptCategoryRows ?? []) as Array<{ id: string; code: string; name: string }>).map(
      (category) => [category.id, category],
    ),
  );

  type ReceiptDraftGroup = {
    key: string;
    label: string;
    drafts: ResolvedPaymentAllocation[];
  };

  const receiptGroups = new Map<string, ReceiptDraftGroup>();
  for (const draft of allocationDrafts) {
    const category = receiptCategoryById.get(draft.charge.fee_category_id) ?? null;
    const key = receiptGroupKeyForCategory(category);
    const label = receiptGroupLabelForCategory(category, draft.charge.label);
    const existing = receiptGroups.get(key);
    if (existing) {
      existing.drafts.push(draft);
    } else {
      receiptGroups.set(key, { key, label, drafts: [draft] });
    }
  }

  const orderedReceiptGroups = Array.from(receiptGroups.values()).sort((a, b) => {
    const order = ["scolarite_internat", "kit_livre", "cours_renforcement"];
    const ai = order.indexOf(a.key);
    const bi = order.indexOf(b.key);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const createdReceipts: Array<{
    id: string;
    receiptNo: string;
    totalAmount: number;
    categoryName: string;
    drafts: ResolvedPaymentAllocation[];
  }> = [];

  async function rollbackCreatedReceipts(extraReceiptId?: string) {
    const ids = Array.from(
      new Set([
        ...createdReceipts.map((row) => row.id),
        ...(extraReceiptId ? [extraReceiptId] : []),
      ]),
    );
    if (ids.length === 0) return;
    await admin
      .schema("finance")
      .from("receipts")
      .delete()
      .eq("school_id", institutionId)
      .in("id", ids);
  }

  for (const group of orderedReceiptGroups) {
    const groupAmount = group.drafts.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    );
    if (groupAmount <= 0) continue;

    const receiptNo = makeReceiptNo();
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
        total_amount: groupAmount,
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

    if (receiptErr) {
      await rollbackCreatedReceipts();
      throw new Error(receiptErr.message);
    }

    const nowAllocationIso = new Date().toISOString();
    const { data: allocationsInserted, error: allocErr } = await admin
      .schema("finance")
      .from("receipt_allocations")
      .insert(
        group.drafts.map((item) => ({
          receipt_id: receipt.id,
          student_charge_id: item.charge.id,
          amount: item.amount,
          created_at: nowAllocationIso,
        })) as any[],
      )
      .select("id,student_charge_id");

    if (allocErr) {
      await rollbackCreatedReceipts(receipt.id);
      throw new Error(allocErr.message);
    }

    const allocationIdByChargeId = new Map<string, string>();
    for (const row of (allocationsInserted ?? []) as Array<{
      id: string;
      student_charge_id: string;
    }>) {
      allocationIdByChargeId.set(row.student_charge_id, row.id);
    }

    const componentAllocations = group.drafts.flatMap((item) => {
      const allocationId = allocationIdByChargeId.get(item.charge.id);
      if (!allocationId) return [];

      const paidComponents = item.selectedComponents.map((component) => ({
        receipt_allocation_id: allocationId,
        fee_schedule_component_id: component.id,
        label: component.label,
        amount: Number(component.paid_amount ?? component.amount ?? 0),
        order_index: Number(component.order_index || 0),
        created_at: nowAllocationIso,
      }));

      const skippedComponents = item.skippedComponents.map((component) => ({
        receipt_allocation_id: allocationId,
        fee_schedule_component_id: component.id,
        label: component.label,
        amount: 0,
        order_index: Number(component.order_index || 0),
        created_at: nowAllocationIso,
      }));

      return [...paidComponents, ...skippedComponents];
    });

    if (componentAllocations.length > 0) {
      const { error: compAllocErr } = await admin
        .schema("finance")
        .from("receipt_allocation_components")
        .insert(componentAllocations as any[]);

      if (compAllocErr) {
        await rollbackCreatedReceipts(receipt.id);
        throw new Error(compAllocErr.message);
      }
    }

    createdReceipts.push({
      id: receipt.id,
      receiptNo: receipt.receipt_no,
      totalAmount: groupAmount,
      categoryName: group.label,
      drafts: group.drafts,
    });
  }

  if (createdReceipts.length === 0) {
    throw new Error("Aucun reçu n’a été créé pour cet encaissement.");
  }

  // La mise à jour des options d'internat peut augmenter le montant attendu.
  // On relit donc les soldes réels après synchronisation au lieu de soustraire
  // le paiement à l'ancien balance_due.
  let remainingDueAfterPayment = 0;
  for (const chargeId of Array.from(
    new Set(allocationDrafts.map((item) => item.charge.id)),
  )) {
    const refreshed = await fetchChargeById(chargeId, institutionId);
    remainingDueAfterPayment += Math.max(
      Number(refreshed?.balance_due || 0),
      0,
    );
  }

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

  for (const createdReceipt of createdReceipts) {
    try {
      await queueFounderFinancePaymentNotification({
        institutionId,
        amount: createdReceipt.totalAmount,
        receiptNo: createdReceipt.receiptNo,
        payerName: payerName || null,
        studentName: studentNameForNotification || null,
        className,
        categoryName: createdReceipt.categoryName,
        remainingDue: remainingDueAfterPayment,
        paidAt: paymentDateIso,
      });
    } catch (e: any) {
      console.warn(
        "[finance/payments] founder finance notification skipped",
        e?.message || e,
      );
    }
  }

  revalidatePath("/admin/finance/payments");
  revalidatePath("/admin/finance/receipts");
  for (const createdReceipt of createdReceipts) {
    revalidatePath(`/admin/finance/receipts/${createdReceipt.id}`);
  }
  revalidatePath("/admin/finance/charges");
  revalidatePath("/admin/finance/arrears");
  revalidatePath("/admin/finance");

  // On ne lance plus l’impression automatiquement : le gestionnaire doit
  // pouvoir vérifier le reçu et corriger une éventuelle erreur avant PDF/papier.
  if (createdReceipts.length > 1) {
    const ids = createdReceipts.map((row) => row.id).join(",");
    redirect(`/admin/finance/receipts?created=${encodeURIComponent(ids)}`);
  }
  redirect(`/admin/finance/receipts/${createdReceipts[0].id}`);
}

async function updateInternatOptionsAction(formData: FormData) {
  "use server";

  const access = await getFinanceAccessForCurrentUser();
  if (!access.ok) redirect("/admin/finance/locked");

  const { institutionId, userId } = await getCurrentContextOrThrow();
  const studentId = normalize(formData.get("student_id"));
  const classId = normalize(formData.get("class_id"));
  const rawPlan = String(formData.get("option_selection_plan") || "").trim();
  if (!studentId || !classId || !rawPlan) {
    throw new Error("Élève, classe et options d'internat sont obligatoires.");
  }

  let plan: Array<{ chargeId: string; componentIds: string[] }> = [];
  try {
    const parsed = JSON.parse(rawPlan);
    if (!Array.isArray(parsed) || parsed.length > 20) throw new Error("bad_plan");
    plan = parsed.map((item: any) => ({
      chargeId: normalize(item?.chargeId),
      componentIds: Array.isArray(item?.componentIds)
        ? Array.from(
            new Set(
              item.componentIds.map((id: unknown) => normalize(id)).filter(Boolean),
            ),
          )
        : [],
    }));
  } catch {
    throw new Error("La sélection des options d'internat est invalide.");
  }

  for (const item of plan) {
    if (!item.chargeId) continue;
    await setStudentChargeOptionalComponents({
      institutionId,
      userId,
      studentId,
      chargeId: item.chargeId,
      selectedComponentIds: item.componentIds,
    });
  }

  revalidatePath("/admin/finance");
  revalidatePath("/admin/finance/payments");
  revalidatePath("/admin/finance/charges");
  revalidatePath("/admin/finance/reports");
  redirect(
    `/admin/finance/payments?student_id=${encodeURIComponent(studentId)}&class_id=${encodeURIComponent(classId)}&options_saved=1`,
  );
}

async function fetchAllChargeBalancesForPayments({
  institutionId,
  classIds,
}: {
  institutionId: string;
  classIds: string[];
}): Promise<ChargeBalanceRow[]> {
  const uniqueClassIds = Array.from(new Set(classIds.filter(Boolean)));
  if (uniqueClassIds.length === 0) return [];

  const admin = getSupabaseServiceClient();
  const pageSize = 1000;
  const rows: ChargeBalanceRow[] = [];

  // On filtre par classes affichées, pas par liste complète des élèves.
  // Cela évite une URL énorme avec plusieurs centaines de UUID student_id.
  for (const ids of chunkArray(uniqueClassIds, 50)) {
    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1;
      const { data, error } = await admin
        .schema("finance")
        .from("v_charge_balances")
        .select(
          "id,school_id,academic_year_id,student_id,class_id,fee_schedule_id,fee_category_id,label,base_amount,net_amount,paid_amount,balance_due,due_date,charge_date,computed_status,created_at,updated_at",
        )
        .eq("school_id", institutionId)
        .in("class_id", ids)
        .neq("computed_status", "cancelled")
        .order("due_date", { ascending: true, nullsFirst: false })
        .range(from, to);

      if (error) {
        throw new Error(
          `Lecture des dettes ouvertes impossible : ${error.message}`,
        );
      }

      const pageRows = (data ?? []) as ChargeBalanceRow[];
      rows.push(...pageRows);

      if (pageRows.length < pageSize) break;
    }
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
  searchParams?: Promise<{
    academic_year?: string;
    correction_receipt?: string;
    student_id?: string;
    class_id?: string;
    options_saved?: string;
  }>;
}) {
  const access = await getFinanceAccessForCurrentUser();

  if (!access.ok) {
    redirect("/admin/finance/locked");
  }

  const params = searchParams ? await searchParams : undefined;
  const requestedAcademicYear = String(params?.academic_year || "").trim();
  const correctionReceiptNo = String(params?.correction_receipt || "").trim();
  const correctionStudentId = String(params?.student_id || "").trim();
  const correctionClassId = String(params?.class_id || "").trim();
  const optionsSaved = String(params?.options_saved || "").trim() === "1";

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
  const feeCategoryMap = new Map(feeCategoryRows.map((row) => [row.id, row]));
  const classIds = classRows.map((row) => row.id);
  const classMap = new Map(classRows.map((c) => [c.id, c]));
  const classIdSet = new Set(classIds);

  const studentRows = adminStudents.filter((student) =>
    student.class_id ? classIdSet.has(student.class_id) : false,
  );
  const studentIds = studentRows.map((student) => student.id);

  const [{ data: balances, error: balErr }, { data: receipts, error: recErr }] =
    await Promise.all([
      classIds.length > 0
        ? fetchAllChargeBalancesForPayments({ institutionId, classIds })
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

  const [componentRows, paidComponentRows, selectedComponentRows] = await Promise.all([
    fetchActiveScheduleComponents(institutionId, balanceScheduleIds),
    fetchPaidComponentsForCharges(institutionId, balanceChargeIds),
    fetchSelectedComponentsForCharges(institutionId, balanceChargeIds),
  ]);

  const componentsBySchedule = new Map<string, FeeScheduleComponentRow[]>();
  for (const component of componentRows) {
    if (!componentsBySchedule.has(component.fee_schedule_id)) {
      componentsBySchedule.set(component.fee_schedule_id, []);
    }
    componentsBySchedule.get(component.fee_schedule_id)!.push(component);
  }

  const paidAmountsByChargeComponent = new Map<string, number>();
  for (const paid of paidComponentRows) {
    if (paid.receipt_status === "cancelled") continue;
    const key = `${paid.student_charge_id}:${paid.fee_schedule_component_id}`;
    paidAmountsByChargeComponent.set(
      key,
      (paidAmountsByChargeComponent.get(key) ?? 0) + Number(paid.amount || 0),
    );
  }

  const selectedOptionIdsByCharge = new Map<string, Set<string>>();
  for (const selected of selectedComponentRows) {
    if (!selectedOptionIdsByCharge.has(selected.student_charge_id)) {
      selectedOptionIdsByCharge.set(selected.student_charge_id, new Set());
    }
    selectedOptionIdsByCharge
      .get(selected.student_charge_id)!
      .add(selected.fee_schedule_component_id);
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
        const classBalances = studentBalances.filter(
          (row) =>
            row.class_id === student.class_id &&
            row.computed_status !== "cancelled",
        );
        const openCharges = classBalances.map((row) => {
          const allComponents = row.fee_schedule_id
            ? (componentsBySchedule.get(row.fee_schedule_id) ?? [])
            : [];
          const category = feeCategoryMap.get(row.fee_category_id);
          const isInternatCategory = isFinanceInternatCategory(category);
          const isScolariteCategory = isFinanceScolariteCategory(category);
          const componentDrivenBalance =
            isInternatCategory &&
            isInternatAnnexesCharge(row.label) &&
            allComponents.length > 0;

          let components: ChargeOptionRow["components"] = [];

          if (componentDrivenBalance) {
            const explicitPaidByComponent = new Map<string, number>();
            const explicitlyPaidOptionalIds = new Set<string>();

            for (const component of allComponents) {
              const paid = Math.min(
                paidAmountsByChargeComponent.get(
                  `${row.id}:${component.id}`,
                ) ?? 0,
                Number(component.amount || 0),
              );
              explicitPaidByComponent.set(component.id, paid);
              if (
                paid > 0 &&
                isOptionalInternatAnnexeComponent(component)
              ) {
                explicitlyPaidOptionalIds.add(component.id);
              }
            }

            const storedSelectedOptionIds =
              selectedOptionIdsByCharge.get(row.id) ?? new Set<string>();
            const engagedOptionalIds =
              storedSelectedOptionIds.size > 0
                ? new Set(storedSelectedOptionIds)
                : inferEngagedOptionalComponentIds({
                    components: allComponents.map((component) => ({
                      id: component.id,
                      label: component.label,
                      amount: component.amount,
                      is_optional: component.is_optional,
                    })),
                    currentExpectedAmount: Number(
                      row.net_amount || row.base_amount || 0,
                    ),
                    explicitlyPaidIds: explicitlyPaidOptionalIds,
                  });
            for (const id of explicitlyPaidOptionalIds) {
              engagedOptionalIds.add(id);
            }

            const effectivePaidByComponent = new Map(explicitPaidByComponent);
            const explicitPaidTotal = Array.from(
              explicitPaidByComponent.values(),
            ).reduce((sum, value) => sum + value, 0);
            let unattributedPaid = Math.max(
              Number(row.paid_amount || 0) - explicitPaidTotal,
              0,
            );

            // Les anciens reçus n'ont pas toujours de détail par sous-rubrique.
            // On affecte d'abord leur montant aux options déjà engagées, puis
            // au socle obligatoire, sans jamais créditer une option non choisie.
            const allocationPriority = [...allComponents].sort((a, b) => {
              const aOptionalEngaged =
                isOptionalInternatAnnexeComponent(a) &&
                engagedOptionalIds.has(a.id);
              const bOptionalEngaged =
                isOptionalInternatAnnexeComponent(b) &&
                engagedOptionalIds.has(b.id);
              if (aOptionalEngaged !== bOptionalEngaged) {
                return aOptionalEngaged ? -1 : 1;
              }
              return Number(a.order_index || 0) - Number(b.order_index || 0);
            });

            for (const component of allocationPriority) {
              const isOptional =
                isOptionalInternatAnnexeComponent(component);
              const isEngaged = !isOptional || engagedOptionalIds.has(component.id);
              if (!isEngaged || unattributedPaid <= 0) continue;

              const expected = Number(component.amount || 0);
              const alreadyAttributed =
                effectivePaidByComponent.get(component.id) ?? 0;
              const room = Math.max(expected - alreadyAttributed, 0);
              const attributed = Math.min(room, unattributedPaid);
              if (attributed > 0) {
                effectivePaidByComponent.set(
                  component.id,
                  alreadyAttributed + attributed,
                );
                unattributedPaid -= attributed;
              }
            }

            components = allComponents.map((component) => {
              const expected = Number(component.amount || 0);
              const isOptional =
                isOptionalInternatAnnexeComponent(component);
              const isEngaged =
                !isOptional || engagedOptionalIds.has(component.id);
              const paid = Math.min(
                effectivePaidByComponent.get(component.id) ?? 0,
                expected,
              );

              return {
                id: component.id,
                label: component.label,
                amount: expected,
                paid_amount: paid,
                remaining_amount: isEngaged
                  ? Math.max(expected - paid, 0)
                  : expected,
                is_optional: isOptional,
                is_engaged: isEngaged,
                order_index: Number(component.order_index || 0),
              };
            });
          }

          return {
            charge_id: row.id,
            fee_category_id: row.fee_category_id,
            fee_schedule_id: row.fee_schedule_id,
            label: row.label,
            due_date: row.due_date,
            net_amount: Number(row.net_amount || 0),
            paid_amount: Number(row.paid_amount || 0),
            balance_due: Math.max(Number(row.balance_due || 0), 0),
            // Les dettes soldées restent visibles. C'est indispensable pour
            // afficher toutes les rubriques d'internat et calculer le vrai
            // total global, au lieu de confondre total attendu et reste dû.
            components: isScolariteCategory ? [] : components,
          };
        });

        const isAffecte =
          typeof student.is_affecte === "boolean"
            ? student.is_affecte
            : null;
        const isBoarder =
          typeof student.is_boarder === "boolean"
            ? student.is_boarder
            : null;

        return {
          student_id: student.id,
          student_name: fullName(student),
          matricule: student.matricule ?? null,
          class_id: student.class_id,
          class_label: student.class_label || cls.label || "Sans classe",
          level: cls.level,
          academic_year: cls.academic_year,
          is_affecte: isAffecte,
          is_boarder: isBoarder,
          profile_complete: isAffecte !== null && isBoarder !== null,
          total_expected: openCharges.reduce(
            (sum, row) => sum + Number(row.net_amount || 0),
            0,
          ),
          total_due: openCharges.reduce(
            (sum, row) => sum + Number(row.balance_due || 0),
            0,
          ),
          total_paid: classBalances.reduce(
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
  // Même base de calcul que le tableau de bord financier :
  // on affiche le total réellement comptabilisé sur les dettes de l'année,
  // pas seulement la somme des 8 reçus récents affichés en bas de page.
  const totalCollected = balanceRows.reduce(
    (sum, row) => sum + Number(row.paid_amount || 0),
    0,
  );

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
          label="Total encaissé"
          value={formatMoney(totalCollected)}
          hint="Paiements comptabilisés"
        />
      </section>

      <PaymentsComposer
        action={createPaymentAction}
        optionsAction={updateInternatOptionsAction}
        classes={classRows}
        feeCategories={feeCategoryRows}
        rows={paymentStudentRows}
        initialClassId={correctionClassId}
        initialStudentId={correctionStudentId}
        correctionNotice={
          optionsSaved
            ? "Options d'internat enregistrées et dette recalculée depuis le barème configuré."
            : correctionReceiptNo
            ? `Le reçu ${correctionReceiptNo} a été annulé pour correction. Vous pouvez maintenant saisir le paiement corrigé.`
            : ""
        }
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
