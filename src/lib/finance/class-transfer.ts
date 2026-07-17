import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  financeComponentIsOptional,
  financeScheduleAppliesToStudent,
  financeScheduleKind,
  financeScheduleLabelForClass,
  normalizeFinanceText,
  selectFinanceSchedulesForClass,
  type FinanceClassLike,
  type FinanceFeeCategoryLike,
  type FinanceScheduleLike,
} from "@/lib/finance/charge-rules";

type ServiceClient = ReturnType<typeof getSupabaseServiceClient>;

type ClassRow = FinanceClassLike & {
  id: string;
  institution_id?: string | null;
};

type ScheduleRow = FinanceScheduleLike & {
  id: string;
  school_id: string;
  fee_category_id: string;
  is_active?: boolean | null;
};

type CategoryRow = FinanceFeeCategoryLike & {
  id: string;
};

type ChargeRow = {
  id: string;
  school_id: string;
  academic_year_id: string | null;
  academic_year: string | null;
  student_id: string;
  class_id: string | null;
  fee_schedule_id: string | null;
  fee_category_id: string;
  sync_key: string | null;
  label: string;
  base_amount: number | string;
  due_date: string | null;
  status: string;
  notes: string | null;
  updated_at: string;
};

type ChargeBalance = {
  id: string;
  paid_amount: number | string | null;
  balance_due: number | string | null;
  computed_status: string | null;
};

type ComponentRow = {
  id: string;
  fee_schedule_id: string;
  label: string;
  amount: number | string;
  order_index: number | null;
  is_active: boolean;
  is_optional?: boolean | null;
};

type SelectionRow = {
  school_id: string;
  student_charge_id: string;
  fee_schedule_component_id: string;
  selected_by: string | null;
  selected_at: string;
  created_at: string;
  updated_at: string;
};

type AllocationComponentRow = {
  id: string;
  receipt_allocation_id: string;
  student_charge_id: string;
  fee_schedule_component_id: string;
  label: string;
  amount: number | string;
  order_index: number | null;
  receipt_status: string | null;
};

type ChargeWithBalance = ChargeRow & {
  paid_amount: number;
  balance_due: number;
  computed_status: string;
};

type ChargeUpdate = {
  chargeId: string;
  targetClassId: string;
  targetSchedule: ScheduleRow | null;
  targetScheduleId: string | null;
  targetAmount: number;
  targetStatus: string;
  targetLabel: string;
  targetCategoryId: string;
  targetDueDate: string | null;
  notes: string;
};

type ComponentUpdate = {
  rowId: string;
  targetComponentId: string;
  targetLabel: string;
  targetOrderIndex: number;
};

type SelectionUpdate = {
  chargeId: string;
  sourceComponentId: string;
  targetComponentId: string;
  snapshot: SelectionRow;
};

export type FinanceClassTransferSummary = {
  attempted: boolean;
  source_class_ids: string[];
  moved_charges: number;
  retargeted_charges: number;
  cancelled_duplicates: number;
  preserved_paid_amount: number;
  component_links_moved: number;
  option_links_moved: number;
  warnings: string[];
};

export type AppliedFinanceClassTransfer = {
  summary: FinanceClassTransferSummary;
  rollback: () => Promise<void>;
};

function cleanId(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function amountsDiffer(a: unknown, b: unknown) {
  return Math.abs(numberValue(a) - numberValue(b)) > 0.01;
}

function isOptionalInternatComponent(label: string | null | undefined) {
  return financeComponentIsOptional({ label });
}

function statusForAmount(expectedAmount: number, paidAmount: number) {
  if (paidAmount >= expectedAmount - 0.01) return "paid";
  if (paidAmount > 0) return "partial";
  return "pending";
}

function classSuffixes(classes: ClassRow[]) {
  return Array.from(
    new Set(
      classes
        .flatMap((row) => [row.label, row.code])
        .map((value) => normalizeFinanceText(value))
        .filter(Boolean),
    ),
  ).sort((a, b) => b.length - a.length);
}

function neutralScheduleLabel(schedule: ScheduleRow, suffixes: string[]) {
  let label = normalizeFinanceText(schedule.label);

  for (const suffix of suffixes) {
    const marker = ` - ${suffix}`;
    if (label.endsWith(marker)) {
      label = label.slice(0, -marker.length).trim();
      break;
    }
  }

  return label;
}

function scheduleTransferKey(
  schedule: ScheduleRow,
  categoriesById: Map<string, CategoryRow>,
  suffixes: string[],
  includeDueDate: boolean,
) {
  const values = [
    financeScheduleKind(schedule, categoriesById),
    cleanId(schedule.fee_category_id),
    neutralScheduleLabel(schedule, suffixes),
  ];

  if (includeDueDate) values.push(cleanId(schedule.due_date));
  return values.join("|");
}

function groupByKey<T>(rows: T[], keyOf: (row: T) => string) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  return map;
}

