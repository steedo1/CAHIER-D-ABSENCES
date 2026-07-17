"use client";

import { useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  CreditCard,
  Loader2,
  Receipt,
  Search,
  UserPlus,
  UserRound,
  Wallet,
} from "lucide-react";
import type { FeeCategoryRow, PaymentStudentRow } from "./page";

type ClassRow = {
  id: string;
  label: string;
  level: string | null;
  academic_year: string | null;
};

type Props = {
  classes: ClassRow[];
  rows: PaymentStudentRow[];
  feeCategories: FeeCategoryRow[];
  action: (formData: FormData) => void | Promise<void>;
  optionsAction: (formData: FormData) => void | Promise<void>;
  initialClassId?: string;
  initialStudentId?: string;
  correctionNotice?: string;
};

type ActiveFinanceWorkflow = "menu" | "payment" | "new";

type FeeComponentOption = {
  id: string;
  label: string;
  amount: number;
  paid_amount: number;
  remaining_amount: number;
  is_optional: boolean;
  is_engaged: boolean;
  order_index: number;
};

type ComponentPaymentInput = {
  componentId: string;
  amount: number;
};

function normalize(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function formatMoney(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function affectationLabel(value: boolean | null) {
  if (value === true) return "Affecté";
  if (value === false) return "Non affecté";
  return "Affectation non renseignée";
}

function internatLabel(value: boolean | null) {
  if (value === true) return "Interne";
  if (value === false) return "Externe";
  return "Internat non renseigné";
}

function componentAmountKey(chargeId: string, componentId: string) {
  return `${chargeId}::${componentId}`;
}

function getComponentAmount(
  amounts: Record<string, string>,
  chargeId: string,
  componentId: string,
) {
  const raw = Number(amounts[componentAmountKey(chargeId, componentId)] || 0);
  return Number.isFinite(raw) ? Math.max(raw, 0) : 0;
}

function getComponentPaymentInputs(
  charge: PaymentStudentRow["open_charges"][number],
  amounts: Record<string, string>,
): ComponentPaymentInput[] {
  return charge.components
    .map((component) => ({
      componentId: component.id,
      amount: Math.min(
        getComponentAmount(amounts, charge.charge_id, component.id),
        Number(component.remaining_amount || 0),
      ),
    }))
    .filter((item) => item.amount > 0);
}

function getNewOptionalInternatAnnexesExpectedTotal(
  charge: PaymentStudentRow["open_charges"][number],
  selectedComponentIds: string[],
) {
  const selectedIds = new Set(selectedComponentIds);
  return charge.components
    .filter(
      (component) =>
        component.is_optional &&
        !component.is_engaged &&
        selectedIds.has(component.id),
    )
    .reduce((sum, component) => sum + Number(component.amount || 0), 0);
}

function getComponentDrivenChargeLimit(
  charge: PaymentStudentRow["open_charges"][number],
  selectedComponentIds: string[],
) {
  if (charge.components.length === 0) return Number(charge.balance_due || 0);

  // Une option devient entièrement due dès qu'elle est retenue, même si aucun
  // paiement n'est encore saisi. Le plafond vient exclusivement du barème.
  return (
    Number(charge.balance_due || 0) +
    getNewOptionalInternatAnnexesExpectedTotal(charge, selectedComponentIds)
  );
}

function isInternatCategory(category: FeeCategoryRow | null | undefined) {
  const text = normalize(`${category?.code || ""} ${category?.name || ""}`);
  return text.includes("internat");
}

function isScolariteCategory(category: FeeCategoryRow | null | undefined) {
  const text = normalize(`${category?.code || ""} ${category?.name || ""}`);
  return (
    text.includes("scolar") ||
    text.includes("ecolage") ||
    text.includes("écolage") ||
    text.includes("inscription")
  );
}

function isPensionCharge(label: string | null | undefined) {
  return normalize(label).includes("pension");
}

function getSelectedComponentsTotal(
  charge: PaymentStudentRow["open_charges"][number],
  componentIdsByCharge: Record<string, string[]>,
  amounts: Record<string, string>,
) {
  const selected = new Set(componentIdsByCharge[charge.charge_id] ?? []);
  return charge.components
    .filter((component) => selected.has(component.id))
    .reduce(
      (sum, component) =>
        sum + getComponentAmount(amounts, charge.charge_id, component.id),
      0,
    );
}

function getInternatRecoverableTotal(
  charges: PaymentStudentRow["open_charges"],
  componentIdsByCharge: Record<string, string[]>,
) {
  return charges.reduce(
    (sum, charge) =>
      sum +
      Number(charge.balance_due || 0) +
      getNewOptionalInternatAnnexesExpectedTotal(
        charge,
        componentIdsByCharge[charge.charge_id] ?? [],
      ),
    0,
  );
}

function PendingButton({
  icon,
  label,
  pendingLabel,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  pendingLabel: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      disabled={pending || disabled}
      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {pending ? pendingLabel : label}
    </button>
  );
}

export default function PaymentsComposer({
  classes,
  rows,
  feeCategories,
  action,
  optionsAction,
  initialClassId = "",
  initialStudentId = "",
  correctionNotice = "",
}: Props) {
  const levels = useMemo(() => {
    const map = new Map<string, string>();

    for (const cls of classes) {
      const label = (cls.level || "Sans niveau").trim();
      const key = normalize(label);
      if (!map.has(key)) map.set(key, label);
    }

    return Array.from(map.values()).sort((a, b) =>
      a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" }),
    );
  }, [classes]);

  const initialStudent = initialStudentId
    ? rows.find((row) => row.student_id === initialStudentId) ?? null
    : null;
  const initialClass =
    classes.find(
      (cls) =>
        cls.id === (initialClassId || initialStudent?.class_id || ""),
    ) ?? null;

  const [selectedLevel, setSelectedLevel] = useState(
    initialClass?.level || (initialClass ? "Sans niveau" : ""),
  );
  const [selectedClassId, setSelectedClassId] = useState(initialClass?.id ?? "");
  const [search, setSearch] = useState(
    initialStudent?.student_name || initialStudent?.matricule || "",
  );
  const [selectedStudentId, setSelectedStudentId] = useState(
    initialStudent?.student_id ?? "",
  );
  const [selectedChargeId, setSelectedChargeId] = useState("");
  const [selectedComponentIds, setSelectedComponentIds] = useState<string[]>(
    [],
  );
  const [internatAmounts, setInternatAmounts] = useState<
    Record<string, string>
  >({});
  const [internatComponentIdsByCharge, setInternatComponentIdsByCharge] =
    useState<Record<string, string[]>>({});
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [paymentType, setPaymentType] = useState("cash");
  const [amount, setAmount] = useState("");
  const [expectedAmount, setExpectedAmount] = useState("");
  const [newClassId, setNewClassId] = useState("");
  const [activeWorkflow, setActiveWorkflow] = useState<ActiveFinanceWorkflow>(
    initialStudent ? "payment" : "menu",
  );

  useEffect(() => {
    if (!selectedLevel && levels.length > 0) setSelectedLevel(levels[0]);
  }, [levels, selectedLevel]);

  useEffect(() => {
    if (!selectedCategoryId && feeCategories.length > 0) {
      setSelectedCategoryId(feeCategories[0].id);
    }
  }, [feeCategories, selectedCategoryId]);

  const classOptions = useMemo(() => {
    if (!selectedLevel) return [];
    return classes
      .filter(
        (cls) =>
          normalize(cls.level || "Sans niveau") === normalize(selectedLevel),
      )
      .sort((a, b) =>
        a.label.localeCompare(b.label, "fr", {
          numeric: true,
          sensitivity: "base",
        }),
      );
  }, [classes, selectedLevel]);

  useEffect(() => {
    if (!classOptions.some((cls) => cls.id === selectedClassId)) {
      setSelectedClassId(classOptions[0]?.id ?? "");
      setSelectedStudentId("");
      setSelectedChargeId("");
      setSelectedComponentIds([]);
      setInternatAmounts({});
      setInternatComponentIdsByCharge({});
      setSearch("");
    }
  }, [classOptions, selectedClassId]);

  useEffect(() => {
    if (!newClassId && classes.length > 0) {
      setNewClassId(classes[0].id);
    }
  }, [classes, newClassId]);

  const selectedClass = useMemo(
    () => classOptions.find((cls) => cls.id === selectedClassId) ?? null,
    [classOptions, selectedClassId],
  );

  const query = normalize(search);
  const filteredRows = useMemo(() => {
    if (!selectedClassId) return [];

    const selectedRow = selectedStudentId
      ? rows.find(
          (row) =>
            row.student_id === selectedStudentId &&
            row.class_id === selectedClassId,
        ) ?? null
      : null;

    const matches =
      query.length < 2
        ? []
        : rows.filter((row) => {
            if (row.class_id !== selectedClassId) return false;
            const haystack = [
              row.student_name,
              row.matricule,
              row.class_label,
              row.level,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();
            return haystack.includes(query);
          });

    if (selectedRow && !matches.some((row) => row.student_id === selectedRow.student_id)) {
      return [selectedRow, ...matches];
    }

    return matches;
  }, [query, rows, selectedClassId, selectedStudentId]);

  useEffect(() => {
    if (!filteredRows.some((row) => row.student_id === selectedStudentId)) {
      setSelectedStudentId("");
      setSelectedChargeId("");
      setSelectedComponentIds([]);
      setInternatAmounts({});
      setInternatComponentIdsByCharge({});
    }
  }, [filteredRows, selectedStudentId]);

  const selectedStudent = useMemo(
    () => rows.find((row) => row.student_id === selectedStudentId) ?? null,
    [rows, selectedStudentId],
  );

  const selectedCharge = useMemo(
    () =>
      selectedStudent?.open_charges.find(
        (charge) => charge.charge_id === selectedChargeId,
      ) ?? null,
    [selectedChargeId, selectedStudent],
  );

  const categoryChargeOptions = useMemo(() => {
    if (!selectedStudent || !selectedCategoryId) return [];
    return selectedStudent.open_charges.filter(
      (charge) => charge.fee_category_id === selectedCategoryId,
    );
  }, [selectedCategoryId, selectedStudent]);

  const selectedCategory = useMemo(
    () =>
      feeCategories.find((category) => category.id === selectedCategoryId) ??
      null,
    [feeCategories, selectedCategoryId],
  );

  const selectedCategoryIsInternat = isInternatCategory(selectedCategory);
  const selectedCategoryIsScolarite = isScolariteCategory(selectedCategory);
  const selectedCategoryUsesGroupedPlan =
    selectedCategoryIsInternat || selectedCategoryIsScolarite;

  const categoryById = useMemo(() => {
    const map = new Map<string, FeeCategoryRow>();
    for (const category of feeCategories) map.set(category.id, category);
    return map;
  }, [feeCategories]);

  const scolariteCharges = useMemo(() => {
    if (!selectedStudent) return [];
    return selectedStudent.open_charges.filter((charge) =>
      isScolariteCategory(categoryById.get(charge.fee_category_id)),
    );
  }, [categoryById, selectedStudent]);

  const internatCharges = useMemo(() => {
    if (!selectedStudent) return [];
    return selectedStudent.open_charges.filter((charge) =>
      isInternatCategory(categoryById.get(charge.fee_category_id)),
    );
  }, [categoryById, selectedStudent]);

  useEffect(() => {
    if (!selectedStudent) {
      setInternatComponentIdsByCharge({});
      return;
    }
    setInternatComponentIdsByCharge(
      Object.fromEntries(
        internatCharges.map((charge) => [
          charge.charge_id,
          charge.components
            .filter((component) => component.is_optional && component.is_engaged)
            .map((component) => component.id),
        ]),
      ),
    );
  }, [internatCharges, selectedStudent]);

  const optionSelectionPlan = useMemo(
    () =>
      internatCharges
        .filter((charge) =>
          charge.components.some((component) => component.is_optional),
        )
        .map((charge) => {
          const allowedIds = new Set(
            charge.components
              .filter((component) => component.is_optional)
              .map((component) => component.id),
          );
          const fallback = charge.components
            .filter((component) => component.is_optional && component.is_engaged)
            .map((component) => component.id);
          return {
            chargeId: charge.charge_id,
            componentIds: (
              internatComponentIdsByCharge[charge.charge_id] ?? fallback
            ).filter((id) => allowedIds.has(id)),
          };
        }),
    [internatCharges, internatComponentIdsByCharge],
  );

  const otherCharges = useMemo(() => {
    if (!selectedStudent) return [];
    return selectedStudent.open_charges.filter((charge) => {
      const category = categoryById.get(charge.fee_category_id);
      return !isScolariteCategory(category) && !isInternatCategory(category);
    });
  }, [categoryById, selectedStudent]);

  function applyCharge(
    charge: PaymentStudentRow["open_charges"][number] | null,
  ) {
    setSelectedChargeId(charge?.charge_id ?? "");
    setSelectedComponentIds([]);
    setInternatAmounts({});
    setInternatComponentIdsByCharge({});
    if (charge) {
      setSelectedCategoryId(charge.fee_category_id);
      setExpectedAmount(String(charge.net_amount));
      setAmount(charge.components?.length ? "" : String(charge.balance_due));
    } else {
      setAmount("");
      setExpectedAmount("");
    }
  }

  useEffect(() => {
    if (!selectedStudent) {
      applyCharge(null);
      return;
    }

    const firstCharge = selectedStudent.open_charges[0];
    if (firstCharge && !selectedChargeId) {
      applyCharge(firstCharge);
    }
    if (!firstCharge) {
      applyCharge(null);
    }
  }, [selectedChargeId, selectedStudent]);

  useEffect(() => {
    if (selectedCharge && !selectedCategoryUsesGroupedPlan) {
      setSelectedCategoryId(selectedCharge.fee_category_id);
      setSelectedComponentIds([]);
      setExpectedAmount(String(selectedCharge.net_amount));
      setAmount(String(selectedCharge.balance_due));
    }
  }, [selectedCharge?.charge_id, selectedCategoryUsesGroupedPlan]);

  const groupedPaymentPlan = useMemo(() => {
    if (!selectedCategoryUsesGroupedPlan) return [];

    return categoryChargeOptions.map((charge) => {
      const componentIds = selectedCategoryIsInternat
        ? (internatComponentIdsByCharge[charge.charge_id] ?? [])
        : [];
      const componentTotal = getSelectedComponentsTotal(
        charge,
        internatComponentIdsByCharge,
        internatAmounts,
      );
      const typedAmount = Number(internatAmounts[charge.charge_id] || 0);
      const safeTypedAmount = Number.isFinite(typedAmount)
        ? Math.max(typedAmount, 0)
        : 0;
      const amountForCharge =
        selectedCategoryIsInternat && charge.components.length > 0
          ? componentTotal
          : Math.min(safeTypedAmount, Number(charge.balance_due || 0));

      return {
        chargeId: charge.charge_id,
        amount: Number.isFinite(amountForCharge)
          ? Math.max(amountForCharge, 0)
          : 0,
        componentIds,
        componentAmounts: [] as ComponentPaymentInput[],
        // Scolarité : les libellés servent aux statistiques et à la ventilation
        // interne, mais ils ne doivent pas ressortir sur le reçu.
        componentMode: selectedCategoryIsScolarite ? "hidden" : "detail",
        // Internat : les frais annexes non cochés restent disponibles pour un
        // prochain encaissement. On ne les ferme plus automatiquement, sinon
        // le comptable ne peut plus les sélectionner plus tard.
        closeUnselectedComponents: false,
        includeOnReceipt:
          selectedCategoryIsInternat && isPensionCharge(charge.label),
      };
    });
  }, [
    categoryChargeOptions,
    internatAmounts,
    internatComponentIdsByCharge,
    selectedCategoryIsInternat,
    selectedCategoryIsScolarite,
    selectedCategoryUsesGroupedPlan,
  ]);

  const groupedPaymentTotal = useMemo(
    () =>
      groupedPaymentPlan.reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0,
      ),
    [groupedPaymentPlan],
  );

  const unifiedPaymentPlan = useMemo(() => {
    if (!selectedStudent) return [];

    const scolariteItems = scolariteCharges.map((charge) => {
      const typed = Number(internatAmounts[charge.charge_id] || 0);
      const amountForCharge = Number.isFinite(typed)
        ? Math.min(Math.max(typed, 0), Number(charge.balance_due || 0))
        : 0;

      return {
        chargeId: charge.charge_id,
        amount: amountForCharge,
        componentIds: [] as string[],
        componentAmounts: [] as ComponentPaymentInput[],
        componentMode: "hidden",
        closeUnselectedComponents: false,
        includeOnReceipt: amountForCharge > 0,
      };
    });

    const internatItems = internatCharges.map((charge) => {
      if (charge.components.length > 0) {
        const componentAmounts = getComponentPaymentInputs(charge, internatAmounts);
        const amountForCharge = componentAmounts.reduce(
          (sum, component) => sum + component.amount,
          0,
        );
        return {
          chargeId: charge.charge_id,
          amount: amountForCharge,
          componentIds: componentAmounts.map((component) => component.componentId),
          componentAmounts,
          componentMode: "detail",
          closeUnselectedComponents: false,
          includeOnReceipt: amountForCharge > 0,
        };
      }

      const typed = Number(internatAmounts[charge.charge_id] || 0);
      const amountForCharge = Number.isFinite(typed)
        ? Math.min(Math.max(typed, 0), Number(charge.balance_due || 0))
        : 0;

      return {
        chargeId: charge.charge_id,
        amount: amountForCharge,
        componentIds: [] as string[],
        componentAmounts: [] as ComponentPaymentInput[],
        componentMode: "detail",
        closeUnselectedComponents: false,
        includeOnReceipt: isPensionCharge(charge.label) || amountForCharge > 0,
      };
    });

    const otherItems = otherCharges.map((charge) => {
      const typed = Number(internatAmounts[charge.charge_id] || 0);
      const amountForCharge = Number.isFinite(typed)
        ? Math.min(Math.max(typed, 0), Number(charge.balance_due || 0))
        : 0;

      return {
        chargeId: charge.charge_id,
        amount: amountForCharge,
        componentIds: [] as string[],
        componentAmounts: [] as ComponentPaymentInput[],
        componentMode: "detail",
        closeUnselectedComponents: false,
        includeOnReceipt: amountForCharge > 0,
      };
    });

    return [...scolariteItems, ...internatItems, ...otherItems].filter(
      (item) => item.amount > 0 || item.includeOnReceipt,
    );
  }, [internatAmounts, internatCharges, otherCharges, scolariteCharges, selectedStudent]);

  const unifiedPaymentTotal = useMemo(
    () =>
      unifiedPaymentPlan.reduce(
        (sum, item) => sum + Number(item.amount || 0),
        0,
      ),
    [unifiedPaymentPlan],
  );

  const newlyEngagedOptionalExpectedTotal = useMemo(
    () =>
      internatCharges.reduce(
        (sum, charge) =>
          sum +
          getNewOptionalInternatAnnexesExpectedTotal(
            charge,
            internatComponentIdsByCharge[charge.charge_id] ?? [],
          ),
        0,
      ),
    [internatCharges, internatComponentIdsByCharge],
  );

  const unifiedExpectedTotal = useMemo(() => {
    const scolariteTotal = scolariteCharges.reduce(
      (sum, charge) => sum + Number(charge.net_amount || 0),
      0,
    );
    const internatTotal = internatCharges.reduce(
      (sum, charge) => sum + Number(charge.net_amount || 0),
      0,
    );
    const otherTotal = otherCharges.reduce(
      (sum, charge) => sum + Number(charge.net_amount || 0),
      0,
    );
    return (
      scolariteTotal +
      internatTotal +
      otherTotal +
      newlyEngagedOptionalExpectedTotal
    );
  }, [
    internatCharges,
    newlyEngagedOptionalExpectedTotal,
    otherCharges,
    scolariteCharges,
  ]);

  const unifiedRemainingAfterPayment = Math.max(
    scolariteCharges.reduce(
      (sum, charge) => sum + Number(charge.balance_due || 0),
      0,
    ) +
      internatCharges.reduce(
        (sum, charge) => sum + Number(charge.balance_due || 0),
        0,
      ) +
      otherCharges.reduce(
        (sum, charge) => sum + Number(charge.balance_due || 0),
        0,
      ) +
      newlyEngagedOptionalExpectedTotal -
      unifiedPaymentTotal,
    0,
  );

  const categoryBalanceTotal = useMemo(
    () =>
      categoryChargeOptions.reduce(
        (sum, charge) => sum + Number(charge.balance_due || 0),
        0,
      ),
    [categoryChargeOptions],
  );

  const categoryExpectedTotal = useMemo(
    () =>
      categoryChargeOptions.reduce(
        (sum, charge) => sum + Number(charge.net_amount || 0),
        0,
      ),
    [categoryChargeOptions],
  );

  const internatRecoverableTotal = useMemo(
    () =>
      selectedCategoryIsInternat
        ? getInternatRecoverableTotal(
            categoryChargeOptions,
            internatComponentIdsByCharge,
          )
        : 0,
    [
      categoryChargeOptions,
      internatComponentIdsByCharge,
      selectedCategoryIsInternat,
    ],
  );

  const effectiveCategoryBalanceTotal = selectedCategoryIsInternat
    ? internatRecoverableTotal
    : categoryBalanceTotal;

  const remainingAfterCurrentPayment = Math.max(
    effectiveCategoryBalanceTotal - groupedPaymentTotal,
    0,
  );

  useEffect(() => {
    if (selectedCategoryUsesGroupedPlan) {
      const expectedForDisplay = selectedCategoryIsScolarite
        ? categoryExpectedTotal
        : selectedCategoryIsInternat
          ? internatRecoverableTotal
          : groupedPaymentTotal;
      setExpectedAmount(
        expectedForDisplay > 0 ? String(expectedForDisplay) : "",
      );
      setAmount(groupedPaymentTotal > 0 ? String(groupedPaymentTotal) : "");
    }
  }, [
    categoryExpectedTotal,
    groupedPaymentTotal,
    internatRecoverableTotal,
    selectedCategoryIsInternat,
    selectedCategoryIsScolarite,
    selectedCategoryUsesGroupedPlan,
  ]);

  useEffect(() => {
    if (selectedStudent) {
      setExpectedAmount(unifiedExpectedTotal > 0 ? String(unifiedExpectedTotal) : "");
      setAmount(unifiedPaymentTotal > 0 ? String(unifiedPaymentTotal) : "");
    }
  }, [selectedStudent, unifiedExpectedTotal, unifiedPaymentTotal]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const canCreatePayment = Boolean(
    selectedStudent?.profile_complete &&
      selectedClassId &&
      unifiedPaymentTotal > 0,
  );

  if (activeWorkflow === "menu") {
    return (
      <section className="grid gap-5 lg:grid-cols-2">
        <button
          type="button"
          onClick={() => setActiveWorkflow("payment")}
          className="group rounded-[28px] border border-emerald-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
        >
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
            <Wallet className="h-5 w-5" />
          </div>
          <h2 className="mt-5 text-2xl font-black text-slate-950">
            Encaisser un paiement
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Ouvre le formulaire d’encaissement en plein écran : choix de
            l’élève, catégorie, ventilation scolarité ou internat, puis
            validation du reçu.
          </p>
          <span className="mt-5 inline-flex rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white group-hover:bg-emerald-700">
            Commencer
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveWorkflow("new")}
          className="group rounded-[28px] border border-sky-200 bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md"
        >
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-50 text-sky-700 ring-1 ring-sky-100">
            <UserPlus className="h-5 w-5" />
          </div>
          <h2 className="mt-5 text-2xl font-black text-slate-950">
            Nouvelle inscription
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Crée rapidement le dossier élève avec les informations minimales.
            Les frais et paiements se gèrent ensuite dans l’encaissement normal.
          </p>
          <span className="mt-5 inline-flex rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white group-hover:bg-sky-700">
            Inscrire
          </span>
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      {correctionNotice ? (
        <div className="rounded-[24px] border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-900 shadow-sm">
          {correctionNotice}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
            Module caisse
          </div>
          <div className="mt-1 text-lg font-black text-slate-950">
            {activeWorkflow === "payment"
              ? "Encaisser un paiement"
              : "Nouvelle inscription"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setActiveWorkflow("menu")}
          className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          Retour aux deux actions
        </button>
      </div>

      {activeWorkflow === "payment" ? (
        <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
          <Wallet className="h-4 w-4 text-emerald-600" />
          Encaisser un paiement
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Choisissez la classe, puis recherchez par nom ou matricule. Aucun
          élève n’est affiché tant que la recherche n’est pas saisie.
        </p>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Niveau
            </label>
            <select
              value={selectedLevel}
              onChange={(e) => {
                setSelectedLevel(e.target.value);
                setSelectedClassId("");
                setSelectedStudentId("");
                setSelectedChargeId("");
                setInternatAmounts({});
                setInternatComponentIdsByCharge({});
              }}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
            >
              {levels.length === 0 ? (
                <option value="">Aucun niveau</option>
              ) : null}
              {levels.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Classe
            </label>
            <select
              value={selectedClassId}
              onChange={(e) => {
                setSelectedClassId(e.target.value);
                setSelectedStudentId("");
                setSelectedChargeId("");
                setInternatAmounts({});
                setInternatComponentIdsByCharge({});
              }}
              disabled={!selectedLevel}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
            >
              {!selectedLevel ? (
                <option value="">Choisir un niveau</option>
              ) : classOptions.length === 0 ? (
                <option value="">Aucune classe</option>
              ) : null}
              {classOptions.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Recherche
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={!selectedClassId}
                placeholder="Matricule ou nom"
                className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>
          </div>
        </div>

        <div className="mt-5">
          {!selectedClassId ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Choisissez un niveau puis une classe.
            </div>
          ) : selectedStudent ? (
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-900">
              Élève sélectionné : {selectedStudent.student_name} ·{" "}
              {affectationLabel(selectedStudent.is_affecte)} ·{" "}
              {internatLabel(selectedStudent.is_boarder)}.
              <button
                type="button"
                onClick={() => {
                  setSelectedStudentId("");
                  setSelectedChargeId("");
                  setInternatAmounts({});
                  setInternatComponentIdsByCharge({});
                }}
                className="ml-3 rounded-full bg-white px-3 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50"
              >
                Changer d’élève
              </button>
            </div>
          ) : query.length < 2 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Saisissez au moins 2 caractères pour rechercher un élève.
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucun élève trouvé dans {selectedClass?.label || "cette classe"}.
            </div>
          ) : (
            <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
              {filteredRows.map((row) => {
                const active = row.student_id === selectedStudentId;
                return (
                  <button
                    key={row.student_id}
                    type="button"
                    onClick={() => {
                      setSelectedStudentId(row.student_id);
                      const firstCharge = row.open_charges[0] ?? null;
                      applyCharge(firstCharge);
                    }}
                    className={`w-full rounded-3xl border p-4 text-left transition ${
                      active
                        ? "border-emerald-300 bg-emerald-50/80 shadow-sm"
                        : "border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-black text-slate-900">
                            {row.student_name}
                          </span>
                          {row.matricule ? (
                            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200">
                              {row.matricule}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-slate-500">
                          <span>{row.class_label}</span>
                          <span>· {affectationLabel(row.is_affecte)}</span>
                          <span>· {internatLabel(row.is_boarder)}</span>
                          <span>· {row.open_charges.length} frais</span>
                        </div>
                      </div>
                      <div className="shrink-0 rounded-full bg-rose-50 px-3 py-1.5 text-sm font-black text-rose-700 ring-1 ring-rose-200">
                        Reste : {formatMoney(row.total_due)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <form
          action={action}
          className="mt-5 rounded-[26px] border border-slate-200 bg-slate-50/70 p-4"
        >
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <Receipt className="h-4 w-4 text-emerald-600" />
            Paiement
          </div>

          <input type="hidden" name="mode" value="existing" />
          <input
            type="hidden"
            name="student_id"
            value={selectedStudent?.student_id ?? ""}
          />
          <input type="hidden" name="class_id" value={selectedClassId} />
          <input type="hidden" name="fee_category_id" value="__mixed__" />
          <input type="hidden" name="student_charge_id" value="" />
          <input
            type="hidden"
            name="allocation_plan"
            value={JSON.stringify(unifiedPaymentPlan)}
          />
          <input
            type="hidden"
            name="option_selection_plan"
            value={JSON.stringify(optionSelectionPlan)}
          />
          {selectedComponentIds.map((componentId) => (
            <input
              key={componentId}
              type="hidden"
              name="component_ids"
              value={componentId}
            />
          ))}

          {!selectedStudent ? (
            <div className="mt-4 rounded-3xl border border-dashed border-slate-300 bg-white px-5 py-8 text-center text-sm text-slate-600">
              Sélectionnez un élève pour afficher le formulaire de paiement.
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="rounded-3xl bg-slate-950 p-4 text-white">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-100 ring-1 ring-white/15">
                      <UserRound className="h-3.5 w-3.5" />
                      Élève sélectionné
                    </div>
                    <h2 className="mt-3 text-xl font-black">
                      {selectedStudent.student_name}
                    </h2>
                    <p className="mt-1 text-sm text-slate-200">
                      {selectedStudent.class_label} ·{" "}
                      {affectationLabel(selectedStudent.is_affecte)} ·{" "}
                      {internatLabel(selectedStudent.is_boarder)} ·{" "}
                      {selectedStudent.matricule || "Matricule non renseigné"}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/10 px-3 py-2 text-right ring-1 ring-white/15">
                    <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-100">
                      Reste connu
                    </div>
                    <div className="mt-1 text-lg font-black">
                      {formatMoney(selectedStudent.total_due)}
                    </div>
                  </div>
                </div>
              </div>

              {!selectedStudent.profile_complete ? (
                <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm font-semibold text-rose-800">
                  Profil financier incomplet. Renseignez obligatoirement
                  Affecté/Non affecté et Interne/Externe dans la liste de classe
                  avant tout nouvel encaissement. Aucun paiement ne peut être
                  validé tant que ces deux statuts ne sont pas complets.
                  <a
                    href={`/admin/classes/liste/${selectedStudent.class_id}`}
                    className="ml-2 inline-flex rounded-full bg-white px-3 py-1 text-xs font-black text-rose-700 ring-1 ring-rose-200"
                  >
                    Ouvrir la liste de classe
                  </a>
                </div>
              ) : null}

              <div className="grid gap-3 rounded-3xl border border-emerald-100 bg-white p-4 sm:grid-cols-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    Total attendu
                  </div>
                  <div className="mt-1 text-sm font-black text-slate-900">
                    {formatMoney(unifiedExpectedTotal)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    Montant encaissé
                  </div>
                  <div className="mt-1 text-sm font-black text-emerald-700">
                    {formatMoney(unifiedPaymentTotal)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    Reste après paiement
                  </div>
                  <div className="mt-1 text-sm font-black text-rose-700">
                    {formatMoney(unifiedRemainingAfterPayment)}
                  </div>
                </div>
              </div>

              <ScolaritePaymentPlanner
                charges={scolariteCharges}
                amounts={internatAmounts}
                onAmountChange={(chargeId, value) =>
                  setInternatAmounts((prev) => ({
                    ...prev,
                    [chargeId]: value,
                  }))
                }
              />

              {internatCharges.length > 0 ? (
                <InternatPaymentPlanner
                  charges={internatCharges}
                  amounts={internatAmounts}
                  componentIdsByCharge={internatComponentIdsByCharge}
                  recoverableTotal={internatCharges.reduce(
                    (sum, charge) =>
                      sum +
                      Number(charge.net_amount || 0) +
                      getNewOptionalInternatAnnexesExpectedTotal(
                        charge,
                        internatComponentIdsByCharge[charge.charge_id] ?? [],
                      ),
                    0,
                  )}
                  onAmountChange={(chargeId, value) =>
                    setInternatAmounts((prev) => ({
                      ...prev,
                      [chargeId]: value,
                    }))
                  }
                  onComponentChange={(chargeId, componentIds) =>
                    setInternatComponentIdsByCharge((prev) => ({
                      ...prev,
                      [chargeId]: componentIds,
                    }))
                  }
                />
              ) : null}

              {otherCharges.length > 0 ? (
                <OtherFeesPaymentPlanner
                  charges={otherCharges}
                  amounts={internatAmounts}
                  onAmountChange={(chargeId, value) =>
                    setInternatAmounts((prev) => ({
                      ...prev,
                      [chargeId]: value,
                    }))
                  }
                />
              ) : null}

              <PaymentFields
                paymentType={paymentType}
                setPaymentType={setPaymentType}
                expectedAmount={expectedAmount}
                setExpectedAmount={setExpectedAmount}
                amount={amount}
                setAmount={setAmount}
                today={today}
                expectedAmountLocked={true}
                amountLocked={true}
              />

              <div className="grid gap-2 sm:grid-cols-2">
                {optionSelectionPlan.length > 0 ? (
                  <button
                    type="submit"
                    formAction={optionsAction}
                    formNoValidate
                    disabled={!selectedStudent.profile_complete}
                    className="inline-flex w-full items-center justify-center rounded-2xl border border-emerald-300 bg-white px-4 py-3 text-sm font-bold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                  >
                    Enregistrer les options et recalculer la dette
                  </button>
                ) : null}
                <PendingButton
                  icon={<CreditCard className="h-4 w-4" />}
                  label="Enregistrer le paiement"
                  pendingLabel="Enregistrement en cours..."
                  disabled={!canCreatePayment}
                />
              </div>
            </div>
          )}
        </form>
      </div>
      ) : null}

      {activeWorkflow === "new" ? (
      <form
        action={action}
        className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
          <UserPlus className="h-4 w-4 text-emerald-600" />
          Nouvelle inscription
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Créez simplement le dossier élève. Après l’inscription, vous pourrez
          gérer ses frais et paiements dans l’encaissement normal.
        </p>

        <input type="hidden" name="mode" value="new" />
        <input type="hidden" name="class_id" value={newClassId} />

        <div className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Nom
              </label>
              <input
                name="last_name"
                required
                placeholder="Ex. KOUADIO"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Prénom(s)
              </label>
              <input
                name="first_name"
                required
                placeholder="Ex. Ali"
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Matricule
            </label>
            <input
              name="matricule"
              placeholder="Facultatif, à saisir si l’école l’a déjà attribué"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
            />
            <p className="mt-1 text-xs text-slate-500">
              Aucun matricule n’est généré automatiquement.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Classe
            </label>
            <select
              value={newClassId}
              onChange={(e) => setNewClassId(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
            >
              {classes.length === 0 ? (
                <option value="">Aucune classe</option>
              ) : null}
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.label}
                  {cls.level ? ` — ${cls.level}` : ""}
                  {cls.academic_year ? ` — ${cls.academic_year}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Affectation
              </label>
              <select
                name="is_affecte"
                required
                defaultValue=""
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
              >
                <option value="" disabled>
                  Choisir le statut
                </option>
                <option value="true">Affecté</option>
                <option value="false">Non affecté</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                Régime internat
              </label>
              <select
                name="is_boarder"
                required
                defaultValue=""
                className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
              >
                <option value="" disabled>
                  Choisir le statut
                </option>
                <option value="true">Interne</option>
                <option value="false">Externe</option>
              </select>
            </div>
          </div>

          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            Ces deux statuts sont obligatoires avant la génération des dettes.
            Le système créera uniquement l’écolage Affecté ou Non affecté
            correspondant, et ajoutera l’internat seulement pour un élève
            déclaré Interne.
          </div>

          <PendingButton
            icon={<UserPlus className="h-4 w-4" />}
            label="Inscrire l’élève"
            pendingLabel="Inscription en cours..."
            disabled={!newClassId}
          />
        </div>
      </form>
      ) : null}
    </section>
  );
}

function FeeCategorySelect({
  feeCategories,
  selectedCategoryId,
  onChange,
}: {
  feeCategories: FeeCategoryRow[];
  selectedCategoryId: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
        Catégorie
      </label>
      <select
        name="fee_category_id"
        value={selectedCategoryId}
        onChange={(e) => onChange(e.target.value)}
        required
        className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
      >
        {feeCategories.length === 0 ? (
          <option value="">Aucune catégorie</option>
        ) : null}
        {feeCategories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ScolaritePaymentPlanner({
  charges,
  amounts,
  onAmountChange,
}: {
  charges: PaymentStudentRow["open_charges"];
  amounts: Record<string, string>;
  onAmountChange: (chargeId: string, value: string) => void;
}) {
  if (charges.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-amber-300 bg-amber-50 px-4 py-5 text-sm font-semibold text-amber-800">
        Aucun frais de scolarité n’a été trouvé pour cet élève.
      </div>
    );
  }

  const total = charges.reduce(
    (sum, charge) => sum + Number(amounts[charge.charge_id] || 0),
    0,
  );

  return (
    <div className="rounded-3xl border border-sky-200 bg-sky-50/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-sky-800">
            Encaissement scolarité
          </div>
          <p className="mt-1 text-sm text-sky-900/80">
            Saisissez uniquement ce que le parent paie réellement sur les
            lignes internes. Le reçu imprimé restera un reçu de scolarité,
            sans afficher inscription, écolage ou autres libellés internes.
          </p>
        </div>
        <div className="rounded-2xl bg-white px-3 py-2 text-right ring-1 ring-sky-200">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Total encaissé
          </div>
          <div className="mt-1 text-lg font-black text-sky-700">
            {formatMoney(total)}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {charges.map((charge) => {
          const value = amounts[charge.charge_id] ?? "";
          const amountForCharge = Number(value || 0);

          return (
            <div
              key={charge.charge_id}
              className="rounded-3xl border border-sky-100 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-black text-slate-900">
                    {charge.label}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    Attendu : {formatMoney(charge.net_amount)} · Déjà payé :{" "}
                    {formatMoney(charge.paid_amount)} · Reste :{" "}
                    {formatMoney(charge.balance_due)}
                  </div>
                </div>
                <div className="w-full sm:w-44">
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    Montant payé
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={charge.balance_due}
                    step="1"
                    value={value}
                    onChange={(e) =>
                      onAmountChange(charge.charge_id, e.target.value)
                    }
                    disabled={Number(charge.balance_due || 0) <= 0}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                    placeholder={
                      Number(charge.balance_due || 0) <= 0 ? "Soldé" : "0"
                    }
                  />
                </div>
              </div>

              {amountForCharge > Number(charge.balance_due || 0) ? (
                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  Le montant dépasse le reste dû pour cette ligne.
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InternatPaymentPlanner({
  charges,
  amounts,
  componentIdsByCharge,
  recoverableTotal,
  onAmountChange,
  onComponentChange,
}: {
  charges: PaymentStudentRow["open_charges"];
  amounts: Record<string, string>;
  componentIdsByCharge: Record<string, string[]>;
  recoverableTotal: number;
  onAmountChange: (chargeId: string, value: string) => void;
  onComponentChange: (chargeId: string, componentIds: string[]) => void;
}) {
  if (charges.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-amber-300 bg-amber-50 px-4 py-5 text-sm font-semibold text-amber-800">
        Aucun frais d’internat n’a été trouvé pour cet élève.
      </div>
    );
  }

  const total = charges.reduce((sum, charge) => {
    if (charge.components.length > 0) {
      return (
        sum +
        charge.components.reduce(
          (inner, component) =>
            inner + getComponentAmount(amounts, charge.charge_id, component.id),
          0,
        )
      );
    }
    return sum + Number(amounts[charge.charge_id] || 0);
  }, 0);

  const retainedAnnexesTotal = charges
    .filter((charge) => charge.components.length > 0)
    .reduce(
      (sum, charge) =>
        sum +
        Number(charge.net_amount || 0) +
        getNewOptionalInternatAnnexesExpectedTotal(
          charge,
          componentIdsByCharge[charge.charge_id] ?? [],
        ),
      0,
    );

  return (
    <div className="rounded-3xl border border-emerald-200 bg-emerald-50/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-800">
            Encaissement internat
          </div>
          <p className="mt-1 text-sm text-emerald-900/80">
            La pension reste fixe. Le socle des frais annexes est obligatoire ;
            les options cochées sont ajoutées au montant attendu, même si elles
            ne sont pas payées immédiatement. Paiement partiel possible par
            sous-rubrique.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-2xl bg-white px-3 py-2 text-right ring-1 ring-emerald-200">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
              Annexes retenues
            </div>
            <div className="mt-1 text-lg font-black text-slate-900">
              {formatMoney(retainedAnnexesTotal)}
            </div>
          </div>
          <div className="rounded-2xl bg-white px-3 py-2 text-right ring-1 ring-emerald-200">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
              Total internat
            </div>
            <div className="mt-1 text-lg font-black text-slate-900">
              {formatMoney(recoverableTotal)}
            </div>
          </div>
          <div className="rounded-2xl bg-white px-3 py-2 text-right ring-1 ring-emerald-200">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
              Total à encaisser
            </div>
            <div className="mt-1 text-lg font-black text-emerald-700">
              {formatMoney(total)}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {charges.map((charge) => {
          const selectedIds = componentIdsByCharge[charge.charge_id] ?? [];
          const componentTotal = charge.components.reduce(
            (sum, component) =>
              sum + getComponentAmount(amounts, charge.charge_id, component.id),
            0,
          );
          const chargeAmount =
            charge.components.length > 0
              ? componentTotal
              : Number(amounts[charge.charge_id] || 0);
          const chargeLimit = getComponentDrivenChargeLimit(
            charge,
            selectedIds,
          );
          const isPension = isPensionCharge(charge.label);

          return (
            <div
              key={charge.charge_id}
              className="rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-black text-slate-900">
                    {charge.label}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    Attendu actualisé :{" "}
                    {formatMoney(
                      Number(charge.net_amount || 0) +
                        getNewOptionalInternatAnnexesExpectedTotal(
                          charge,
                          selectedIds,
                        ),
                    )}{" "}
                    · Déjà payé : {formatMoney(charge.paid_amount)} · Reste
                    actualisé : {formatMoney(chargeLimit)}
                  </div>
                  {isPension ? (
                    <div className="mt-1 text-xs font-semibold text-emerald-700">
                      La pension apparaîtra sur le reçu, même si le montant payé
                      ici est 0 F.
                    </div>
                  ) : null}
                </div>
                <div className="w-full sm:w-44">
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    Montant payé
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={chargeLimit}
                    step="1"
                    value={
                      charge.components.length > 0
                        ? String(componentTotal || 0)
                        : (amounts[charge.charge_id] ?? (isPension ? "0" : ""))
                    }
                    onChange={(e) =>
                      onAmountChange(charge.charge_id, e.target.value)
                    }
                    disabled={
                      charge.components.length > 0 ||
                      Number(charge.balance_due || 0) <= 0
                    }
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </div>
              </div>

              {charge.components.length > 0 ? (
                <ChargeComponentChecklist
                  chargeId={charge.charge_id}
                  components={charge.components}
                  amounts={amounts}
                  onAmountChange={onAmountChange}
                  selectedComponentIds={selectedIds}
                  onChange={(nextIds) =>
                    onComponentChange(charge.charge_id, nextIds)
                  }
                  remainingAmount={chargeLimit}
                />
              ) : null}

              {chargeAmount > chargeLimit ? (
                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  Le montant dépasse le reste dû pour cette ligne.
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChargeComponentChecklist({
  chargeId,
  components,
  amounts,
  onAmountChange,
  selectedComponentIds,
  onChange,
  remainingAmount,
}: {
  chargeId: string;
  components: FeeComponentOption[];
  amounts: Record<string, string>;
  onAmountChange: (key: string, value: string) => void;
  selectedComponentIds: string[];
  onChange: (value: string[]) => void;
  remainingAmount: number;
}) {
  if (components.length === 0) return null;

  const selectedTotal = components.reduce(
    (sum, component) =>
      sum + getComponentAmount(amounts, chargeId, component.id),
    0,
  );

  function updateComponent(componentId: string, value: string) {
    const numeric = Number(value || 0);
    const nextIds = new Set(selectedComponentIds);
    const component = components.find((item) => item.id === componentId);
    if (Number.isFinite(numeric) && numeric > 0) nextIds.add(componentId);
    else if (!component?.is_optional) nextIds.delete(componentId);
    onChange(Array.from(nextIds));
    onAmountChange(componentAmountKey(chargeId, componentId), value);
  }

  function toggleOptionalComponent(component: FeeComponentOption, checked: boolean) {
    const nextIds = new Set(selectedComponentIds);
    if (checked) nextIds.add(component.id);
    else {
      if (component.paid_amount > 0) return;
      nextIds.delete(component.id);
      onAmountChange(componentAmountKey(chargeId, component.id), "");
    }
    onChange(Array.from(nextIds));
  }

  return (
    <div className="rounded-3xl border border-emerald-200 bg-emerald-50/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-emerald-800">
            Détail des frais annexes
          </div>
          <p className="mt-1 text-sm text-emerald-900/80">
            Cochez les options réellement retenues, puis saisissez séparément le
            montant payé maintenant. Une option cochée peut donc être facturée
            avec un paiement actuel de 0 F.
          </p>
        </div>
        <div className="rounded-2xl bg-white px-3 py-2 text-right ring-1 ring-emerald-200">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Total saisi
          </div>
          <div className="mt-1 text-lg font-black text-emerald-700">
            {formatMoney(selectedTotal)}
          </div>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-emerald-100 bg-white">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[1fr_110px_110px_140px] gap-2 bg-emerald-50 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-emerald-800">
            <div>Sous-rubrique</div>
            <div className="text-right">Attendu</div>
            <div className="text-right">Déjà payé</div>
            <div className="text-right">Payé maintenant</div>
          </div>
          {components.map((component) => {
            const value =
              amounts[componentAmountKey(chargeId, component.id)] ?? "";
            const settled = Number(component.remaining_amount || 0) <= 0;
            const selected = selectedComponentIds.includes(component.id);

            return (
              <div
                key={component.id}
                className="grid grid-cols-[1fr_110px_110px_140px] items-center gap-2 border-t border-emerald-50 px-3 py-2 text-sm"
              >
                <div className="min-w-0 font-semibold text-slate-800">
                  {component.is_optional ? (
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={component.paid_amount > 0}
                      onChange={(event) =>
                        toggleOptionalComponent(component, event.target.checked)
                      }
                      className="mr-2 h-4 w-4 rounded border-slate-300 align-middle accent-emerald-600"
                      aria-label={`Facturer l'option ${component.label}`}
                    />
                  ) : null}
                  <span>{component.label}</span>
                  {component.is_optional ? (
                    <span
                      className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ring-1 ${
                        selected
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                          : "bg-amber-50 text-amber-700 ring-amber-200"
                      }`}
                    >
                      {selected ? "option engagée" : "option non retenue"}
                    </span>
                  ) : null}
                  {settled ? (
                    <span className="ml-2 inline-flex rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
                      soldé
                    </span>
                  ) : null}
                </div>
                <div className="text-right font-black text-slate-900">
                  {formatMoney(component.amount)}
                </div>
                <div className="text-right font-bold text-emerald-700">
                  {formatMoney(component.paid_amount)}
                </div>
                <input
                  type="number"
                  min="0"
                  max={component.remaining_amount}
                  step="1"
                  value={value}
                  onChange={(e) =>
                    updateComponent(component.id, e.target.value)
                  }
                  disabled={settled}
                  placeholder={settled ? "Soldé" : "0"}
                  className="w-full rounded-xl border border-slate-200 px-2 py-1.5 text-right text-sm font-bold text-slate-900 outline-none focus:border-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-slate-600">
        <button
          type="button"
          onClick={() => {
            const payableComponents = components.filter(
              (component) => Number(component.remaining_amount || 0) > 0,
            );
            onChange(payableComponents.map((component) => component.id));
            for (const component of components) {
              onAmountChange(
                componentAmountKey(chargeId, component.id),
                Number(component.remaining_amount || 0) > 0
                  ? String(component.remaining_amount)
                  : "",
              );
            }
          }}
          className="rounded-full bg-white px-3 py-1.5 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50"
        >
          Tout mettre au maximum
        </button>
        <button
          type="button"
          onClick={() => {
            onChange(
              components
                .filter(
                  (component) =>
                    component.is_optional &&
                    (selectedComponentIds.includes(component.id) ||
                      component.paid_amount > 0),
                )
                .map((component) => component.id),
            );
            for (const component of components) {
              onAmountChange(componentAmountKey(chargeId, component.id), "");
            }
          }}
          className="rounded-full bg-white px-3 py-1.5 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
        >
          Vider les montants
        </button>
        <span>
          Reste avant ce paiement : {formatMoney(remainingAmount)} · Après ce
          paiement : {formatMoney(Math.max(remainingAmount - selectedTotal, 0))}
        </span>
      </div>
    </div>
  );
}


function OtherFeesPaymentPlanner({
  charges,
  amounts,
  onAmountChange,
}: {
  charges: PaymentStudentRow["open_charges"];
  amounts: Record<string, string>;
  onAmountChange: (chargeId: string, value: string) => void;
}) {
  if (charges.length === 0) return null;

  const total = charges.reduce(
    (sum, charge) => sum + Number(amounts[charge.charge_id] || 0),
    0,
  );

  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-800">
            Frais complémentaires
          </div>
          <p className="mt-1 text-sm text-amber-900/80">
            Kit livre, cours de renforcement et autres frais.
          </p>
        </div>
        <div className="rounded-2xl bg-white px-3 py-2 text-right ring-1 ring-amber-200">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            Total encaissé
          </div>
          <div className="mt-1 text-lg font-black text-amber-700">
            {formatMoney(total)}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {charges.map((charge) => {
          const value = amounts[charge.charge_id] ?? "";
          const amountForCharge = Number(value || 0);

          return (
            <div
              key={charge.charge_id}
              className="rounded-3xl border border-amber-100 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-black text-slate-900">
                    {charge.label}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">
                    Attendu : {formatMoney(charge.net_amount)} · Déjà payé :{" "}
                    {formatMoney(charge.paid_amount)} · Reste :{" "}
                    {formatMoney(charge.balance_due)}
                  </div>
                </div>
                <div className="w-full sm:w-44">
                  <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    Montant payé
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={charge.balance_due}
                    step="1"
                    value={value}
                    onChange={(e) =>
                      onAmountChange(charge.charge_id, e.target.value)
                    }
                    disabled={Number(charge.balance_due || 0) <= 0}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-900 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                    placeholder={
                      Number(charge.balance_due || 0) <= 0 ? "Soldé" : "0"
                    }
                  />
                </div>
              </div>

              {amountForCharge > Number(charge.balance_due || 0) ? (
                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  Le montant dépasse le reste dû pour cette ligne.
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PaymentFields({
  paymentType,
  setPaymentType,
  expectedAmount,
  setExpectedAmount,
  amount,
  setAmount,
  today,
  expectedAmountLocked,
  amountLocked,
}: {
  paymentType: string;
  setPaymentType: (value: string) => void;
  expectedAmount: string;
  setExpectedAmount: (value: string) => void;
  amount: string;
  setAmount: (value: string) => void;
  today: string;
  expectedAmountLocked: boolean;
  amountLocked: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
            Montant attendu
          </label>
          <input
            type="number"
            name="expected_amount"
            min="0"
            step="0.01"
            value={expectedAmount}
            onChange={(e) => setExpectedAmount(e.target.value)}
            readOnly={expectedAmountLocked}
            placeholder="Renseigné automatiquement si le frais existe"
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 read-only:bg-slate-100 read-only:text-slate-600"
          />
          <p className="mt-1 text-xs text-slate-500">
            {expectedAmountLocked
              ? "Montant repris automatiquement depuis le frais ouvert sélectionné."
              : "À saisir seulement si le frais n’existe pas encore."}
          </p>
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
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            readOnly={amountLocked}
            placeholder="Ex. 25000"
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 read-only:bg-slate-100 read-only:text-slate-600"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
            Type de paiement
          </label>
          <select
            name="payment_type"
            value={paymentType}
            onChange={(e) => setPaymentType(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
          >
            <option value="cash">Espèces</option>
            <option value="mobile_money">Mobile Money</option>
            <option value="bank_deposit">Versement bancaire</option>
            <option value="bank_transfer">Virement bancaire</option>
            <option value="cheque">Chèque</option>
            <option value="card">Carte bancaire</option>
            <option value="other">Autre</option>
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
            Référence paiement
          </label>
          <input
            type="text"
            name="reference_no"
            placeholder="N° reçu banque, transaction, chèque..."
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
            Nom du payeur
          </label>
          <input
            type="text"
            name="payer_name"
            placeholder="Parent / tuteur / élève"
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
            Date
          </label>
          <input
            type="date"
            name="payment_date"
            defaultValue={today}
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
          Note interne
        </label>
        <textarea
          name="notes"
          rows={3}
          placeholder="Commentaire interne, précision utile..."
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
        />
      </div>
    </div>
  );
}
