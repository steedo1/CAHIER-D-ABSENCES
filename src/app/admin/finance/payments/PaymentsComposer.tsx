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
};

function normalize(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function formatMoney(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
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

  const [selectedLevel, setSelectedLevel] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedChargeId, setSelectedChargeId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [paymentType, setPaymentType] = useState("free");
  const [amount, setAmount] = useState("");
  const [expectedAmount, setExpectedAmount] = useState("");
  const [newClassId, setNewClassId] = useState("");

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
      .filter((cls) => normalize(cls.level || "Sans niveau") === normalize(selectedLevel))
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
    if (!selectedClassId || query.length < 2) return [];

    return rows.filter((row) => {
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
  }, [query, rows, selectedClassId]);

  useEffect(() => {
    if (!filteredRows.some((row) => row.student_id === selectedStudentId)) {
      setSelectedStudentId("");
      setSelectedChargeId("");
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

  useEffect(() => {
    if (!selectedStudent) {
      setSelectedChargeId("");
      setAmount("");
      return;
    }

    const firstCharge = selectedStudent.open_charges[0];
    if (firstCharge && !selectedChargeId) {
      setSelectedChargeId(firstCharge.charge_id);
      setSelectedCategoryId(firstCharge.fee_category_id);
      setAmount(String(firstCharge.balance_due));
      setExpectedAmount(String(firstCharge.net_amount));
    }
  }, [selectedChargeId, selectedStudent]);

  useEffect(() => {
    if (selectedCharge) {
      setSelectedCategoryId(selectedCharge.fee_category_id);
      setAmount(String(selectedCharge.balance_due));
      setExpectedAmount(String(selectedCharge.net_amount));
    }
  }, [selectedCharge?.charge_id]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const canCreatePayment = Boolean(
    selectedStudent && selectedClassId && selectedCategoryId && Number(amount) > 0,
  );

  return (
    <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
          <Wallet className="h-4 w-4 text-emerald-600" />
          Encaisser un paiement
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Choisissez la classe, puis recherchez par nom ou matricule. Aucun élève
          n’est affiché tant que la recherche n’est pas saisie.
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
              }}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
            >
              {levels.length === 0 ? <option value="">Aucun niveau</option> : null}
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
                      const firstCharge = row.open_charges[0];
                      setSelectedChargeId(firstCharge?.charge_id ?? "");
                      if (firstCharge) {
                        setSelectedCategoryId(firstCharge.fee_category_id);
                        setAmount(String(firstCharge.balance_due));
                        setExpectedAmount(String(firstCharge.net_amount));
                      }
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
                        <div className="mt-2 text-xs font-semibold text-slate-500">
                          {row.class_label} · {row.open_charges.length} frais ouvert(s)
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

        <form action={action} className="mt-5 rounded-[26px] border border-slate-200 bg-slate-50/70 p-4">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <Receipt className="h-4 w-4 text-emerald-600" />
            Paiement
          </div>

          <input type="hidden" name="mode" value="existing" />
          <input type="hidden" name="student_id" value={selectedStudent?.student_id ?? ""} />
          <input type="hidden" name="class_id" value={selectedClassId} />
          <input type="hidden" name="student_charge_id" value={selectedChargeId} />

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
                    <h2 className="mt-3 text-xl font-black">{selectedStudent.student_name}</h2>
                    <p className="mt-1 text-sm text-slate-200">
                      {selectedStudent.class_label} · {selectedStudent.matricule || "Matricule non renseigné"}
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

              {selectedStudent.open_charges.length > 0 ? (
                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                    Frais ouvert à régler
                  </label>
                  <select
                    value={selectedChargeId}
                    onChange={(e) => setSelectedChargeId(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
                  >
                    {selectedStudent.open_charges.map((charge) => (
                      <option key={charge.charge_id} value={charge.charge_id}>
                        {charge.label} — reste {formatMoney(charge.balance_due)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                  Aucune situation ouverte n’est encore créée pour cet élève.
                  Le système la créera automatiquement si un barème existe, ou
                  créera une ligne manuelle à partir du montant attendu.
                </div>
              )}

              <PaymentFields
                feeCategories={feeCategories}
                selectedCategoryId={selectedCategoryId}
                setSelectedCategoryId={setSelectedCategoryId}
                paymentType={paymentType}
                setPaymentType={setPaymentType}
                expectedAmount={expectedAmount}
                setExpectedAmount={setExpectedAmount}
                amount={amount}
                setAmount={setAmount}
                today={today}
              />

              <PendingButton
                icon={<CreditCard className="h-4 w-4" />}
                label="Enregistrer le paiement"
                pendingLabel="Enregistrement en cours..."
                disabled={!canCreatePayment}
              />
            </div>
          )}
        </form>
      </div>

      <form action={action} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
          <UserPlus className="h-4 w-4 text-emerald-600" />
          Nouvelle inscription
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Créez un élève avec le minimum nécessaire, puis encaissez directement
          l’inscription, une tranche ou un versement libre.
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
              {classes.length === 0 ? <option value="">Aucune classe</option> : null}
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.label}
                  {cls.level ? ` — ${cls.level}` : ""}
                  {cls.academic_year ? ` — ${cls.academic_year}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Téléphone parent/tuteur
            </label>
            <input
              name="parent_phone"
              placeholder="Facultatif"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
            />
          </div>

          <PaymentFields
            feeCategories={feeCategories}
            selectedCategoryId={selectedCategoryId}
            setSelectedCategoryId={setSelectedCategoryId}
            paymentType={paymentType}
            setPaymentType={setPaymentType}
            expectedAmount={expectedAmount}
            setExpectedAmount={setExpectedAmount}
            amount={amount}
            setAmount={setAmount}
            today={today}
          />

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            L’élève sera créé en base, rattaché à la classe, puis sa situation
            financière sera créée ou complétée automatiquement au moment du
            paiement.
          </div>

          <PendingButton
            icon={<UserPlus className="h-4 w-4" />}
            label="Inscrire et encaisser"
            pendingLabel="Inscription et encaissement..."
            disabled={!newClassId || !selectedCategoryId || Number(amount) <= 0}
          />
        </div>
      </form>
    </section>
  );
}

function PaymentFields({
  feeCategories,
  selectedCategoryId,
  setSelectedCategoryId,
  paymentType,
  setPaymentType,
  expectedAmount,
  setExpectedAmount,
  amount,
  setAmount,
  today,
}: {
  feeCategories: FeeCategoryRow[];
  selectedCategoryId: string;
  setSelectedCategoryId: (value: string) => void;
  paymentType: string;
  setPaymentType: (value: string) => void;
  expectedAmount: string;
  setExpectedAmount: (value: string) => void;
  amount: string;
  setAmount: (value: string) => void;
  today: string;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
            Catégorie
          </label>
          <select
            name="fee_category_id"
            value={selectedCategoryId}
            onChange={(e) => setSelectedCategoryId(e.target.value)}
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
            <option value="registration">Frais d’inscription</option>
            <option value="installment_1">1ère tranche</option>
            <option value="installment_2">2e tranche</option>
            <option value="installment_3">3e tranche</option>
            <option value="full">Paiement complet</option>
            <option value="free">Versement libre</option>
          </select>
        </div>
      </div>

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
            placeholder="Facultatif si barème déjà défini"
            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
          />
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
            placeholder="Ex. 25000"
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
          Référence / note
        </label>
        <textarea
          name="notes"
          rows={3}
          placeholder="Commentaire interne, référence caisse, précision utile..."
          className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
        />
      </div>
    </div>
  );
}