function uniqueTargetSchedule({
  sourceSchedule,
  targetSchedules,
  categoriesById,
  suffixes,
}: {
  sourceSchedule: ScheduleRow;
  targetSchedules: ScheduleRow[];
  categoriesById: Map<string, CategoryRow>;
  suffixes: string[];
}) {
  const exactKey = scheduleTransferKey(
    sourceSchedule,
    categoriesById,
    suffixes,
    true,
  );
  const exact = targetSchedules.filter(
    (row) =>
      scheduleTransferKey(row, categoriesById, suffixes, true) === exactKey,
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(
      `Transfert financier impossible : plusieurs barèmes cibles correspondent à « ${sourceSchedule.label || "rubrique"} ».`,
    );
  }

  const looseKey = scheduleTransferKey(
    sourceSchedule,
    categoriesById,
    suffixes,
    false,
  );
  const loose = targetSchedules.filter(
    (row) =>
      scheduleTransferKey(row, categoriesById, suffixes, false) === looseKey,
  );
  if (loose.length === 1) return loose[0];
  if (loose.length > 1) {
    throw new Error(
      `Transfert financier impossible : plusieurs échéances cibles correspondent à « ${sourceSchedule.label || "rubrique"} ».`,
    );
  }

  return null;
}

function exactOptionalSubsetLabels({
  components,
  expectedTotal,
}: {
  components: ComponentRow[];
  expectedTotal: number;
}) {
  if (expectedTotal <= 0.01) return new Set<string>();
  if (components.length > 18) return null;

  const matches: Set<string>[] = [];
  const limit = 1 << components.length;

  for (let mask = 0; mask < limit; mask++) {
    let total = 0;
    const labels = new Set<string>();

    for (let index = 0; index < components.length; index++) {
      if ((mask & (1 << index)) === 0) continue;
      const component = components[index];
      total += numberValue(component.amount);
      labels.add(normalizeFinanceText(component.label));
    }

    if (Math.abs(total - expectedTotal) <= 0.01) matches.push(labels);
  }

  if (matches.length === 0) return null;

  // Quand plusieurs sous-ensembles donnent le même total, on ne devine pas :
  // seules les rubriques communes à toutes les solutions sont considérées sûres.
  const intersection = new Set(matches[0]);
  for (const match of matches.slice(1)) {
    for (const label of Array.from(intersection)) {
      if (!match.has(label)) intersection.delete(label);
    }
  }

  return intersection;
}

function engagedOptionalLabels({
  sourceCharge,
  sourceComponents,
  allocationComponents,
}: {
  sourceCharge: ChargeWithBalance;
  sourceComponents: ComponentRow[];
  allocationComponents: AllocationComponentRow[];
}) {
  const labels = new Set<string>();

  for (const row of allocationComponents) {
    if (row.receipt_status === "cancelled") continue;
    if (numberValue(row.amount) <= 0) continue;
    if (!isOptionalInternatComponent(row.label)) continue;
    labels.add(normalizeFinanceText(row.label));
  }

  const mandatoryTotal = sourceComponents
    .filter((component) => !financeComponentIsOptional(component))
    .reduce((sum, component) => sum + numberValue(component.amount), 0);
  const optionalComponents = sourceComponents.filter((component) =>
    financeComponentIsOptional(component),
  );
  const optionTotalInDebt = Math.max(
    numberValue(sourceCharge.base_amount) - mandatoryTotal,
    0,
  );
  const inferred = exactOptionalSubsetLabels({
    components: optionalComponents,
    expectedTotal: optionTotalInDebt,
  });

  for (const label of inferred ?? []) labels.add(label);

  return {
    labels,
    inferenceWasExact: inferred !== null || optionTotalInDebt <= 0.01,
  };
}

