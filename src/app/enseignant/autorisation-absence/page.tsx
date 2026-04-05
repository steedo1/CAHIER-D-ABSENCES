"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";

type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

type ImpactSlot = {
  date: string;
  class_id: string;
  class_label: string;
  subject_id: string | null;
  subject_name: string;
  period_id: string;
  period_label: string;
  start_time: string | null;
  end_time: string | null;
  lost_hours: number;
};

type ImpactedClassSummary = {
  class_id: string;
  class_label: string;
  lost_hours: number;
  lost_sessions: number;
  slots: ImpactSlot[];
};

type AbsenceImpactSummary = {
  total_lost_hours: number;
  total_lost_sessions: number;
  impacted_classes: ImpactedClassSummary[];
};

type MakeupPlan = {
  proposed_start_date: string | null;
  proposed_end_date: string | null;
  notes: string;
};

type TeacherAbsenceRequestItem = {
  id: string;
  institution_id: string;
  teacher_user_id: string;
  teacher_profile_id: string;
  start_date: string;
  end_date: string;
  reason_code: string;
  reason_label: string;
  details: string;
  requested_days: number;
  signed: boolean;
  source: string;
  status: RequestStatus;
  admin_comment: string | null;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  created_at: string;
  updated_at?: string | null;
  lost_hours_total?: number;
  lost_sessions_total?: number;
  impact_summary?: AbsenceImpactSummary | null;
  makeup_plan?: MakeupPlan | null;
};

type ApiListResponse =
  | { ok: true; items: TeacherAbsenceRequestItem[] }
  | { ok: false; error: string };

type ApiCreateResponse =
  | { ok: true; item: TeacherAbsenceRequestItem; message?: string }
  | { ok: false; error: string };

type ImpactResponse =
  | { ok: true; impact: AbsenceImpactSummary }
  | { ok: false; error: string };

function classNames(...arr: Array<string | false | null | undefined>) {
  return arr.filter(Boolean).join(" ");
}

