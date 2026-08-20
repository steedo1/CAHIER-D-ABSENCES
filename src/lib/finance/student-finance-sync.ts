import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  buildFinanceScheduleCoverageWarning,
  financeComponentIsOptional,
  financeExpectedAmountFromComponents,
  financeScheduleAppliesToStudent,
  financeScheduleKind,
  financeScheduleLabelForClass,
  financeScheduleProfileVariantKey,
  financeScheduleSemanticKey,
  inferFinanceOptionalComponentIds,
  normalizeFinanceText,
  selectFinanceSchedulesForClass,
  type FinanceClassLike,
  type FinanceFeeCategoryLike,
  type FinanceScheduleComponentLike,
  type FinanceScheduleLike,
  type FinanceStudentProfileLike,
} from "@/lib/finance/charge-rules";
import {
  transferStudentFinanceToClass,
  type AppliedFinanceClassTransfer,
  type FinanceClassTransferSummary,
} from "@/lib/finance/class-transfer";

type ServiceClient = ReturnType<typeof getSupabaseServiceClient>;

type ClassRow = FinanceClassLike & {
  id: string;
  institution_id?: string | null;
};

type CategoryRow = FinanceFeeCategoryLike & { id: string };

type ScheduleRow = FinanceScheduleLike & {
  id: string;
  school_id: string;
  fee_category_id: string;
  is_active?: boolean | null;
  notes?: string | null;
};