function targetAmountForCharge({
  sourceCharge,
  sourceSchedule,
  targetSchedule,
  componentsBySchedule,
  allocationsByCharge,
  warnings,
}: {
  sourceCharge: ChargeWithBalance;
  sourceSchedule: ScheduleRow;
  targetSchedule: ScheduleRow;
  componentsBySchedule: Map<string, ComponentRow[]>;
  allocationsByCharge: Map<string, AllocationComponentRow[]>;
  warnings: string[];
}) {
  const targetScheduleAmount = numberValue(targetSchedule.amount);
  const targetKind = financeScheduleKind(targetSchedule);

  const targetComponents = (
    componentsBySchedule.get(targetSchedule.id) ?? []
  ).filter((row) => row.is_active !== false);

  if (
    targetKind !== "internat" ||
    !normalizeFinanceText(targetSchedule.label).includes("annexe") ||
    targetComponents.length === 0
  ) {
    return Math.max(targetScheduleAmount, sourceCharge.paid_amount);
  }

  const sourceComponents =
    componentsBySchedule.get(sourceSchedule.id) ?? [];
  const engagement = engagedOptionalLabels({
    sourceCharge,
    sourceComponents,
    allocationComponents: allocationsByCharge.get(sourceCharge.id) ?? [],
  });

  const targetMandatory = targetComponents
    .filter((component) => !financeComponentIsOptional(component))
    .reduce((sum, component) => sum + numberValue(component.amount), 0);

  let targetOptions = 0;
  for (const label of engagement.labels) {
    const match = targetComponents.find(
      (component) => normalizeFinanceText(component.label) === label,
    );
    if (!match) {
      throw new Error(
        `Transfert financier impossible : l’option d’internat « ${label} » n’existe pas dans la classe cible.`,
      );
    }
    targetOptions += numberValue(match.amount);
  }

  const computed = targetMandatory + targetOptions;

  if (!engagement.inferenceWasExact) {
    warnings.push(
      `Le détail historique des options d’internat de « ${sourceCharge.label} » est incomplet ; le montant déjà facturé a été conservé sans diminution.`,
    );
  }

  return Math.max(
    computed > 0 ? computed : targetScheduleAmount,
    engagement.inferenceWasExact ? 0 : numberValue(sourceCharge.base_amount),
    sourceCharge.paid_amount,
  );
}

async function restoreChargeSnapshots(
  srv: ServiceClient,
  snapshots: ChargeRow[],
) {
  for (const row of snapshots) {
    await srv
      .schema("finance")
      .from("student_charges")
      .update({
        class_id: row.class_id,
        fee_schedule_id: row.fee_schedule_id,
        fee_category_id: row.fee_category_id,
        sync_key: row.sync_key,
        label: row.label,
        base_amount: row.base_amount,
        due_date: row.due_date,
        status: row.status,
        notes: row.notes,
        updated_at: row.updated_at,
      } as any)
      .eq("id", row.id)
      .eq("school_id", row.school_id);
  }
}

async function restoreComponentSnapshots(
  srv: ServiceClient,
  snapshots: AllocationComponentRow[],
) {
  for (const row of snapshots) {
    await srv
      .schema("finance")
      .from("receipt_allocation_components")
      .update({
        fee_schedule_component_id: row.fee_schedule_component_id,
        label: row.label,
        order_index: row.order_index ?? 0,
      } as any)
      .eq("id", row.id);
  }
}

async function restoreSelectionSnapshots(
  srv: ServiceClient,
  chargeIds: string[],
  snapshots: SelectionRow[],
) {
  if (chargeIds.length === 0) return;
  await srv
    .schema("finance")
    .from("student_charge_component_selections")
    .delete()
    .in("student_charge_id", chargeIds);
  if (snapshots.length > 0) {
    await srv
      .schema("finance")
      .from("student_charge_component_selections")
      .insert(snapshots as any[]);
  }
}

