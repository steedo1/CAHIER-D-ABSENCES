"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertCircle,
  BadgeCheck,
  CreditCard,
  Loader2,
  PlusCircle,
  Receipt,
  Search,
  UserPlus,
  UserRound,
  Wallet,
} from "lucide-react";
import type {
  ClassOptionRow,
  FeeCategoryOptionRow,
  PaymentStudentRow,
  PaymentSelectionRow,
} from "./page";

type Props = {
  classes: ClassOptionRow[];
  students: PaymentStudentRow[];
  categories: FeeCategoryOptionRow[];
  rows: PaymentSelectionRow[];
  action: (formData: FormData) => void | Promise<void>;
};

function normalize(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function formatMoney(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function levelLabel(value: string | null | undefined) {
  return String(value || "Sans niveau").trim() || "Sans niveau";
}

function SubmitButton({ label, pending }: { label: string; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-wait disabled:bg-slate-400"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
      {pending ? "Enregistrement en cours..." : label}
    </button>
  );
}

export default function PaymentsComposer({ classes, students, categories, rows, action }: Props) {
  const [tab, setTab] = useState<"existing" | "new">("existing");
  const [selectedLevel, setSelectedLevel] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [selectedChargeId, setSelectedChargeId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [paymentKind, setPaymentKind] = useState("Versement libre");
  const [expectedAmount, setExpectedAmount] = useState("");
  const [amount, setAmount] = useState("");
  const [isPending, startTransition] = useTransition();

  const levels = useMemo(() => {
    const map = new Map<string, string>();
    for (const cls of classes) {
      const label = levelLabel(cls.level);
      const key = normalize(label);
      if (!map.has(key)) map.set(key, label);
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" }));
  }, [classes]);

  useEffect(() => {
    if (!selectedLevel && levels.length > 0) setSelectedLevel(levels[0]);
  }, [levels, selectedLevel]);

  const classOptions = useMemo(() => {
    if (!selectedLevel) return [];
    return classes
      .filter((cls) => normalize(levelLabel(cls.level)) === normalize(selectedLevel))
      .sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true, sensitivity: "base" }));
  }, [classes, selectedLevel]);

  useEffect(() => {
    if (!classOptions.some((cls) => cls.id === selectedClassId)) {
      setSelectedClassId(classOptions[0]?.id ?? "");
      setSearch("");
      setSelectedStudentId("");
      setSelectedChargeId("");
    }
  }, [classOptions, selectedClassId]);

  useEffect(() => {
    if (!selectedCategoryId && categories.length > 0) {
      const inscription = categories.find((c) => normalize(c.name).includes("inscription"));
      setSelectedCategoryId((inscription || categories[0]).id);
    }
  }, [categories, selectedCategoryId]);

  const studentsInClass = useMemo(() => {
    if (!selectedClassId) return [];
    const query = normalize(search);
    if (query.length < 2) return [];

    return students
      .filter((student) => student.class_id === selectedClassId)
      .filter((student) => {
        const haystack = normalize([student.full_name, student.matricule, student.class_label].filter(Boolean).join(" "));
        return haystack.includes(query);
      })
      .slice(0, 12);
  }, [students, selectedClassId, search]);

  useEffect(() => {
    if (!studentsInClass.some((s) => s.id === selectedStudentId)) {
      setSelectedStudentId("");
      setSelectedChargeId("");
    }
  }, [studentsInClass, selectedStudentId]);

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) ?? null,
    [students, selectedStudentId],
  );

  const studentCharges = useMemo(() => {
    if (!selectedStudentId) return [];
    return rows
      .filter((row) => row.student_id === selectedStudentId && Number(row.balance_due || 0) > 0)
      .sort((a, b) => a.fee_label.localeCompare(b.fee_label, "fr", { sensitivity: "base" }));
  }, [rows, selectedStudentId]);

  useEffect(() => {
    if (!studentCharges.some((row) => row.charge_id === selectedChargeId)) {
      setSelectedChargeId(studentCharges[0]?.charge_id ?? "");
    }
  }, [studentCharges, selectedChargeId]);

  const selectedCharge = useMemo(
    () => studentCharges.find((row) => row.charge_id === selectedChargeId) ?? null,
    [studentCharges, selectedChargeId],
  );

  useEffect(() => {
    if (selectedCharge) {
      setExpectedAmount(String(selectedCharge.net_amount));
      setAmount(String(selectedCharge.balance_due));
      const cat = categories.find((c) => c.id === selectedCharge.fee_category_id);
      if (cat) setSelectedCategoryId(cat.id);
      return;
    }
    setAmount("");
  }, [selectedCharge?.charge_id]);

  const selectedClass = useMemo(
    () => classes.find((cls) => cls.id === selectedClassId) ?? null,
    [classes, selectedClassId],
  );

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  );

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  function submitWithTransition(formData: FormData) {
    startTransition(() => {
      void action(formData);
    });
  }

  return (
    <section className="space-y-5">
      <div className="grid gap-3 rounded-[28px] border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setTab("existing")}
          className={`rounded-[22px] px-4 py-4 text-left transition ${
            tab === "existing" ? "bg-slate-950 text-white shadow-sm" : "bg-slate-50 text-slate-700 hover:bg-slate-100"
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-black">
            <Wallet className="h-4 w-4" /> Encaissement élève existant
          </div>
          <div className={`mt-1 text-xs ${tab === "existing" ? "text-slate-200" : "text-slate-500"}`}>
            Niveau, classe, puis recherche par matricule ou nom.
          </div>
        </button>
        <button
          type="button"
          onClick={() => setTab("new")}
          className={`rounded-[22px] px-4 py-4 text-left transition ${
            tab === "new" ? "bg-emerald-700 text-white shadow-sm" : "bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-black">
            <UserPlus className="h-4 w-4" /> Nouvelle inscription
          </div>
          <div className={`mt-1 text-xs ${tab === "new" ? "text-emerald-50" : "text-emerald-700"}`}>
            Créer l’élève et enregistrer inscription ou première tranche.
          </div>
        </button>
      </div>

      {tab === "existing" ? (
        <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
              <Search className="h-4 w-4 text-emerald-600" /> Recherche ciblée
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Niveau</label>
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
                  {levels.length === 0 ? <option value="">Aucun niveau disponible</option> : null}
                  {levels.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Classe</label>
                <select
                  value={selectedClassId}
                  onChange={(e) => {
                    setSelectedClassId(e.target.value);
                    setSelectedStudentId("");
                    setSelectedChargeId("");
                    setSearch("");
                  }}
                  disabled={!selectedLevel}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                >
                  {!selectedLevel ? <option value="">Choisir d’abord un niveau</option> : null}
                  {classOptions.map((cls) => (
                    <option key={cls.id} value={cls.id}>{cls.label}{cls.academic_year ? ` — ${cls.academic_year}` : ""}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Matricule ou nom</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  disabled={!selectedClassId}
                  placeholder="Tapez au moins 2 caractères"
                  className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200">{selectedLevel || "—"}</span>
              <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">{selectedClass?.label || "Aucune classe"}</span>
              <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 ring-1 ring-blue-200">{studentsInClass.length} résultat(s)</span>
            </div>

            <div className="mt-5">
              {!selectedClassId ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">Choisissez d’abord un niveau puis une classe.</div>
              ) : normalize(search).length < 2 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">Aucune longue liste affichée : tapez un matricule ou un nom pour rechercher.</div>
              ) : studentsInClass.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-amber-300 bg-amber-50 px-5 py-10 text-center text-sm text-amber-800">Aucun élève trouvé dans cette classe. Utilisez l’onglet Nouvelle inscription si l’élève arrive pour la première fois.</div>
              ) : (
                <div className="space-y-3">
                  {studentsInClass.map((student) => {
                    const active = student.id === selectedStudentId;
                    const openDebts = rows.filter((row) => row.student_id === student.id).length;
                    return (
                      <button
                        key={student.id}
                        type="button"
                        onClick={() => setSelectedStudentId(student.id)}
                        className={`w-full rounded-3xl border p-4 text-left transition ${active ? "border-emerald-300 bg-emerald-50 shadow-sm" : "border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-slate-50"}`}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-base font-black text-slate-900">{student.full_name}</span>
                              {student.matricule ? <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200">{student.matricule}</span> : null}
                            </div>
                            <div className="mt-1 text-xs font-semibold text-slate-500">{student.class_label || selectedClass?.label || "Classe non définie"}</div>
                          </div>
                          <span className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-slate-700 ring-1 ring-slate-200">{openDebts} solde(s) ouvert(s)</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <form action={submitWithTransition} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
            <input type="hidden" name="operation" value="existing_payment" />
            <input type="hidden" name="student_id" value={selectedStudent?.id ?? ""} />
            <input type="hidden" name="class_id" value={selectedStudent?.class_id ?? selectedClassId} />
            <input type="hidden" name="student_charge_id" value={selectedCharge?.charge_id ?? ""} />

            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
              <Receipt className="h-4 w-4 text-emerald-600" /> Paiement
            </div>

            {!selectedStudent ? (
              <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">Sélectionnez un élève pour poursuivre.</div>
            ) : (
              <div className="mt-5 space-y-4">
                <div className="rounded-[26px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-5 text-white shadow-sm">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-100 ring-1 ring-white/15">
                    <UserRound className="h-3.5 w-3.5" /> Élève sélectionné
                  </div>
                  <h2 className="mt-3 text-2xl font-black tracking-tight">{selectedStudent.full_name}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-200">
                    {selectedStudent.matricule ? <span className="rounded-full bg-white/10 px-3 py-1.5 font-bold ring-1 ring-white/15">{selectedStudent.matricule}</span> : null}
                    <span className="rounded-full bg-white/10 px-3 py-1.5 font-bold ring-1 ring-white/15">{selectedStudent.class_label || selectedClass?.label || "Sans classe"}</span>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Solde existant</label>
                  <select
                    value={selectedChargeId}
                    onChange={(e) => setSelectedChargeId(e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
                  >
                    {studentCharges.length === 0 ? <option value="">Aucun solde ouvert — créer une ligne ci-dessous</option> : null}
                    {studentCharges.map((row) => (
                      <option key={row.charge_id} value={row.charge_id}>{row.fee_label} — reste {formatMoney(row.balance_due)}</option>
                    ))}
                    <option value="">Créer un nouveau frais pour cet élève</option>
                  </select>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Catégorie</label>
                    <select
                      name="fee_category_id"
                      value={selectedCategoryId}
                      onChange={(e) => setSelectedCategoryId(e.target.value)}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
                    >
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Type</label>
                    <select name="payment_kind" value={paymentKind} onChange={(e) => setPaymentKind(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none">
                      <option>Versement libre</option>
                      <option>Frais d’inscription</option>
                      <option>1ère tranche</option>
                      <option>2e tranche</option>
                      <option>3e tranche</option>
                      <option>Paiement complet</option>
                    </select>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Montant attendu</label>
                    <input name="expected_amount" type="number" min="0" step="0.01" value={expectedAmount} onChange={(e) => setExpectedAmount(e.target.value)} placeholder="Ex. 150000" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Montant encaissé</label>
                    <input name="amount" type="number" min="1" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ex. 50000" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none" />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Nom du payeur</label>
                    <input name="payer_name" type="text" placeholder="Parent / tuteur" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Date</label>
                    <input name="payment_date" type="date" defaultValue={today} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none" />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Référence / note</label>
                  <textarea name="notes" rows={3} placeholder="Ex. paiement caisse, Mobile Money, acompte..." className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none" />
                </div>

                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800">
                  <BadgeCheck className="mr-1 inline h-3.5 w-3.5" /> Le reçu affichera la catégorie, le type de versement, le montant payé et le reste à payer.
                </div>

                <SubmitButton label="Enregistrer et générer le reçu" pending={isPending} />
              </div>
            )}
          </form>
        </section>
      ) : (
        <form action={submitWithTransition} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
          <input type="hidden" name="operation" value="new_enrollment_payment" />
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <UserPlus className="h-4 w-4 text-emerald-600" /> Inscription et premier encaissement
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Nom</label>
              <input name="last_name" required placeholder="Ex. KOUADIO" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Prénom(s)</label>
              <input name="first_name" required placeholder="Ex. Ali" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Matricule</label>
              <input name="matricule" placeholder="Auto si vide" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Sexe</label>
              <select name="gender" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none">
                <option value="">Non précisé</option>
                <option value="M">Masculin</option>
                <option value="F">Féminin</option>
              </select>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Date de naissance</label>
              <input name="birthdate" type="date" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Niveau</label>
              <select value={selectedLevel} onChange={(e) => setSelectedLevel(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none">
                {levels.map((level) => <option key={level} value={level}>{level}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Classe</label>
              <select name="class_id" required value={selectedClassId} onChange={(e) => setSelectedClassId(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none">
                {classOptions.map((cls) => <option key={cls.id} value={cls.id}>{cls.label}{cls.academic_year ? ` — ${cls.academic_year}` : ""}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Parent / tuteur</label>
              <input name="payer_name" placeholder="Nom du parent" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none" />
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Téléphone parent</label>
              <input name="parent_phone" placeholder="Ex. 07..." className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Catégorie encaissée</label>
              <select name="fee_category_id" required value={selectedCategoryId} onChange={(e) => setSelectedCategoryId(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none">
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Type</label>
              <select name="payment_kind" defaultValue="Frais d’inscription" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none">
                <option>Frais d’inscription</option>
                <option>1ère tranche</option>
                <option>2e tranche</option>
                <option>3e tranche</option>
                <option>Paiement complet</option>
                <option>Versement libre</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Date</label>
              <input name="payment_date" type="date" defaultValue={today} className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none" />
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Montant attendu</label>
              <input name="expected_amount" type="number" min="0" step="0.01" placeholder="Ex. frais total ou tranche attendue" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Montant encaissé</label>
              <input name="amount" type="number" min="1" step="0.01" required placeholder="Ex. 25000" className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none" />
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Note</label>
            <textarea name="notes" rows={3} placeholder="Ex. inscription rentrée, première tranche scolarité..." className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none" />
          </div>

          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <AlertCircle className="mr-1 inline h-4 w-4" /> L’élève sera créé, rattaché à la classe choisie, puis le reçu sera généré immédiatement.
          </div>

          <div className="mt-5"><SubmitButton label="Inscrire et générer le reçu" pending={isPending} /></div>
        </form>
      )}
    </section>
  );
}