type ComponentRow = FinanceScheduleComponentLike & {
  id: string;
  fee_schedule_id: string;
  label: string;
  amount: number | string;
  order_index?: number | null;
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
  charge_date: string;
  status: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ChargeBalanceRow = {
  id: string;
  paid_amount: number | string | null;
  balance_due: number | string | null;
  computed_status: string | null;
};

type ChargeState = ChargeRow & {
  paid_amount: number;
  balance_due: number;
  computed_status: string;
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

type PaidComponentRow = {
  student_charge_id: string;
  fee_schedule_component_id: string;
  label: string | null;
  amount: number | string | null;
  receipt_status: string | null;
};

export type FinanceSyncResult = {
  inserted: number;
  reactivated: number;
  cancelled: number;
  cancelled_duplicates: number;
  preserved_paid_amount: number;
  updated_amount: number;
  retargeted: number;
  option_links_created: number;
  warnings: string[];
};

export type AppliedFinanceReconciliation = {
  summary: FinanceSyncResult;
  rollback: () => Promise<void>;
};

export type AppliedStudentFinanceSynchronization = {
  transfer: FinanceClassTransferSummary;
  reconciliation: FinanceSyncResult;
  rollback: () => Promise<void>;
};

function cleanId(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusForAmount(expectedAmount: number, paidAmount: number) {
  if (paidAmount >= expectedAmount - 0.01) return "paid";
  if (paidAmount > 0) return "partial";
  return "pending";
}

function groupBy<T>(rows: T[], keyOf: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

function emptySyncResult(): FinanceSyncResult {
  return {
    inserted: 0,
    reactivated: 0,
    cancelled: 0,
    cancelled_duplicates: 0,
    preserved_paid_amount: 0,
    updated_amount: 0,
    retargeted: 0,
    option_links_created: 0,
    warnings: [],
  };
}

async function academicYearId(
  srv: ServiceClient,
  institutionId: string,
  academicYear: string | null,
) {
  if (!academicYear) return null;
  const { data, error } = await srv
    .from("academic_years")
    .select("id")
    .eq("institution_id", institutionId)
    .eq("code", academicYear)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}

async function restoreChargeSnapshots(srv: ServiceClient, rows: ChargeRow[]) {
  for (const row of rows) {
    await srv
      .schema("finance")
      .from("student_charges")
      .update({
        academic_year_id: row.academic_year_id,
        academic_year: row.academic_year,
        class_id: row.class_id,
        fee_schedule_id: row.fee_schedule_id,
        fee_category_id: row.fee_category_id,
        sync_key: row.sync_key,
        label: row.label,
        base_amount: row.base_amount,
        due_date: row.due_date,
        charge_date: row.charge_date,
        status: row.status,
        notes: row.notes,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
      } as any)
      .eq("id", row.id)
      .eq("school_id", row.school_id);
  }
}

async function restoreSelectionSnapshots(
  srv: ServiceClient,
  chargeIds: string[],
  rows: SelectionRow[],
) {
  if (chargeIds.length === 0) return;
  await srv
    .schema("finance")
    .from("student_charge_component_selections")
    .delete()
    .in("student_charge_id", chargeIds);

  if (rows.length > 0) {
    await srv
      .schema("finance")
      .from("student_charge_component_selections")
      .insert(rows as any[]);
  }
}

export async function applyStudentFinanceReconciliation({
  srv = getSupabaseServiceClient(),
  institutionId,
  userId,
  studentId,
  classId,
  studentProfile,
}: {
  srv?: ServiceClient;
  institutionId: string;
  userId: string | null;
  studentId: string;
  classId: string;
  studentProfile?: FinanceStudentProfileLike | null;
}): Promise<AppliedFinanceReconciliation> {
  const summary = emptySyncResult();

  const [classResult, studentResult, schedulesResult, classesResult, categoriesResult] =
    await Promise.all([
      srv
        .from("classes")
        .select("id,label,code,level,academic_year,official_track_code,institution_id")
        .eq("id", classId)
        .eq("institution_id", institutionId)
        .maybeSingle(),
      srv
        .from("students")
        .select("id,is_affecte,is_boarder")
        .eq("id", studentId)
        .eq("institution_id", institutionId)
        .maybeSingle(),
      srv
        .schema("finance")
        .from("fee_schedules")
        .select(
          "id,school_id,academic_year,class_id,fee_category_id,label,amount,due_date,is_active,notes,created_at,updated_at,applies_when_affecte,applies_when_boarder,amount_mode,profile_group_key",
        )
        .eq("school_id", institutionId)
        .eq("is_active", true)
        .range(0, 9999),
      srv
        .from("classes")
        .select("id,label,code,level,academic_year,official_track_code,institution_id")
        .eq("institution_id", institutionId)
        .range(0, 9999),
      srv
        .schema("finance")
        .from("fee_categories")
        .select("id,code,name,is_mandatory")
        .eq("school_id", institutionId),
    ]);

  for (const error of [
    classResult.error,
    studentResult.error,
    schedulesResult.error,
    classesResult.error,
    categoriesResult.error,
  ]) {
    if (error) throw new Error(error.message);
  }

  if (!classResult.data) throw new Error("Classe introuvable.");
  if (!studentResult.data) throw new Error("Élève introuvable.");

  const targetClass = classResult.data as ClassRow;
  const storedProfile = studentResult.data as FinanceStudentProfileLike;
  const profile: FinanceStudentProfileLike = {
    is_affecte:
      typeof studentProfile?.is_affecte === "boolean"
        ? studentProfile.is_affecte
        : typeof storedProfile.is_affecte === "boolean"
          ? storedProfile.is_affecte
          : null,
    is_boarder:
      typeof studentProfile?.is_boarder === "boolean"
        ? studentProfile.is_boarder
        : typeof storedProfile.is_boarder === "boolean"
          ? storedProfile.is_boarder
          : null,
  };

  const classes = (classesResult.data ?? []) as ClassRow[];
  const categories = (categoriesResult.data ?? []) as CategoryRow[];
  const classesById = new Map(classes.map((row) => [row.id, row]));
  classesById.set(targetClass.id, targetClass);
  const categoriesById = new Map(categories.map((row) => [row.id, row]));

  const schedules = (schedulesResult.data ?? []) as ScheduleRow[];
  const selectedSchedules = selectFinanceSchedulesForClass({
    schedules,
    targetClass,
    classesById,
    categoriesById,
  });

  summary.warnings.push(
    ...buildFinanceScheduleCoverageWarning({
      schedules: selectedSchedules,
      categoriesById,
      studentProfile: profile,
      classLabel: targetClass.label,
    }),
  );

  if (selectedSchedules.length === 0) {
    summary.warnings.push(
      `Aucun barème actif n'est disponible pour ${targetClass.label || "cette classe"}.`,
    );
    return { summary, rollback: async () => undefined };
  }

  const missingProfileWarnings: string[] = [];
  const normalizedScheduleLabels = selectedSchedules.map((schedule) =>
    normalizeFinanceText(schedule.label),
  );
  const requiresAffectation = selectedSchedules.some(
    (schedule, index) =>
      typeof schedule.applies_when_affecte === "boolean" ||
      normalizedScheduleLabels[index].includes("affecte"),
  );
  const requiresBoarding = selectedSchedules.some(
    (schedule) =>
      typeof schedule.applies_when_boarder === "boolean" ||
      financeScheduleKind(schedule, categoriesById) === "internat",
  );

  if (requiresAffectation && profile.is_affecte === null) {
    missingProfileWarnings.push(
      "Affecté/Non affecté non renseigné : seuls les frais indépendants de ce statut peuvent être générés.",
    );
  }
  if (requiresBoarding && profile.is_boarder === null) {
    missingProfileWarnings.push(
      "Interne/Externe non renseigné : les frais d'internat sont ignorés tant que ce statut n'est pas précisé.",
    );
  }
  summary.warnings.push(...missingProfileWarnings);

  const scheduleIds = selectedSchedules.map((row) => row.id);
  const academicYear = cleanId(targetClass.academic_year) || null;
  const yearId = await academicYearId(srv, institutionId, academicYear);

  const [componentsResult, chargesResult] = await Promise.all([
    srv
      .schema("finance")
      .from("fee_schedule_components")
      .select(
        "id,fee_schedule_id,label,amount,order_index,is_optional,is_active",
      )
      .eq("school_id", institutionId)
      .eq("is_active", true)
      .in("fee_schedule_id", scheduleIds),
    srv
      .schema("finance")
      .from("student_charges")
      .select(
        "id,school_id,academic_year_id,academic_year,student_id,class_id,fee_schedule_id,fee_category_id,sync_key,label,base_amount,due_date,charge_date,status,notes,created_by,created_at,updated_at",
      )
      .eq("school_id", institutionId)
      .eq("student_id", studentId)
      .eq("class_id", classId)
      .order("updated_at", { ascending: false }),
  ]);

  if (componentsResult.error) throw new Error(componentsResult.error.message);
  if (chargesResult.error) throw new Error(chargesResult.error.message);

  const components = (componentsResult.data ?? []) as ComponentRow[];
  const componentsBySchedule = groupBy(components, (row) => row.fee_schedule_id);
  const rawCharges = ((chargesResult.data ?? []) as ChargeRow[]).filter((row) => {
    const rowYear = cleanId(row.academic_year);
    return !academicYear || !rowYear || rowYear === academicYear;
  });
  const chargeIds = rawCharges.map((row) => row.id);

  // Une dette déjà créée peut encore pointer vers un ancien UUID de barème
  // (barème recréé, catégorie recréée, ancien doublon, etc.). On recharge ces
  // barèmes historiques pour reconnaître la rubrique métier avant de décider
  // d'insérer une nouvelle dette. C'est le point clé pour rendre les passages
  // Externe -> Interne -> Externe -> Interne réellement idempotents.
  const selectedScheduleIds = new Set(scheduleIds);
  const historicalScheduleIds = Array.from(
    new Set(
      rawCharges
        .map((row) => cleanId(row.fee_schedule_id))
        .filter((id) => Boolean(id) && !selectedScheduleIds.has(id)),
    ),
  );

  let historicalSchedules: ScheduleRow[] = [];
  if (historicalScheduleIds.length > 0) {
    const { data: historicalScheduleRows, error: historicalScheduleError } = await srv
      .schema("finance")
      .from("fee_schedules")
      .select(
        "id,school_id,academic_year,class_id,fee_category_id,label,amount,due_date,is_active,notes,created_at,updated_at,applies_when_affecte,applies_when_boarder,amount_mode,profile_group_key",
      )
      .eq("school_id", institutionId)
      .in("id", historicalScheduleIds);

    if (historicalScheduleError) throw new Error(historicalScheduleError.message);
    historicalSchedules = (historicalScheduleRows ?? []) as ScheduleRow[];
  }

  const schedulesByIdForExistingCharges = new Map<string, ScheduleRow>();
  for (const schedule of [...schedules, ...historicalSchedules]) {
    schedulesByIdForExistingCharges.set(schedule.id, schedule);
  }

  const [balancesResult, selectionsResult, paidComponentsResult] = await Promise.all([
    chargeIds.length
      ? srv
          .schema("finance")
          .from("v_charge_balances")
          .select("id,paid_amount,balance_due,computed_status")
          .eq("school_id", institutionId)
          .in("id", chargeIds)
      : Promise.resolve({ data: [], error: null } as any),
    chargeIds.length
      ? srv
          .schema("finance")
          .from("student_charge_component_selections")
          .select(
            "school_id,student_charge_id,fee_schedule_component_id,selected_by,selected_at,created_at,updated_at",
          )
          .eq("school_id", institutionId)
          .in("student_charge_id", chargeIds)
      : Promise.resolve({ data: [], error: null } as any),
    chargeIds.length
      ? srv
          .schema("finance")
          .from("v_receipt_allocation_components")
          .select(
            "student_charge_id,fee_schedule_component_id,label,amount,receipt_status",
          )
          .eq("school_id", institutionId)
          .in("student_charge_id", chargeIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  if (balancesResult.error) throw new Error(balancesResult.error.message);
  if (selectionsResult.error) throw new Error(selectionsResult.error.message);
  if (paidComponentsResult.error) throw new Error(paidComponentsResult.error.message);

  const balanceById = new Map(
    ((balancesResult.data ?? []) as ChargeBalanceRow[]).map((row) => [row.id, row]),
  );
  const charges: ChargeState[] = rawCharges.map((row) => {
    const balance = balanceById.get(row.id);
    return {
      ...row,
      paid_amount: numberValue(balance?.paid_amount),
      balance_due: numberValue(balance?.balance_due),
      computed_status: cleanId(balance?.computed_status || row.status),
    };
  });

  const selectionRows = (selectionsResult.data ?? []) as SelectionRow[];
  const selectionsByCharge = groupBy(selectionRows, (row) => row.student_charge_id);
  const paidComponents = (paidComponentsResult.data ?? []) as PaidComponentRow[];
  const paidComponentsByCharge = groupBy(
    paidComponents.filter(
      (row) => row.receipt_status !== "cancelled" && numberValue(row.amount) > 0,
    ),
    (row) => row.student_charge_id,
  );

  const selectedBySemanticKey = new Map<string, ScheduleRow>();
  for (const schedule of selectedSchedules) {
    selectedBySemanticKey.set(
      financeScheduleSemanticKey(
        schedule,
        targetClass,
        classesById,
        categoriesById,
      ),
      schedule,
    );
  }

  const retargetedChargeIds = new Set<string>();
  const chargesBySchedule = new Map<string, ChargeState[]>();

  for (const charge of charges) {
    const sourceScheduleId = cleanId(charge.fee_schedule_id);
    if (!sourceScheduleId) continue;

    const storedSchedule = schedulesByIdForExistingCharges.get(sourceScheduleId);
    const sourceSchedule: ScheduleRow =
      storedSchedule ??
      ({
        id: sourceScheduleId,
        school_id: institutionId,
        academic_year: charge.academic_year,
        class_id: charge.class_id,
        fee_category_id: charge.fee_category_id,
        label: charge.label,
        amount: charge.base_amount,
        due_date: charge.due_date,
        amount_mode: "fixed",
      } as ScheduleRow);

    const semanticKey = financeScheduleSemanticKey(
      sourceSchedule,
      targetClass,
      classesById,
      categoriesById,
    );
    const canonicalSchedule = selectedBySemanticKey.get(semanticKey);

    // Pour un barème variable à sous-rubriques, changer silencieusement l'UUID
    // du barème nécessiterait aussi de migrer les liens de composants des reçus.
    // Ce moteur laisse donc ce cas au flux spécialisé de transfert ; la
    // réparation sémantique automatique ci-dessous reste limitée aux frais fixes.
    let resolvedScheduleId = sourceScheduleId;
    if (
      canonicalSchedule &&
      (canonicalSchedule.id === sourceScheduleId ||
        (sourceSchedule.amount_mode !== "components" &&
          canonicalSchedule.amount_mode !== "components"))
    ) {
      resolvedScheduleId = canonicalSchedule.id;
    }

    if (!selectedScheduleIds.has(resolvedScheduleId)) continue;

    if (resolvedScheduleId !== sourceScheduleId) {
      retargetedChargeIds.add(charge.id);
    }

    chargesBySchedule.set(resolvedScheduleId, [
      ...(chargesBySchedule.get(resolvedScheduleId) ?? []),
      charge,
    ]);
  }

  const existingBySchedule = new Map<string, ChargeState>();
  const duplicateIds = new Set<string>();

  for (const [scheduleId, group] of chargesBySchedule) {
    const active = group.filter((row) => row.computed_status !== "cancelled");
    const paidActive = active.filter((row) => row.paid_amount > 0.01);
    if (paidActive.length > 1) {
      throw new Error(
        `Synchronisation bloquée : plusieurs dettes actives déjà encaissées existent pour la même rubrique (${group[0]?.label || scheduleId}). Exécutez le diagnostic des doublons avant de continuer.`,
      );
    }

    const canonical =
      paidActive[0] ??
      active[0] ??
      [...group].sort((a, b) =>
        String(b.updated_at || "").localeCompare(String(a.updated_at || "")),
      )[0];
    if (!canonical) continue;
    existingBySchedule.set(scheduleId, canonical);

    for (const row of active) {
      if (row.id === canonical.id) continue;
      if (row.paid_amount > 0.01) {
        throw new Error(
          `Synchronisation bloquée : le doublon « ${row.label} » contient déjà un encaissement.`,
        );
      }
      duplicateIds.add(row.id);
    }
  }

  const applicable = selectedSchedules.filter((schedule) =>
    financeScheduleAppliesToStudent(schedule, profile, categoriesById),
  );
  const applicableIds = new Set(applicable.map((row) => row.id));
  const scheduleById = new Map(selectedSchedules.map((row) => [row.id, row]));

  for (const targetSchedule of applicable) {
    if (existingBySchedule.has(targetSchedule.id)) continue;
    const targetVariantKey = financeScheduleProfileVariantKey(
      targetSchedule,
      categoriesById,
    );
    if (!targetVariantKey) continue;

    const source = Array.from(existingBySchedule.entries())
      .map(([sourceScheduleId, charge]) => ({
        sourceScheduleId,
        charge,
        schedule: scheduleById.get(sourceScheduleId),
      }))
      .filter(
        (item) =>
          item.schedule &&
          !applicableIds.has(item.sourceScheduleId) &&
          financeScheduleProfileVariantKey(item.schedule, categoriesById) ===
            targetVariantKey,
      )
      .sort((a, b) => b.charge.paid_amount - a.charge.paid_amount)[0];

    if (!source) continue;
    existingBySchedule.delete(source.sourceScheduleId);
    existingBySchedule.set(targetSchedule.id, source.charge);
    retargetedChargeIds.add(source.charge.id);
  }

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const chargeUpdates = new Map<string, Record<string, unknown>>();
  const selectionUpserts: Array<Record<string, unknown>> = [];
  const insertedIds: string[] = [];

  for (const duplicateId of duplicateIds) {
    chargeUpdates.set(duplicateId, {
      status: "cancelled",
      notes:
        "Doublon automatique sans encaissement annulé par le moteur de synchronisation financière.",
      updated_at: now,
    });
  }

  const expectedFor = (schedule: ScheduleRow, charge: ChargeState | null) => {
    const componentRows = componentsBySchedule.get(schedule.id) ?? [];
    if (schedule.amount_mode !== "components" || componentRows.length === 0) {
      return Math.max(numberValue(schedule.amount), numberValue(charge?.paid_amount));
    }

    if (!charge) {
      return financeExpectedAmountFromComponents({
        scheduleAmount: numberValue(schedule.amount),
        amountMode: schedule.amount_mode,
        components: componentRows,
      });
    }

    const componentById = new Map(componentRows.map((row) => [row.id, row]));
    const componentByLabel = new Map(
      componentRows.map((row) => [normalizeFinanceText(row.label), row]),
    );
    const paidOptionalIds = new Set<string>();
    for (const paid of paidComponentsByCharge.get(charge.id) ?? []) {
      const direct = componentById.get(paid.fee_schedule_component_id);
      const component = direct ?? componentByLabel.get(normalizeFinanceText(paid.label));
      if (component && financeComponentIsOptional(component)) {
        paidOptionalIds.add(component.id);
      }
    }

    let selectedIds = new Set(
      (selectionsByCharge.get(charge.id) ?? [])
        .map((row) => row.fee_schedule_component_id)
        .filter((id) => componentById.has(id)),
    );

    if (selectedIds.size === 0) {
      const inferred = inferFinanceOptionalComponentIds({
        components: componentRows,
        expectedAmount: numberValue(charge.base_amount),
        requiredIds: paidOptionalIds,
      });

      if (inferred) {
        selectedIds = inferred;
      } else {
        summary.warnings.push(
          `Les anciennes options de « ${charge.label} » ne peuvent pas être reconstituées sans ambiguïté ; son montant actuel est conservé.`,
        );
        return Math.max(numberValue(charge.base_amount), charge.paid_amount);
      }
    }

    for (const id of paidOptionalIds) selectedIds.add(id);
    for (const id of selectedIds) {
      const component = componentById.get(id);
      if (!component || !financeComponentIsOptional(component)) continue;
      if (
        !(selectionsByCharge.get(charge.id) ?? []).some(
          (row) => row.fee_schedule_component_id === id,
        )
      ) {
        selectionUpserts.push({
          school_id: institutionId,
          student_charge_id: charge.id,
          fee_schedule_component_id: id,
          selected_by: userId,
          selected_at: now,
          created_at: now,
          updated_at: now,
        });
      }
    }

    return financeExpectedAmountFromComponents({
      scheduleAmount: numberValue(schedule.amount),
      amountMode: schedule.amount_mode,
      components: componentRows,
      selectedOptionalIds: selectedIds,
      paidAmount: charge.paid_amount,
    });
  };

  const rowsToInsert: Array<Record<string, unknown>> = [];
  for (const schedule of applicable) {
    const existing = existingBySchedule.get(schedule.id) ?? null;
    const expectedAmount = expectedFor(schedule, existing);
    const label =
      financeScheduleLabelForClass(schedule, targetClass, classesById) ||
      schedule.label ||
      "Frais scolaire";

    if (!existing) {
      rowsToInsert.push({
        school_id: institutionId,
        academic_year_id: yearId,
        academic_year: schedule.academic_year || academicYear,
        student_id: studentId,
        class_id: classId,
        fee_schedule_id: schedule.id,
        fee_category_id: schedule.fee_category_id,
        sync_key: schedule.id,
        label,
        base_amount: expectedAmount,
        due_date: schedule.due_date || null,
        charge_date: today,
        status: "pending",
        notes:
          schedule.notes ||
          "Dette créée par le moteur unique de synchronisation financière.",
        created_by: userId,
        created_at: now,
        updated_at: now,
      });
      continue;
    }

    chargeUpdates.set(existing.id, {
      academic_year_id: yearId,
      academic_year: schedule.academic_year || academicYear,
      class_id: classId,
      fee_schedule_id: schedule.id,
      fee_category_id: schedule.fee_category_id,
      sync_key: schedule.id,
      label,
      base_amount: expectedAmount,
      due_date: schedule.due_date || null,
      status: statusForAmount(expectedAmount, existing.paid_amount),
      notes: retargetedChargeIds.has(existing.id)
        ? "Profil financier modifié : dette adaptée au nouveau barème, paiements et reçus conservés."
        : "Dette vérifiée par le moteur unique de synchronisation financière.",
      updated_at: now,
    });

    if (existing.computed_status === "cancelled") summary.reactivated++;
    if (Math.abs(numberValue(existing.base_amount) - expectedAmount) > 0.01) {
      summary.updated_amount++;
    }
  }

  for (const [scheduleId, charge] of existingBySchedule) {
    if (applicableIds.has(scheduleId)) continue;
    if (charge.computed_status === "cancelled") continue;
    chargeUpdates.set(charge.id, {
      status: "cancelled",
      notes:
        "Profil financier modifié : dette devenue non applicable, montant historique et encaissements conservés.",
      updated_at: now,
    });
    summary.cancelled++;
  }

  const touchedIds = Array.from(chargeUpdates.keys());
  const chargeSnapshots = rawCharges.filter((row) => touchedIds.includes(row.id));
  const selectionSnapshots = [...selectionRows];
  let rolledBack = false;

  const rollback = async () => {
    if (rolledBack) return;
    if (insertedIds.length > 0) {
      await srv
        .schema("finance")
        .from("student_charges")
        .delete()
        .eq("school_id", institutionId)
        .in("id", insertedIds);
    }
    await restoreChargeSnapshots(srv, chargeSnapshots);
    await restoreSelectionSnapshots(srv, chargeIds, selectionSnapshots);
    rolledBack = true;
  };

  try {
    for (const [chargeId, update] of chargeUpdates) {
      const { error } = await srv
        .schema("finance")
        .from("student_charges")
        .update(update as any)
        .eq("id", chargeId)
        .eq("school_id", institutionId);
      if (error) throw new Error(error.message);
    }

    if (rowsToInsert.length > 0) {
      const { data, error } = await srv
        .schema("finance")
        .from("student_charges")
        .insert(rowsToInsert as any[])
        .select("id");
      if (error) throw new Error(error.message);
      insertedIds.push(...((data ?? []) as Array<{ id: string }>).map((row) => row.id));
    }

    if (selectionUpserts.length > 0) {
      const { error } = await srv
        .schema("finance")
        .from("student_charge_component_selections")
        .upsert(selectionUpserts as any[], {
          onConflict: "student_charge_id,fee_schedule_component_id",
        });
      if (error) throw new Error(error.message);
    }
  } catch (error) {
    await rollback();
    throw error;
  }

  summary.inserted = insertedIds.length;
  summary.cancelled_duplicates = duplicateIds.size;
  summary.retargeted = retargetedChargeIds.size;
  summary.option_links_created = selectionUpserts.length;
  summary.preserved_paid_amount = charges.reduce(
    (sum, row) => sum + row.paid_amount,
    0,
  );
  summary.warnings = Array.from(new Set(summary.warnings));

  return { summary, rollback };
}

export async function reconcileFinanceChargesForStudent(
  srv: ServiceClient,
  institutionId: string,
  userId: string,
  studentId: string,
  classId: string,
  studentProfile?: FinanceStudentProfileLike | null,
) {
  const applied = await applyStudentFinanceReconciliation({
    srv,
    institutionId,
    userId,
    studentId,
    classId,
    studentProfile,
  });
  return applied.summary;
}

export async function synchronizeStudentFinance({
  srv = getSupabaseServiceClient(),
  institutionId,
  userId,
  studentId,
  targetClass,
  sourceClassIds = [],
  studentProfile,
}: {
  srv?: ServiceClient;
  institutionId: string;
  userId: string | null;
  studentId: string;
  targetClass: ClassRow;
  sourceClassIds?: string[];
  studentProfile?: FinanceStudentProfileLike | null;
}): Promise<AppliedStudentFinanceSynchronization> {
  let transfer: AppliedFinanceClassTransfer | null = null;
  let reconciliation: AppliedFinanceReconciliation | null = null;

  try {
    const resolvedSourceClassIds = new Set(
      sourceClassIds.map(cleanId).filter((id) => id && id !== targetClass.id),
    );
    const targetAcademicYear = cleanId(targetClass.academic_year);
    if (targetAcademicYear) {
      const { data: staleChargeClasses, error: staleChargeError } = await srv
        .schema("finance")
        .from("student_charges")
        .select("class_id")
        .eq("school_id", institutionId)
        .eq("student_id", studentId)
        .eq("academic_year", targetAcademicYear)
        .neq("status", "cancelled");
      if (staleChargeError) throw new Error(staleChargeError.message);
      for (const row of staleChargeClasses ?? []) {
        const sourceClassId = cleanId((row as any).class_id);
        if (sourceClassId && sourceClassId !== targetClass.id) {
          resolvedSourceClassIds.add(sourceClassId);
        }
      }
    }

    transfer = await transferStudentFinanceToClass({
      srv,
      institutionId,
      studentId,
      sourceClassIds: Array.from(resolvedSourceClassIds),
      targetClass,
    });
    reconciliation = await applyStudentFinanceReconciliation({
      srv,
      institutionId,
      userId,
      studentId,
      classId: targetClass.id,
      studentProfile,
    });
  } catch (error) {
    if (reconciliation) await reconciliation.rollback();
    if (transfer) await transfer.rollback();
    throw error;
  }

  const rollback = async () => {
    await reconciliation!.rollback();
    await transfer!.rollback();
  };

  return {
    transfer: transfer!.summary,
    reconciliation: reconciliation!.summary,
    rollback,
  };
}

export async function setStudentChargeOptionalComponents({
  srv = getSupabaseServiceClient(),
  institutionId,
  userId,
  studentId,
  chargeId,
  selectedComponentIds,
  preserveExisting = false,
}: {
  srv?: ServiceClient;
  institutionId: string;
  userId: string | null;
  studentId: string;
  chargeId: string;
  selectedComponentIds: string[];
  preserveExisting?: boolean;
}) {
  const { data: charge, error: chargeError } = await srv
    .schema("finance")
    .from("v_charge_balances")
    .select(
      "id,school_id,student_id,fee_schedule_id,base_amount,paid_amount,computed_status",
    )
    .eq("id", chargeId)
    .eq("school_id", institutionId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (chargeError) throw new Error(chargeError.message);
  if (!charge?.fee_schedule_id) {
    throw new Error("Cette dette ne possède pas de sous-rubriques configurables.");
  }

  const [scheduleResult, componentsResult, existingResult, paidResult, rawChargeResult] =
    await Promise.all([
      srv
        .schema("finance")
        .from("fee_schedules")
        .select("id,amount,amount_mode")
        .eq("id", charge.fee_schedule_id)
        .eq("school_id", institutionId)
        .maybeSingle(),
      srv
        .schema("finance")
        .from("fee_schedule_components")
        .select("id,fee_schedule_id,label,amount,is_optional,is_active")
        .eq("school_id", institutionId)
        .eq("fee_schedule_id", charge.fee_schedule_id)
        .eq("is_active", true),
      srv
        .schema("finance")
        .from("student_charge_component_selections")
        .select(
          "school_id,student_charge_id,fee_schedule_component_id,selected_by,selected_at,created_at,updated_at",
        )
        .eq("school_id", institutionId)
        .eq("student_charge_id", chargeId),
      srv
        .schema("finance")
        .from("v_receipt_allocation_components")
        .select("fee_schedule_component_id,amount,receipt_status")
        .eq("school_id", institutionId)
        .eq("student_charge_id", chargeId),
      srv
        .schema("finance")
        .from("student_charges")
        .select("id,status")
        .eq("id", chargeId)
        .eq("school_id", institutionId)
        .eq("student_id", studentId)
        .maybeSingle(),
    ]);

  for (const error of [
    scheduleResult.error,
    componentsResult.error,
    existingResult.error,
    paidResult.error,
    rawChargeResult.error,
  ]) {
    if (error) throw new Error(error.message);
  }
  if (!scheduleResult.data) throw new Error("Barème introuvable.");
  if (!rawChargeResult.data) throw new Error("Dette introuvable.");
  if (cleanId((scheduleResult.data as any).amount_mode) !== "components") {
    throw new Error("Cette dette n'utilise pas un barème à sous-rubriques variables.");
  }

  const componentRows = (componentsResult.data ?? []) as ComponentRow[];
  const optionalIds = new Set(
    componentRows.filter(financeComponentIsOptional).map((row) => row.id),
  );
  const cleanedRequestedIds = Array.from(
    new Set(selectedComponentIds.map(cleanId).filter(Boolean)),
  );
  if (cleanedRequestedIds.some((id) => !optionalIds.has(id))) {
    throw new Error("Une option sélectionnée n'appartient pas à ce barème.");
  }
  const requested = new Set(cleanedRequestedIds);
  const paidOptionalIds = new Set(
    ((paidResult.data ?? []) as Array<{
      fee_schedule_component_id: string;
      amount: number | string;
      receipt_status: string | null;
    }>)
      .filter(
        (row) =>
          row.receipt_status !== "cancelled" &&
          numberValue(row.amount) > 0 &&
          optionalIds.has(row.fee_schedule_component_id),
      )
      .map((row) => row.fee_schedule_component_id),
  );
  for (const id of paidOptionalIds) requested.add(id);

  const now = new Date().toISOString();
  const existing = (existingResult.data ?? []) as SelectionRow[];
  if (preserveExisting) {
    for (const row of existing) requested.add(row.fee_schedule_component_id);
  }
  const previousBaseAmount = numberValue((charge as any).base_amount);
  const previousStatus = cleanId((rawChargeResult.data as any).status);

  try {
    if (requested.size > 0) {
      const { error } = await srv
        .schema("finance")
        .from("student_charge_component_selections")
        .upsert(
          Array.from(requested).map((componentId) => ({
            school_id: institutionId,
            student_charge_id: chargeId,
            fee_schedule_component_id: componentId,
            selected_by: userId,
            selected_at: now,
            created_at: now,
            updated_at: now,
          })) as any[],
          { onConflict: "student_charge_id,fee_schedule_component_id" },
        );
      if (error) throw new Error(error.message);
    }

    const removable = existing
      .map((row) => row.fee_schedule_component_id)
      .filter((id) => !requested.has(id) && !paidOptionalIds.has(id));
    if (removable.length > 0) {
      const { error } = await srv
        .schema("finance")
        .from("student_charge_component_selections")
        .delete()
        .eq("student_charge_id", chargeId)
        .in("fee_schedule_component_id", removable);
      if (error) throw new Error(error.message);
    }

    const expectedAmount = financeExpectedAmountFromComponents({
      scheduleAmount: numberValue((scheduleResult.data as any).amount),
      amountMode: cleanId((scheduleResult.data as any).amount_mode),
      components: componentRows,
      selectedOptionalIds: requested,
      paidAmount: numberValue((charge as any).paid_amount),
    });
    const { error: updateError } = await srv
      .schema("finance")
      .from("student_charges")
      .update({
        base_amount: expectedAmount,
        status: statusForAmount(expectedAmount, numberValue((charge as any).paid_amount)),
        notes:
          "Options mises à jour : dette recalculée depuis les sous-rubriques paramétrées, reçus historiques conservés.",
        updated_at: now,
      } as any)
      .eq("id", chargeId)
      .eq("school_id", institutionId);
    if (updateError) throw new Error(updateError.message);

    return {
      expected_amount: expectedAmount,
      selected_component_ids: Array.from(requested),
      protected_paid_component_ids: Array.from(paidOptionalIds),
    };
  } catch (error) {
    await restoreSelectionSnapshots(srv, [chargeId], existing);
    await srv
      .schema("finance")
      .from("student_charges")
      .update({
        base_amount: previousBaseAmount,
        status: previousStatus,
      } as any)
      .eq("id", chargeId)
      .eq("school_id", institutionId);
    throw error;
  }
}