export async function transferStudentFinanceToClass({
  srv,
  institutionId,
  studentId,
  sourceClassIds,
  targetClass,
}: {
  srv: ServiceClient;
  institutionId: string;
  studentId: string;
  sourceClassIds: string[];
  targetClass: ClassRow;
}): Promise<AppliedFinanceClassTransfer> {
  const uniqueSourceClassIds = Array.from(
    new Set(sourceClassIds.map(cleanId).filter(Boolean)),
  ).filter((id) => id !== targetClass.id);

  const emptySummary: FinanceClassTransferSummary = {
    attempted: uniqueSourceClassIds.length > 0,
    source_class_ids: uniqueSourceClassIds,
    moved_charges: 0,
    retargeted_charges: 0,
    cancelled_duplicates: 0,
    preserved_paid_amount: 0,
    component_links_moved: 0,
    option_links_moved: 0,
    warnings: [],
  };

  if (uniqueSourceClassIds.length === 0) {
    return { summary: emptySummary, rollback: async () => undefined };
  }

  const targetAcademicYear = cleanId(targetClass.academic_year);
  if (!targetAcademicYear) {
    throw new Error(
      "Transfert financier impossible : l’année scolaire de la classe cible n’est pas renseignée.",
    );
  }

  const { data: studentProfile, error: profileErr } = await srv
    .from("students")
    .select("is_affecte,is_boarder")
    .eq("id", studentId)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (profileErr) throw new Error(profileErr.message);
  if (!studentProfile) throw new Error("Élève introuvable.");

  const [{ data: sourceChargesRaw, error: sourceChargeErr }, { data: targetChargesRaw, error: targetChargeErr }] =
    await Promise.all([
      srv
        .schema("finance")
        .from("student_charges")
        .select(
          "id,school_id,academic_year_id,academic_year,student_id,class_id,fee_schedule_id,fee_category_id,sync_key,label,base_amount,due_date,status,notes,updated_at",
        )
        .eq("school_id", institutionId)
        .eq("student_id", studentId)
        .eq("academic_year", targetAcademicYear)
        .in("class_id", uniqueSourceClassIds)
        .neq("status", "cancelled"),
      srv
        .schema("finance")
        .from("student_charges")
        .select(
          "id,school_id,academic_year_id,academic_year,student_id,class_id,fee_schedule_id,fee_category_id,sync_key,label,base_amount,due_date,status,notes,updated_at",
        )
        .eq("school_id", institutionId)
        .eq("student_id", studentId)
        .eq("academic_year", targetAcademicYear)
        .eq("class_id", targetClass.id)
        .neq("status", "cancelled"),
    ]);

  if (sourceChargeErr) throw new Error(sourceChargeErr.message);
  if (targetChargeErr) throw new Error(targetChargeErr.message);

  const sourceCharges = (sourceChargesRaw ?? []) as ChargeRow[];
  const targetCharges = (targetChargesRaw ?? []) as ChargeRow[];

  if (sourceCharges.length === 0) {
    return {
      summary: {
        ...emptySummary,
        warnings: [
          "Aucune dette active de l’ancienne classe n’était à transférer.",
        ],
      },
      rollback: async () => undefined,
    };
  }

  const isAffecte =
    typeof (studentProfile as any).is_affecte === "boolean"
      ? Boolean((studentProfile as any).is_affecte)
      : null;
  const isBoarder =
    typeof (studentProfile as any).is_boarder === "boolean"
      ? Boolean((studentProfile as any).is_boarder)
      : null;

  if (isAffecte === null || isBoarder === null) {
    throw new Error(
      "Transfert financier bloqué : renseignez Affecté/Non affecté et Interne/Externe avant le changement de classe.",
    );
  }

  const [{ data: classesRaw, error: classesErr }, { data: schedulesRaw, error: schedulesErr }, { data: categoriesRaw, error: categoriesErr }] =
    await Promise.all([
      srv
        .from("classes")
        .select("id,label,code,level,academic_year,official_track_code,institution_id")
        .eq("institution_id", institutionId)
        .range(0, 9999),
      srv
        .schema("finance")
        .from("fee_schedules")
        .select(
          "id,school_id,academic_year,class_id,fee_category_id,label,amount,due_date,is_active,created_at,updated_at,applies_when_affecte,applies_when_boarder,amount_mode,profile_group_key",
        )
        .eq("school_id", institutionId)
        .range(0, 9999),
      srv
        .schema("finance")
        .from("fee_categories")
        .select("id,code,name,is_mandatory")
        .eq("school_id", institutionId),
    ]);

  if (classesErr) throw new Error(classesErr.message);
  if (schedulesErr) throw new Error(schedulesErr.message);
  if (categoriesErr) throw new Error(categoriesErr.message);

  const classes = (classesRaw ?? []) as ClassRow[];
  const schedules = (schedulesRaw ?? []) as ScheduleRow[];
  const categories = (categoriesRaw ?? []) as CategoryRow[];
  const classesById = new Map(classes.map((row) => [row.id, row]));
  classesById.set(targetClass.id, targetClass);
  const categoriesById = new Map(categories.map((row) => [row.id, row]));
  const suffixes = classSuffixes(classes);

  const targetSchedules = selectFinanceSchedulesForClass({
    schedules: schedules.filter((row) => row.is_active !== false),
    targetClass,
    classesById,
    categoriesById,
  }).filter((schedule) =>
    financeScheduleAppliesToStudent(
      schedule,
      { is_affecte: isAffecte, is_boarder: isBoarder },
      categoriesById,
    ),
  ) as ScheduleRow[];

  const schedulesById = new Map(schedules.map((row) => [row.id, row]));

  const allChargeRows = [...sourceCharges, ...targetCharges];
  const allChargeIds = allChargeRows.map((row) => row.id);

  const { data: balancesRaw, error: balancesErr } = await srv
    .schema("finance")
    .from("v_charge_balances")
    .select("id,paid_amount,balance_due,computed_status")
    .eq("school_id", institutionId)
    .in("id", allChargeIds);

  if (balancesErr) throw new Error(balancesErr.message);

  const balancesById = new Map(
    ((balancesRaw ?? []) as ChargeBalance[]).map((row) => [row.id, row]),
  );

  const withBalance = (row: ChargeRow): ChargeWithBalance => {
    const balance = balancesById.get(row.id);
    return {
      ...row,
      paid_amount: numberValue(balance?.paid_amount),
      balance_due: numberValue(balance?.balance_due),
      computed_status: String(balance?.computed_status || row.status || ""),
    };
  };

  const sourceWithBalance = sourceCharges.map(withBalance);
  const targetWithBalance = targetCharges.map(withBalance);
  const warnings: string[] = [];

  const sourceScheduleIds = sourceWithBalance
    .map((row) => cleanId(row.fee_schedule_id))
    .filter(Boolean);
  const targetScheduleIds = targetSchedules.map((row) => row.id);
  const componentScheduleIds = Array.from(
    new Set([...sourceScheduleIds, ...targetScheduleIds]),
  );

  const [
    { data: componentsRaw, error: componentsErr },
    { data: allocationComponentsRaw, error: allocationComponentsErr },
    { data: selectionsRaw, error: selectionsErr },
  ] =
    await Promise.all([
      componentScheduleIds.length
        ? srv
            .schema("finance")
            .from("fee_schedule_components")
            .select("id,fee_schedule_id,label,amount,order_index,is_active,is_optional")
            .eq("school_id", institutionId)
            .in("fee_schedule_id", componentScheduleIds)
        : Promise.resolve({ data: [], error: null } as any),
      allChargeIds.length
        ? srv
            .schema("finance")
            .from("v_receipt_allocation_components")
            .select(
              "id,receipt_allocation_id,student_charge_id,fee_schedule_component_id,label,amount,order_index,receipt_status",
            )
            .eq("school_id", institutionId)
            .in("student_charge_id", allChargeIds)
        : Promise.resolve({ data: [], error: null } as any),
      allChargeIds.length
        ? srv
            .schema("finance")
            .from("student_charge_component_selections")
            .select(
              "school_id,student_charge_id,fee_schedule_component_id,selected_by,selected_at,created_at,updated_at",
            )
            .eq("school_id", institutionId)
            .in("student_charge_id", allChargeIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

  if (componentsErr) throw new Error(componentsErr.message);
  if (allocationComponentsErr) throw new Error(allocationComponentsErr.message);
  if (selectionsErr) throw new Error(selectionsErr.message);

  const components = (componentsRaw ?? []) as ComponentRow[];
  const allocationComponents =
    (allocationComponentsRaw ?? []) as AllocationComponentRow[];
  const selections = (selectionsRaw ?? []) as SelectionRow[];
  const componentsBySchedule = groupByKey(
    components,
    (row) => row.fee_schedule_id,
  );
  const allocationsByCharge = groupByKey(
    allocationComponents,
    (row) => row.student_charge_id,
  );
  const selectionsByCharge = groupByKey(
    selections,
    (row) => row.student_charge_id,
  );

  type Candidate = {
    origin: "source" | "target";
    charge: ChargeWithBalance;
    targetSchedule: ScheduleRow | null;
  };

  const candidatesByDestination = new Map<string, Candidate[]>();
  const manualCandidates: Candidate[] = [];

  for (const charge of sourceWithBalance) {
    const sourceSchedule = charge.fee_schedule_id
      ? schedulesById.get(charge.fee_schedule_id)
      : null;

    if (!sourceSchedule) {
      manualCandidates.push({
        origin: "source",
        charge,
        targetSchedule: null,
      });
      continue;
    }

    const targetSchedule = uniqueTargetSchedule({
      sourceSchedule,
      targetSchedules,
      categoriesById,
      suffixes,
    });

    if (!targetSchedule) {
      const kind = financeScheduleKind(sourceSchedule, categoriesById);
      if (kind === "scolarite" || kind === "internat") {
        throw new Error(
          `Transfert financier bloqué : aucun barème équivalent à « ${charge.label} » n’est disponible dans ${targetClass.label || "la classe cible"}.`,
        );
      }

      manualCandidates.push({
        origin: "source",
        charge,
        targetSchedule: null,
      });
      continue;
    }

    const key = `schedule:${targetSchedule.id}`;
    candidatesByDestination.set(key, [
      ...(candidatesByDestination.get(key) ?? []),
      { origin: "source", charge, targetSchedule },
    ]);
  }

  for (const charge of targetWithBalance) {
    const targetSchedule = charge.fee_schedule_id
      ? targetSchedules.find((row) => row.id === charge.fee_schedule_id) ?? null
      : null;

    if (targetSchedule) {
      const key = `schedule:${targetSchedule.id}`;
      candidatesByDestination.set(key, [
        ...(candidatesByDestination.get(key) ?? []),
        { origin: "target", charge, targetSchedule },
      ]);
    } else {
      manualCandidates.push({
        origin: "target",
        charge,
        targetSchedule: null,
      });
    }
  }

  const manualGroups = groupByKey(
    manualCandidates,
    (candidate) =>
      `manual:${candidate.charge.fee_category_id}|${normalizeFinanceText(candidate.charge.label)}`,
  );
  for (const [key, candidates] of manualGroups) {
    candidatesByDestination.set(key, candidates);
  }

  const chargeUpdates: ChargeUpdate[] = [];
  const duplicateChargeIds = new Set<string>();
  const canonicalSourceUpdates: Array<{
    charge: ChargeWithBalance;
    sourceSchedule: ScheduleRow | null;
    targetSchedule: ScheduleRow | null;
  }> = [];

  for (const candidates of candidatesByDestination.values()) {
    const paidCandidates = candidates.filter(
      (candidate) => candidate.charge.paid_amount > 0.01,
    );

    if (paidCandidates.length > 1) {
      throw new Error(
        `Transfert financier bloqué : plusieurs dettes déjà encaissées correspondent à « ${candidates[0]?.charge.label || "une même rubrique"} ». Une régularisation manuelle est nécessaire avant le transfert.`,
      );
    }

    const canonical =
      paidCandidates[0] ??
      candidates.find(
        (candidate) =>
          candidate.origin === "source" &&
          (selectionsByCharge.get(candidate.charge.id) ?? []).length > 0,
      ) ??
      candidates.find((candidate) => candidate.origin === "target") ??
      [...candidates].sort((a, b) =>
        String(b.charge.updated_at || "").localeCompare(
          String(a.charge.updated_at || ""),
        ),
      )[0];

    for (const candidate of candidates) {
      if (candidate.charge.id === canonical.charge.id) continue;
      if (candidate.charge.paid_amount > 0.01) {
        throw new Error(
          `Transfert financier bloqué : la dette « ${candidate.charge.label} » contient un encaissement concurrent.`,
        );
      }
      duplicateChargeIds.add(candidate.charge.id);
    }

    if (canonical.origin === "target") continue;

    const sourceSchedule = canonical.charge.fee_schedule_id
      ? schedulesById.get(canonical.charge.fee_schedule_id) ?? null
      : null;
    const targetSchedule = canonical.targetSchedule;

    let targetAmount = numberValue(canonical.charge.base_amount);
    let targetLabel = canonical.charge.label;
    let targetCategoryId = canonical.charge.fee_category_id;
    let targetDueDate = canonical.charge.due_date;

    if (targetSchedule && sourceSchedule) {
      targetAmount = targetAmountForCharge({
        sourceCharge: canonical.charge,
        sourceSchedule,
        targetSchedule,
        componentsBySchedule,
        allocationsByCharge,
        warnings,
      });
      targetLabel =
        financeScheduleLabelForClass(
          targetSchedule,
          targetClass,
          classesById,
        ) ||
        String(targetSchedule.label || canonical.charge.label);
      targetCategoryId = targetSchedule.fee_category_id;
      targetDueDate = targetSchedule.due_date
        ? String(targetSchedule.due_date)
        : null;
    } else {
      targetAmount = Math.max(
        numberValue(canonical.charge.base_amount),
        canonical.charge.paid_amount,
      );
    }

    const targetStatus = statusForAmount(
      targetAmount,
      canonical.charge.paid_amount,
    );

    chargeUpdates.push({
      chargeId: canonical.charge.id,
      targetClassId: targetClass.id,
      targetSchedule,
      targetScheduleId: targetSchedule?.id ?? canonical.charge.fee_schedule_id,
      targetAmount,
      targetStatus,
      targetLabel,
      targetCategoryId,
      targetDueDate,
      notes: [
        canonical.charge.notes,
        `Transfert de classe vers ${targetClass.label || targetClass.code || targetClass.id} : dette et encaissements conservés.`,
      ]
        .filter(Boolean)
        .join(" "),
    });

    canonicalSourceUpdates.push({
      charge: canonical.charge,
      sourceSchedule,
      targetSchedule,
    });
  }

  const componentUpdates: ComponentUpdate[] = [];
  const selectionUpdates: SelectionUpdate[] = [];
  const componentsById = new Map(components.map((row) => [row.id, row]));

  for (const item of canonicalSourceUpdates) {
    if (!item.sourceSchedule || !item.targetSchedule) continue;
    if (item.sourceSchedule.id === item.targetSchedule.id) continue;

    const targetComponents = (
      componentsBySchedule.get(item.targetSchedule.id) ?? []
    ).filter((row) => row.is_active !== false);
    const targetByLabel = new Map(
      targetComponents.map((row) => [normalizeFinanceText(row.label), row]),
    );

    const activeAllocationRows = (
      allocationsByCharge.get(item.charge.id) ?? []
    ).filter(
      (row) =>
        row.receipt_status !== "cancelled" && numberValue(row.amount) > 0,
    );

    const destinationKeys = new Set<string>();

    for (const row of activeAllocationRows) {
      const targetComponent = targetByLabel.get(
        normalizeFinanceText(row.label),
      );
      if (!targetComponent) {
        throw new Error(
          `Transfert financier bloqué : la sous-rubrique « ${row.label} » n’existe pas dans le barème d’internat de la classe cible.`,
        );
      }

      const destinationKey = `${row.receipt_allocation_id}:${targetComponent.id}`;
      if (destinationKeys.has(destinationKey)) {
        throw new Error(
          `Transfert financier bloqué : deux sous-rubriques historiques convergent vers « ${targetComponent.label} ».`,
        );
      }
      destinationKeys.add(destinationKey);

      if (row.fee_schedule_component_id === targetComponent.id) continue;

      componentUpdates.push({
        rowId: row.id,
        targetComponentId: targetComponent.id,
        targetLabel: targetComponent.label,
        targetOrderIndex: numberValue(targetComponent.order_index),
      });
    }

    for (const selection of selectionsByCharge.get(item.charge.id) ?? []) {
      const sourceComponent = componentsById.get(
        selection.fee_schedule_component_id,
      );
      if (!sourceComponent) {
        throw new Error(
          "Transfert financier bloqué : une option d’internat sélectionnée ne correspond plus au barème source.",
        );
      }

      const targetComponent = targetByLabel.get(
        normalizeFinanceText(sourceComponent.label),
      );
      if (!targetComponent || !financeComponentIsOptional(targetComponent)) {
        throw new Error(
          `Transfert financier bloqué : l’option « ${sourceComponent.label} » n’existe pas comme option dans le barème cible.`,
        );
      }

      if (sourceComponent.id === targetComponent.id) continue;
      selectionUpdates.push({
        chargeId: item.charge.id,
        sourceComponentId: sourceComponent.id,
        targetComponentId: targetComponent.id,
        snapshot: selection,
      });
    }
  }

  const chargeSnapshotIds = Array.from(
    new Set([
      ...chargeUpdates.map((row) => row.chargeId),
      ...Array.from(duplicateChargeIds),
    ]),
  );
  const chargeSnapshots = allChargeRows.filter((row) =>
    chargeSnapshotIds.includes(row.id),
  );
  const componentSnapshotIds = new Set(
    componentUpdates.map((row) => row.rowId),
  );
  const componentSnapshots = allocationComponents.filter((row) =>
    componentSnapshotIds.has(row.id),
  );
  const selectionChargeIds = Array.from(
    new Set(selectionUpdates.map((row) => row.chargeId)),
  );
  const selectionSnapshots = selections.filter((row) =>
    selectionChargeIds.includes(row.student_charge_id),
  );

  let rolledBack = false;
  const rollback = async () => {
    if (rolledBack) return;
    await restoreComponentSnapshots(srv, componentSnapshots);
    await restoreChargeSnapshots(srv, chargeSnapshots);
    await restoreSelectionSnapshots(
      srv,
      selectionChargeIds,
      selectionSnapshots,
    );
    rolledBack = true;
  };

  try {
    for (const chargeId of duplicateChargeIds) {
      const { error } = await srv
        .schema("finance")
        .from("student_charges")
        .update({
          status: "cancelled",
          notes:
            "Dette doublon sans encaissement annulée automatiquement lors d’un transfert de classe.",
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", chargeId)
        .eq("school_id", institutionId);

      if (error) throw new Error(error.message);
    }

    for (const update of chargeUpdates) {
      const { error } = await srv
        .schema("finance")
        .from("student_charges")
        .update({
          class_id: update.targetClassId,
          fee_schedule_id: update.targetScheduleId,
          fee_category_id: update.targetCategoryId,
          sync_key: update.targetScheduleId,
          label: update.targetLabel,
          base_amount: update.targetAmount,
          due_date: update.targetDueDate,
          status: update.targetStatus,
          notes: update.notes,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", update.chargeId)
        .eq("school_id", institutionId);

      if (error) throw new Error(error.message);
    }

    for (const update of componentUpdates) {
      const { error } = await srv
        .schema("finance")
        .from("receipt_allocation_components")
        .update({
          fee_schedule_component_id: update.targetComponentId,
          label: update.targetLabel,
          order_index: update.targetOrderIndex,
        } as any)
        .eq("id", update.rowId);

      if (error) throw new Error(error.message);
    }

    for (const update of selectionUpdates) {
      const { error: upsertError } = await srv
        .schema("finance")
        .from("student_charge_component_selections")
        .upsert(
          {
            ...update.snapshot,
            student_charge_id: update.chargeId,
            fee_schedule_component_id: update.targetComponentId,
            updated_at: new Date().toISOString(),
          } as any,
          {
            onConflict: "student_charge_id,fee_schedule_component_id",
          },
        );

      if (upsertError) throw new Error(upsertError.message);

      const { error: deleteError } = await srv
        .schema("finance")
        .from("student_charge_component_selections")
        .delete()
        .eq("student_charge_id", update.chargeId)
        .eq("fee_schedule_component_id", update.sourceComponentId);

      if (deleteError) throw new Error(deleteError.message);
    }
  } catch (error) {
    await rollback();
    throw error;
  }

  const preservedPaidAmount = canonicalSourceUpdates.reduce(
    (sum, item) => sum + item.charge.paid_amount,
    0,
  );

  return {
    summary: {
      attempted: true,
      source_class_ids: uniqueSourceClassIds,
      moved_charges: chargeUpdates.length,
      retargeted_charges: chargeUpdates.filter(
        (row) => row.targetSchedule !== null,
      ).length,
      cancelled_duplicates: duplicateChargeIds.size,
      preserved_paid_amount: preservedPaidAmount,
      component_links_moved: componentUpdates.length,
      option_links_moved: selectionUpdates.length,
      warnings: Array.from(new Set(warnings)),
    },
    rollback,
  };
}
