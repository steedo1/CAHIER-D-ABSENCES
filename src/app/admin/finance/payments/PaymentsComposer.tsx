"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CreditCard,
  Receipt,
  Search,
  UserRound,
  Wallet,
} from "lucide-react";
import type { PaymentSelectionRow } from "./page";

type ClassRow = {
  id: string;
  label: string;
  level: string | null;
  academic_year: string | null;
};

type Props = {
  classes: ClassRow[];
  rows: PaymentSelectionRow[];
  action: (formData: FormData) => void | Promise<void>;
};

function normalize(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function formatMoney(value: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

export default function PaymentsComposer({ classes, rows, action }: Props) {
  const classesWithDebts = useMemo(() => {
    const classIds = new Set(
      rows.map((row) => row.class_id).filter(Boolean) as string[]
    );

    return classes.filter((cls) => classIds.has(cls.id));
  }, [classes, rows]);

  const levels = useMemo(() => {
    const map = new Map<string, string>();

    for (const cls of classesWithDebts) {
      const label = (cls.level || "Sans niveau").trim();
      const key = normalize(label);
      if (!map.has(key)) {
        map.set(key, label);
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" })
    );
  }, [classesWithDebts]);

  const [selectedLevel, setSelectedLevel] = useState("");
  const [selectedClassId, setSelectedClassId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedChargeId, setSelectedChargeId] = useState("");
  const [amount, setAmount] = useState("");

  useEffect(() => {
    if (!selectedLevel && levels.length > 0) {
      setSelectedLevel(levels[0]);
    }
  }, [levels, selectedLevel]);

  const classOptions = useMemo(() => {
    if (!selectedLevel) return [];

    return classesWithDebts
      .filter(
        (cls) =>
          normalize(cls.level || "Sans niveau") === normalize(selectedLevel)
      )
      .sort((a, b) =>
        a.label.localeCompare(b.label, "fr", {
          numeric: true,
          sensitivity: "base",
        })
      );
  }, [classesWithDebts, selectedLevel]);

  useEffect(() => {
    if (!classOptions.some((cls) => cls.id === selectedClassId)) {
      setSelectedClassId(classOptions[0]?.id ?? "");
      setSearch("");
    }
  }, [classOptions, selectedClassId]);

  const filteredRows = useMemo(() => {
    if (!selectedLevel || !selectedClassId) return [];

    const query = normalize(search);

    return rows
      .filter((row) => {
        if (row.class_id !== selectedClassId) return false;
        if (
          normalize(row.level || "Sans niveau") !== normalize(selectedLevel)
        ) {
          return false;
        }

        if (!query) return true;

        const haystack = [
          row.student_name,
          row.matricule,
          row.class_label,
          row.fee_label,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(query);
      })
      .sort((a, b) => {
        const byName = a.student_name.localeCompare(b.student_name, "fr", {
          sensitivity: "base",
        });
        if (byName !== 0) return byName;
        return a.fee_label.localeCompare(b.fee_label, "fr", {
          sensitivity: "base",
        });
      });
  }, [rows, search, selectedClassId, selectedLevel]);

  useEffect(() => {
    if (!filteredRows.some((row) => row.charge_id === selectedChargeId)) {
      setSelectedChargeId(filteredRows[0]?.charge_id ?? "");
    }
  }, [filteredRows, selectedChargeId]);

  const selectedRow = useMemo(
    () => filteredRows.find((row) => row.charge_id === selectedChargeId) ?? null,
    [filteredRows, selectedChargeId]
  );

  useEffect(() => {
    if (selectedRow) {
      setAmount(String(selectedRow.balance_due));
    } else {
      setAmount("");
    }
  }, [selectedRow?.charge_id]);

  const selectedClass = useMemo(
    () => classOptions.find((cls) => cls.id === selectedClassId) ?? null,
    [classOptions, selectedClassId]
  );

  const totalFilteredDue = useMemo(
    () =>
      filteredRows.reduce((sum, row) => sum + Number(row.balance_due || 0), 0),
    [filteredRows]
  );

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  return (
    <section className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
          <Wallet className="h-4 w-4 text-emerald-600" />
          Sélection de l’élève
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Niveau
            </label>
            <select
              value={selectedLevel}
              onChange={(e) => {
                setSelectedLevel(e.target.value);
                setSelectedClassId("");
                setSelectedChargeId("");
              }}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
            >
              {levels.length === 0 ? (
                <option value="">Aucun niveau disponible</option>
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
                setSelectedChargeId("");
              }}
              disabled={!selectedLevel}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
            >
              {!selectedLevel ? (
                <option value="">Choisir d’abord un niveau</option>
              ) : classOptions.length === 0 ? (
                <option value="">Aucune classe avec dette</option>
              ) : null}

              {classOptions.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.label}
                  {cls.academic_year ? ` — ${cls.academic_year}` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
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
              placeholder="Nom, matricule ou frais"
              className="w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200">
            {selectedLevel || "—"}
          </span>
          <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
            {selectedClass?.label || "Aucune classe"}
          </span>
          <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 ring-1 ring-blue-200">
            {filteredRows.length} élève(s) / dette(s)
          </span>
          <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 ring-1 ring-amber-200">
            {formatMoney(totalFilteredDue)}
          </span>
        </div>

        <div className="mt-5">
          {!selectedClassId ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Choisissez d’abord un niveau puis une classe pour afficher la liste.
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
              Aucun résultat pour cette classe.
            </div>
          ) : (
            <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
              {filteredRows.map((row) => {
                const active = row.charge_id === selectedChargeId;

                return (
                  <button
                    key={row.charge_id}
                    type="button"
                    onClick={() => setSelectedChargeId(row.charge_id)}
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

                        <div className="mt-2 text-sm font-semibold text-slate-700">
                          {row.fee_label}
                        </div>

                        <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                          <div>Classe : {row.class_label}</div>
                          <div>Échéance : {row.due_date || "—"}</div>
                        </div>
                      </div>

                      <div className="shrink-0 rounded-full bg-rose-50 px-3 py-1.5 text-sm font-black text-rose-700 ring-1 ring-rose-200">
                        {formatMoney(row.balance_due)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <form
        action={action}
        className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
          <Receipt className="h-4 w-4 text-emerald-600" />
          Élève sélectionné / paiement
        </div>

        <input
          type="hidden"
          name="student_charge_id"
          value={selectedRow?.charge_id ?? ""}
        />

        {!selectedRow ? (
          <div className="mt-5 rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-600">
            Sélectionnez un élève dans la liste de gauche pour poursuivre l’opération.
          </div>
        ) : (
          <>
            <div className="mt-5 rounded-[26px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-5 text-white shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-100 ring-1 ring-white/15">
                    <UserRound className="h-3.5 w-3.5" />
                    Élève retenu pour l’opération
                  </div>

                  <h2 className="mt-3 text-2xl font-black tracking-tight">
                    {selectedRow.student_name}
                  </h2>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-200">
                    {selectedRow.matricule ? (
                      <span className="rounded-full bg-white/10 px-3 py-1.5 font-bold ring-1 ring-white/15">
                        {selectedRow.matricule}
                      </span>
                    ) : null}
                    <span className="rounded-full bg-white/10 px-3 py-1.5 font-bold ring-1 ring-white/15">
                      {selectedRow.class_label}
                    </span>
                    <span className="rounded-full bg-white/10 px-3 py-1.5 font-bold ring-1 ring-white/15">
                      {selectedRow.level || "Sans niveau"}
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl bg-white/10 px-3 py-2 text-right ring-1 ring-white/15">
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-100">
                    Reste dû
                  </div>
                  <div className="mt-1 text-lg font-black">
                    {formatMoney(selectedRow.balance_due)}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-100">
                    Frais concerné
                  </div>
                  <div className="mt-1 text-sm font-bold text-white">
                    {selectedRow.fee_label}
                  </div>
                </div>

                <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-100">
                    Échéance
                  </div>
                  <div className="mt-1 text-sm font-bold text-white">
                    {selectedRow.due_date || "—"}
                  </div>
                </div>

                <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-100">
                    Montant brut
                  </div>
                  <div className="mt-1 text-sm font-bold text-white">
                    {formatMoney(selectedRow.net_amount)}
                  </div>
                </div>

                <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
                  <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-100">
                    Déjà payé
                  </div>
                  <div className="mt-1 text-sm font-bold text-white">
                    {formatMoney(selectedRow.paid_amount)}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 space-y-4">
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
                <p className="mt-1 text-xs text-slate-500">
                  Maximum autorisé : {formatMoney(selectedRow.balance_due)}
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Nom du payeur
                </label>
                <input
                  type="text"
                  name="payer_name"
                  placeholder="Ex. Parent / Tuteur"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Référence
                </label>
                <input
                  type="text"
                  name="reference_no"
                  placeholder="Ex. Versement caisse 001"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Date d’encaissement
                </label>
                <input
                  type="date"
                  name="payment_date"
                  defaultValue={today}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Notes
                </label>
                <textarea
                  name="notes"
                  rows={4}
                  placeholder="Commentaire interne"
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
                />
              </div>

              <button className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-emerald-700">
                <CreditCard className="h-4 w-4" />
                Enregistrer le paiement
              </button>
            </div>
          </>
        )}
      </form>
    </section>
  );
}