function formatDate(ymd?: string | null) {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDateTime(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: RequestStatus) {
  switch (status) {
    case "pending":
      return "En attente";
    case "approved":
      return "Approuvée";
    case "rejected":
      return "Rejetée";
    case "cancelled":
      return "Annulée";
    default:
      return status;
  }
}

function statusClasses(status: RequestStatus) {
  switch (status) {
    case "pending":
      return "bg-amber-50 text-amber-800 ring-amber-200";
    case "approved":
      return "bg-emerald-50 text-emerald-800 ring-emerald-200";
    case "rejected":
      return "bg-red-50 text-red-800 ring-red-200";
    case "cancelled":
      return "bg-slate-100 text-slate-700 ring-slate-200";
    default:
      return "bg-slate-100 text-slate-700 ring-slate-200";
  }
}

function daysLabel(n: number) {
  return n <= 1 ? "1 jour" : `${n} jours`;
}

const REASON_OPTIONS = [
  { value: "maladie", label: "Maladie" },
  { value: "formation", label: "Formation" },
  { value: "mission", label: "Mission / déplacement" },
  { value: "evenement_familial", label: "Événement familial" },
  { value: "contrainte_personnelle", label: "Contrainte personnelle" },
  { value: "autre", label: "Autre" },
];

export default function EnseignantAutorisationAbsencePage() {
  const [items, setItems] = useState<TeacherAbsenceRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactPreview, setImpactPreview] = useState<AbsenceImpactSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [form, setForm] = useState({
    start_date: "",
    end_date: "",
    reason_code: "maladie",
    details: "",
    signed: true,
    makeup_start_date: "",
    makeup_end_date: "",
    makeup_notes: "",
  });

  async function load() {
    try {
      setError(null);
      setRefreshing(true);

      const res = await fetch("/api/teacher/absence-requests", {
        method: "GET",
        cache: "no-store",
      });

      const json =
        (await res.json().catch(() => null)) as ApiListResponse | null;

      if (!res.ok || !json?.ok) {
        throw new Error(
          (json && "error" in json && json.error) ||
            "Impossible de charger vos demandes d’absence."
        );
      }

      setItems(Array.isArray(json.items) ? json.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadImpact() {
      if (!form.start_date || !form.end_date) {
        setImpactPreview(null);
        return;
      }

      try {
        setImpactLoading(true);

        const qs = new URLSearchParams({
          start_date: form.start_date,
          end_date: form.end_date,
        });

        const res = await fetch(
          `/api/teacher/absence-requests/impact?${qs.toString()}`,
          { cache: "no-store" }
        );

        const json = (await res.json().catch(() => null)) as ImpactResponse | null;

        if (!res.ok || !json?.ok) {
          if (!cancelled) setImpactPreview(null);
          return;
        }

        if (!cancelled) {
          setImpactPreview(json.impact ?? null);
        }
      } finally {
        if (!cancelled) setImpactLoading(false);
      }
    }

    void loadImpact();

    return () => {
      cancelled = true;
    };
  }, [form.start_date, form.end_date]);

  const counts = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc.total += 1;
        acc[item.status] += 1;
        return acc;
      },
      {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        cancelled: 0,
      }
    );
  }, [items]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!form.start_date || !form.end_date) {
      setError("Veuillez renseigner la date de début et la date de fin.");
      setSuccess(null);
      return;
    }

    if (!form.details.trim()) {
      setError("Veuillez préciser le motif de votre demande.");
      setSuccess(null);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setSuccess(null);

      const selectedReason =
        REASON_OPTIONS.find((option) => option.value === form.reason_code)
          ?.label ?? form.reason_code;

      const res = await fetch("/api/teacher/absence-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          start_date: form.start_date,
          end_date: form.end_date,
          reason_code: form.reason_code,
          reason_label: selectedReason,
          details: form.details.trim(),
          signed: form.signed,
          source: "teacher_portal",
          makeup_plan: {
            proposed_start_date: form.makeup_start_date || null,
            proposed_end_date: form.makeup_end_date || null,
            notes: form.makeup_notes.trim(),
          },
        }),
      });

      const json =
        (await res.json().catch(() => null)) as ApiCreateResponse | null;

      if (!res.ok || !json?.ok) {
        throw new Error(
          (json && "error" in json && json.error) ||
            "La demande n’a pas pu être enregistrée."
        );
      }

      setForm({
        start_date: "",
        end_date: "",
        reason_code: "maladie",
        details: "",
        signed: true,
        makeup_start_date: "",
        makeup_end_date: "",
        makeup_notes: "",
      });
      setImpactPreview(null);

      setSuccess("Votre demande d’autorisation d’absence a bien été soumise.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de l’envoi.");
      setSuccess(null);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-950 via-slate-900 to-emerald-950 p-5 text-white shadow-sm sm:p-6">
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            background:
              "radial-gradient(500px 200px at 10% -10%, rgba(255,255,255,0.45), transparent 60%), radial-gradient(320px 140px at 90% 120%, rgba(255,255,255,0.22), transparent 60%)",
          }}
        />
        <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80 ring-1 ring-white/10">
              <ShieldCheck className="h-3.5 w-3.5" />
              Espace enseignant
            </div>
            <h1 className="mt-3 text-2xl font-extrabold tracking-tight">
              Autorisation d’absence
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/85">
              Soumettez une demande d’absence, visualisez les classes impactées,
              puis indiquez quand vous comptez rattraper les heures perdues.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void load()}
            disabled={refreshing}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <RefreshCw
              className={classNames("h-4 w-4", refreshing && "animate-spin")}
            />
            Actualiser
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Total
          </div>
          <div className="mt-2 text-3xl font-extrabold text-slate-950">
            {counts.total}
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            En attente
          </div>
          <div className="mt-2 text-3xl font-extrabold text-amber-900">
            {counts.pending}
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Approuvées
          </div>
          <div className="mt-2 text-3xl font-extrabold text-emerald-900">
            {counts.approved}
          </div>
        </div>

        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-red-700">
            Rejetées
          </div>
          <div className="mt-2 text-3xl font-extrabold text-red-900">
            {counts.rejected}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <FileText className="h-4 w-4 text-emerald-600" />
            Nouvelle demande
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-800">
                Date de début
              </label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, start_date: e.target.value }))
                }
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-800">
                Date de fin
              </label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, end_date: e.target.value }))
                }
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
              />
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-bold text-slate-900">
              Impact prévisionnel de l’absence
            </div>

            {impactLoading ? (
              <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Calcul des heures perdues...
              </div>
            ) : !form.start_date || !form.end_date ? (
              <p className="mt-2 text-sm text-slate-500">
                Sélectionnez la plage d’absence pour voir les classes impactées.
              </p>
            ) : !impactPreview || impactPreview.impacted_classes.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                Aucun cours impacté trouvé sur cette période.
              </p>
            ) : (
              <>
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Vous perdrez des heures dans les classes suivantes :{" "}
                  <strong>{impactPreview.total_lost_hours} h</strong> sur{" "}
                  <strong>{impactPreview.total_lost_sessions}</strong> créneau(x).
                </div>

                <div className="mt-3 space-y-3">
                  {impactPreview.impacted_classes.map((cls) => (
                    <div
                      key={cls.class_id}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-slate-900">
                          {cls.class_label}
                        </div>
                        <div className="text-sm text-slate-600">
                          {cls.lost_hours} h perdues • {cls.lost_sessions} créneau(x)
                        </div>
                      </div>

                      <div className="mt-2 space-y-2 text-sm text-slate-600">
                        {cls.slots.map((slot, index) => (
                          <div
                            key={`${cls.class_id}_${slot.date}_${slot.period_id}_${index}`}
                            className="rounded-xl bg-slate-50 px-3 py-2"
                          >
                            {formatDate(slot.date)} • {slot.subject_name} •{" "}
                            {slot.period_label} • {slot.lost_hours} h
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="mt-4">
            <label className="mb-2 block text-sm font-semibold text-slate-800">
              Motif
            </label>
            <select
              value={form.reason_code}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, reason_code: e.target.value }))
              }
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
            >
              {REASON_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4">
            <label className="mb-2 block text-sm font-semibold text-slate-800">
              Détails
            </label>
            <textarea
              rows={5}
              value={form.details}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, details: e.target.value }))
              }
              placeholder="Expliquez brièvement le motif de la demande..."
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
            />
          </div>

          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="text-sm font-bold text-emerald-900">
              Quand comptez-vous rattraper ces heures ?
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-800">
                  Début proposé
                </label>
                <input
                  type="date"
                  value={form.makeup_start_date}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      makeup_start_date: e.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-800">
                  Fin proposée
                </label>
                <input
                  type="date"
                  value={form.makeup_end_date}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      makeup_end_date: e.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-semibold text-slate-800">
                Précisions sur le rattrapage
              </label>
              <textarea
                rows={4}
                value={form.makeup_notes}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, makeup_notes: e.target.value }))
                }
                placeholder="Ex. Je propose de rattraper ces heures le mercredi après-midi ou selon le créneau validé par l’administration."
                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
              />
            </div>
          </div>

          <label className="mt-4 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <input
              type="checkbox"
              checked={form.signed}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, signed: e.target.checked }))
              }
              className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span className="text-sm text-slate-700">
              Je confirme l’exactitude des informations fournies dans cette
              demande.
            </span>
          </label>

          <div className="mt-5">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Soumettre la demande
            </button>
          </div>
        </form>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-slate-700">
            <CalendarDays className="h-4 w-4 text-emerald-600" />
            Historique
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              {success}
            </div>
          ) : null}

          <div className="mt-4 space-y-4">
            {loading ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-10">
                <div className="flex items-center justify-center gap-3 text-slate-600">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Chargement des demandes...
                </div>
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-10 text-center">
                <FileText className="mx-auto h-10 w-10 text-slate-300" />
                <div className="mt-3 text-lg font-bold text-slate-900">
                  Aucune demande pour le moment
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  Vos prochaines demandes apparaîtront ici.
                </p>
              </div>
            ) : (
              items.map((item) => (
                <article
                  key={item.id}
                  className="rounded-3xl border border-slate-200 bg-slate-50/60 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={classNames(
                        "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ring-1",
                        statusClasses(item.status)
                      )}
                    >
                      {statusLabel(item.status)}
                    </span>

                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                      <Clock3 className="h-3.5 w-3.5" />
                      {daysLabel(item.requested_days)}
                    </span>

                    {item.signed ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
                        Signée
                      </span>
                    ) : null}

                    {typeof item.lost_hours_total === "number" ? (
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                        {item.lost_hours_total} h à rattraper
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
                    <div className="rounded-2xl bg-white px-4 py-3">
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Période
                      </div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatDate(item.start_date)} → {formatDate(item.end_date)}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white px-4 py-3">
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Motif
                      </div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {item.reason_label}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white px-4 py-3 sm:col-span-2">
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Détails
                      </div>
                      <div className="mt-1 leading-6 text-slate-700">
                        {item.details}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white px-4 py-3">
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Créée le
                      </div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatDateTime(item.created_at)}
                      </div>
                    </div>

                    <div className="rounded-2xl bg-white px-4 py-3">
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Décision
                      </div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {item.status === "approved"
                          ? formatDateTime(item.approved_at)
                          : item.status === "rejected"
                            ? formatDateTime(item.rejected_at)
                            : "—"}
                      </div>
                    </div>
                  </div>

                  {item.impact_summary?.impacted_classes?.length ? (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                      <div className="text-sm font-bold text-amber-900">
                        Classes impactées
                      </div>
                      <div className="mt-2 space-y-3">
                        {item.impact_summary.impacted_classes.map((cls) => (
                          <div
                            key={cls.class_id}
                            className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-700"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="font-semibold text-slate-900">
                                {cls.class_label}
                              </div>
                              <div className="text-slate-600">
                                {cls.lost_hours} h • {cls.lost_sessions} créneau(x)
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {item.makeup_plan ? (
                    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-slate-700">
                      <div className="font-bold text-emerald-900">
                        Proposition de rattrapage
                      </div>
                      <div className="mt-2 grid gap-3 md:grid-cols-2">
                        <div className="rounded-2xl bg-white px-4 py-3">
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                            Période proposée
                          </div>
                          <div className="mt-1 font-semibold text-slate-900">
                            {formatDate(item.makeup_plan.proposed_start_date)} →{" "}
                            {formatDate(item.makeup_plan.proposed_end_date)}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white px-4 py-3">
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                            Notes
                          </div>
                          <div className="mt-1 leading-6 text-slate-700">
                            {item.makeup_plan.notes || "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {item.admin_comment ? (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                      <div className="font-bold text-slate-900">
                        Commentaire administratif
                      </div>
                      <div className="mt-1 leading-6">{item.admin_comment}</div>
                    </div>
                  ) : null}

                  {item.status === "approved" ? (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                      <CheckCircle2 className="h-4 w-4" />
                      Votre demande a été approuvée.
                    </div>
                  ) : null}

                  {item.status === "rejected" ? (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                      <XCircle className="h-4 w-4" />
                      Votre demande a été rejetée.
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}