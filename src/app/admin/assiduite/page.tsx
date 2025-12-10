// src/app/admin/assiduite/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Filter,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from "lucide-react";

type ClassRow = {
  id: string;
  name: string;
  level?: string | null;
  academic_year?: string | null;
};

type JustifRow = {
  mark_id: string;
  student_id: string;
  student_name: string;
  matricule: string | null;
  class_id: string;
  class_label: string | null;
  class_level: string | null;
  subject_id: string | null;
  subject_name: string | null;
  started_at: string;
  status: string;
  minutes: number;
  minutes_late: number;
  reason: string | null;

  // champ optionnel (plus utilisé pour l'affichage, chaque ligne = 1 marque)
  absence_mark_count_for_student?: number;
};

/* ───────── UI helpers ───────── */
function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm",
        "outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        props.className ?? "",
      ].join(" ")}
    />
  );
}
function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm",
        "outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        props.className ?? "",
      ].join(" ")}
    />
  );
}
function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm",
        "outline-none transition resize-none",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

/* ───────── Helpers métier ───────── */

function formatDateTime(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatStatus(row: JustifRow) {
  // ✅ ABSENCE : chaque ligne représente UNE marque pour UN créneau.
  // On n'affiche plus le cumul d'heures sur la période pour l'élève.
  if (row.status === "absent") {
    return "Absent • 1h d’absence (1 marque)";
  }

  // ✅ RETARD : on garde les minutes réelles de retard
  if (row.minutes_late > 0) {
    return `Retard • ${Math.round(row.minutes_late)} min`;
  }

  return row.status || "—";
}

function defaultDates() {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const d2 = new Date(now);
  d2.setDate(d2.getDate() - 7);
  const from = d2.toISOString().slice(0, 10);
  return { from, to };
}

export default function AssiduiteJustificationsPage() {
  const { from: defFrom, to: defTo } = useMemo(() => defaultDates(), []);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classId, setClassId] = useState<string>("");
  const [from, setFrom] = useState<string>(defFrom);
  const [to, setTo] = useState<string>(defTo);
  const [status, setStatus] = useState<"all" | "absent" | "late">("all");
  const [onlyUnjustified, setOnlyUnjustified] = useState<boolean>(true);

  const [items, setItems] = useState<JustifRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingReason, setEditingReason] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  /* ───────── Chargement des classes ───────── */
  useEffect(() => {
    async function loadClasses() {
      try {
        setLoadingClasses(true);
        const res = await fetch("/api/admin/classes");
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || "Erreur chargement des classes.");
        }
        const arr: ClassRow[] = Array.isArray(data?.items) ? data.items : [];
        setClasses(arr);
      } catch (e: any) {
        console.error("[assiduite] loadClasses error", e);
      } finally {
        setLoadingClasses(false);
      }
    }
    loadClasses();
  }, []);

  /* ───────── Chargement des marques ───────── */
  async function loadMarks() {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (classId) params.set("class_id", classId);
      if (status !== "all") params.set("status", status);
      if (onlyUnjustified) params.set("only_unjustified", "1");
      else params.set("only_unjustified", "0");

      const res = await fetch(
        `/api/admin/attendance/unjustified?${params.toString()}`
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Erreur chargement des absences.");
      }
      const arr: JustifRow[] = Array.isArray(data?.items) ? data.items : [];
      setItems(arr);
    } catch (e: any) {
      console.error("[assiduite] loadMarks error", e);
      setError(e?.message || "Erreur lors du chargement des données.");
      setItems([]);
    } finally {
      setLoading(false);
      setEditingId(null);
      setEditingReason("");
    }
  }

  useEffect(() => {
    // Chargement initial
    loadMarks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ───────── Actions ───────── */

  function startEdit(row: JustifRow) {
    setEditingId(row.mark_id);
    setEditingReason(row.reason ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingReason("");
  }

  async function saveJustification() {
    if (!editingId) return;
    const reason = (editingReason || "").trim();
    if (!reason) {
      setError("Merci de saisir un motif de justification.");
      return;
    }

    try {
      setSavingId(editingId);
      setError(null);

      const res = await fetch("/api/admin/attendance/unjustified", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ mark_id: editingId, reason }],
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || "Erreur lors de la justification.");
      }

      // Comme on ne liste que les non justifiés, on retire la ligne de la liste
      setItems((prev) => prev.filter((it) => it.mark_id !== editingId));
      setEditingId(null);
      setEditingReason("");
    } catch (e: any) {
      console.error("[assiduite] saveJustification error", e);
      setError(e?.message || "Impossible d’enregistrer la justification.");
    } finally {
      setSavingId(null);
    }
  }

  const isEmpty = !loading && items.length === 0;

  return (
    <main className="px-4 py-6 md:px-8 md:py-8">
      <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 md:text-xl">
            Assiduité — Justification des absences & retards
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Espace vie scolaire / éducateur pour valider les justificatifs
            fournis par les familles.
          </p>
        </div>
      </header>

      {/* Filtres */}
      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
          <Filter className="h-4 w-4" />
          Filtres
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Classe
            </label>
            <Select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              disabled={loadingClasses}
            >
              <option value="">Toutes les classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.level ? ` — ${c.level}` : ""}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Du
            </label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">
              Au
            </label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Type
              </label>
              <Select
                value={status}
                onChange={(e) =>
                  setStatus(
                    (e.target.value as "all" | "absent" | "late") || "all"
                  )
                }
              >
                <option value="all">Absences & retards</option>
                <option value="absent">Absences seulement</option>
                <option value="late">Retards seulement</option>
              </Select>
            </div>

            <div className="flex items-center gap-2 pt-5 md:pt-7">
              <input
                id="only-unjustified"
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                checked={onlyUnjustified}
                onChange={(e) => setOnlyUnjustified(e.target.checked)}
              />
              <label
                htmlFor="only-unjustified"
                className="text-xs text-slate-700"
              >
                Afficher uniquement les événements non justifiés
              </label>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={loadMarks}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Rechercher
          </button>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            <span>
              Période : {from || "…"} → {to || "…"}
            </span>
          </div>
        </div>
      </section>

      {/* Erreur */}
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Tableau des événements */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-sm font-medium text-slate-800">
            {onlyUnjustified
              ? "Événements à justifier"
              : "Événements d’assiduité (avec justification éventuelle)"}
          </div>
          <div className="text-xs text-slate-500">
            {loading
              ? "Chargement…"
              : `${items.length} ligne(s) sur cette période`}
          </div>
        </div>

        {isEmpty ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            Aucune absence ou retard à justifier sur cette période.
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="border-b border-slate-200 text-xs text-slate-600">
                  <th className="px-3 py-2 text-left">Date / heure</th>
                  <th className="px-3 py-2 text-left">Classe</th>
                  <th className="px-3 py-2 text-left">Élève</th>
                  <th className="px-3 py-2 text-left">Matière</th>
                  <th className="px-3 py-2 text-left">Statut</th>
                  <th className="px-3 py-2 text-left w-[280px]">
                    Justification
                  </th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const isEditing = editingId === row.mark_id;
                  const isSaving = savingId === row.mark_id;
                  return (
                    <tr
                      key={row.mark_id}
                      className="border-b border-slate-100 hover:bg-slate-50/60"
                    >
                      <td className="px-3 py-2 align-top text-xs text-slate-700">
                        {formatDateTime(row.started_at)}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-slate-700">
                        <div className="font-medium">
                          {row.class_label || "—"}
                        </div>
                        {row.class_level && (
                          <div className="text-[11px] text-slate-500">
                            {row.class_level}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-slate-700">
                        <div className="font-semibold">
                          {row.student_name || "—"}
                        </div>
                        {row.matricule && (
                          <div className="text-[11px] text-slate-500">
                            Matricule : {row.matricule}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-slate-700">
                        {row.subject_name || "—"}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-slate-700">
                        {formatStatus(row)}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-slate-700">
                        {isEditing ? (
                          <Textarea
                            rows={3}
                            value={editingReason}
                            onChange={(e) => setEditingReason(e.target.value)}
                            placeholder="Motif : certificat médical, cas de force majeure, autorisation parentale…"
                          />
                        ) : row.reason ? (
                          <div className="text-xs text-slate-700">
                            {row.reason}
                          </div>
                        ) : (
                          <div className="text-xs italic text-slate-400">
                            Non justifié
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-right text-xs">
                        {isEditing ? (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={isSaving}
                              className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                              Annuler
                            </button>
                            <button
                              type="button"
                              onClick={saveJustification}
                              disabled={isSaving}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
                            >
                              {isSaving && (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              )}
                              Valider
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(row)}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Justifier
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
