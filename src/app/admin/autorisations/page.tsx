"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
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

type AbsenceRequestItem = {
  id: string;
  institution_id: string;
  teacher_user_id: string;
  teacher_profile_id: string;
  teacher_name: string | null;
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
  updated_at: string | null;
  lost_hours_total?: number;
  lost_sessions_total?: number;
  impact_summary?: AbsenceImpactSummary | null;
  makeup_plan?: MakeupPlan | null;
};

type ApiListResponse =
  | { ok: true; items: AbsenceRequestItem[] }
  | { ok: false; error: string };

type ApiActionResponse =
  | { ok: true; item: AbsenceRequestItem; message?: string }
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

function formatTimeRange(
  start?: string | null,
  end?: string | null,
  fallback?: string | null
) {
  const s = String(start || "").trim();
  const e = String(end || "").trim();

  if (s && e) return `${s}-${e}`;
  if (s) return s;
  if (e) return e;
  return fallback || "Créneau non défini";
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

export default function AdminAssiduitePage() {
  const [items, setItems] = useState<AbsenceRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<RequestStatus | "all">("pending");
  const [teacherQuery, setTeacherQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      setRefreshing(true);

      const qs = new URLSearchParams();
      if (statusFilter !== "all") qs.set("status", statusFilter);

      const res = await fetch(`/api/admin/absence-requests?${qs.toString()}`, {
        cache: "no-store",
      });

      const json = (await res.json().catch(() => null)) as ApiListResponse | null;

      if (!res.ok || !json?.ok) {
        throw new Error(
          (json && "error" in json && json.error) ||
            "Impossible de charger les demandes d’absence."
        );
      }

      setItems(json.items ?? []);
    } catch (e: any) {
      setError(e?.message || "Erreur de chargement.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, [statusFilter]);

  const filteredItems = useMemo(() => {
    const q = teacherQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) =>
      String(item.teacher_name ?? "").toLowerCase().includes(q)
    );
  }, [items, teacherQuery]);

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

  async function handleAction(id: string, action: "approve" | "reject") {
    try {
      setBusyId(id);
      setError(null);

      const admin_comment = (commentDraft[id] || "").trim();

      const res = await fetch("/api/admin/absence-requests", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id,
          action,
          admin_comment,
        }),
      });

      const json = (await res.json().catch(() => null)) as ApiActionResponse | null;

      if (!res.ok || !json?.ok) {
        throw new Error(
          (json && "error" in json && json.error) ||
            "L’action n’a pas pu être exécutée."
        );
      }

      setItems((prev) =>
        prev.map((item) => (item.id === id ? json.item : item))
      );
      setSelectedId(id);
    } catch (e: any) {
      setError(e?.message || "Erreur lors de la validation.");
    } finally {
      setBusyId(null);
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
              Assiduité & justifications
            </div>
            <h1 className="mt-3 text-2xl font-extrabold tracking-tight">
              Validation des autorisations d’absence
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-white/85">
              Consultez les demandes soumises par les enseignants, voyez les classes
              touchées, le nombre d’heures perdues et leur proposition de rattrapage.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void load()}
            disabled={refreshing}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <RefreshCw className={classNames("h-4 w-4", refreshing && "animate-spin")} />
            Actualiser
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total</div>
          <div className="mt-2 text-3xl font-extrabold text-slate-950">{counts.total}</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">En attente</div>
          <div className="mt-2 text-3xl font-extrabold text-amber-900">{counts.pending}</div>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Approuvées</div>
          <div className="mt-2 text-3xl font-extrabold text-emerald-900">{counts.approved}</div>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-red-700">Rejetées</div>
          <div className="mt-2 text-3xl font-extrabold text-red-900">{counts.rejected}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">Annulées</div>
          <div className="mt-2 text-3xl font-extrabold text-slate-800">{counts.cancelled}</div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-800">
              Statut
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as RequestStatus | "all")}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
            >
              <option value="all">Tous</option>
              <option value="pending">En attente</option>
              <option value="approved">Approuvées</option>
              <option value="rejected">Rejetées</option>
              <option value="cancelled">Annulées</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-800">
              Recherche enseignant
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={teacherQuery}
                onChange={(e) => setTeacherQuery(e.target.value)}
                placeholder="Nom de l’enseignant..."
                className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
              />
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-sm">
          {error}
        </section>
      ) : null}

      <section className="space-y-4">
        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-5 py-12 shadow-sm">
            <div className="flex items-center justify-center gap-3 text-slate-600">
              <Loader2 className="h-5 w-5 animate-spin" />
              Chargement des demandes...
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-5 py-12 shadow-sm">
            <div className="flex flex-col items-center justify-center text-center">
              <FileText className="h-10 w-10 text-slate-300" />
              <div className="mt-3 text-lg font-bold text-slate-900">
                Aucune demande trouvée
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Ajuste les filtres ou attends la soumission d’une nouvelle demande.
              </p>
            </div>
          </div>
        ) : (
          filteredItems.map((item) => {
            const isOpen = selectedId === item.id;
            const canAct = item.status === "pending";
            const currentBusy = busyId === item.id;

            return (
              <article
                key={item.id}
                className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
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
                          {item.lost_hours_total} h perdues
                        </span>
                      ) : null}
                    </div>

                    <div>
                      <h2 className="text-xl font-extrabold tracking-tight text-slate-950">
                        {item.teacher_name || "Enseignant non identifié"}
                      </h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Demande créée le {formatDateTime(item.created_at)}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 gap-3 text-sm text-slate-700 md:grid-cols-3">
                      <div className="rounded-2xl bg-slate-50 px-4 py-3">
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Période
                        </div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {formatDate(item.start_date)} → {formatDate(item.end_date)}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-slate-50 px-4 py-3">
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Motif
                        </div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {item.reason_label}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-slate-50 px-4 py-3">
                        <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Source
                        </div>
                        <div className="mt-1 font-semibold text-slate-900">
                          {item.source || "teacher_portal"}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 lg:min-w-[220px]">
                    <button
                      type="button"
                      onClick={() => setSelectedId(isOpen ? null : item.id)}
                      className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      {isOpen ? "Masquer les détails" : "Voir les détails"}
                    </button>

                    {canAct ? (
                      <>
                        <button
                          type="button"
                          disabled={currentBusy}
                          onClick={() => void handleAction(item.id, "approve")}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {currentBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          Approuver
                        </button>

                        <button
                          type="button"
                          disabled={currentBusy}
                          onClick={() => void handleAction(item.id, "reject")}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-700 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {currentBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <XCircle className="h-4 w-4" />
                          )}
                          Rejeter
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                {isOpen ? (
                  <div className="grid gap-4 px-5 py-5 lg:grid-cols-[1.2fr_0.8fr]">
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="text-sm font-bold text-slate-900">
                          Motif détaillé
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                          {item.details}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                        <div className="text-sm font-bold text-amber-900">
                          Classes et heures qui seront perdues
                        </div>

                        {!item.impact_summary?.impacted_classes?.length ? (
                          <p className="mt-2 text-sm text-amber-900/80">
                            Aucun impact détaillé enregistré pour cette demande.
                          </p>
                        ) : (
                          <>
                            <div className="mt-3 rounded-xl bg-white/70 px-4 py-3 text-sm text-slate-800">
                              Total estimé :{" "}
                              <strong>{item.impact_summary.total_lost_hours} h</strong>{" "}
                              sur{" "}
                              <strong>{item.impact_summary.total_lost_sessions}</strong>{" "}
                              créneau(x).
                            </div>

                            <div className="mt-3 space-y-3">
                              {item.impact_summary.impacted_classes.map((cls) => (
                                <div
                                  key={cls.class_id}
                                  className="rounded-xl bg-white px-4 py-3"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="font-semibold text-slate-900">
                                      {cls.class_label}
                                    </div>
                                    <div className="text-sm text-slate-600">
                                      {cls.lost_hours} h • {cls.lost_sessions} créneau(x)
                                    </div>
                                  </div>

                                  <div className="mt-2 space-y-2 text-sm text-slate-600">
                                    {cls.slots.map((slot, index) => (
                                      <div
                                        key={`${cls.class_id}_${slot.date}_${slot.period_id}_${index}`}
                                        className="rounded-lg bg-slate-50 px-3 py-2"
                                      >
                                        {formatDate(slot.date)} • {slot.subject_name} •{" "}
                                        {formatTimeRange(
                                          slot.start_time,
                                          slot.end_time,
                                          slot.period_label
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>

                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                        <div className="text-sm font-bold text-emerald-900">
                          Proposition de rattrapage de l’enseignant
                        </div>

                        {!item.makeup_plan ? (
                          <p className="mt-2 text-sm text-emerald-900/80">
                            Aucun rattrapage proposé pour le moment.
                          </p>
                        ) : (
                          <div className="mt-3 space-y-3 text-sm">
                            <div className="rounded-xl bg-white px-4 py-3">
                              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                                Détails
                              </div>
                              <div className="mt-1 whitespace-pre-wrap text-slate-700">
                                {item.makeup_plan.notes || "—"}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                          <MessageSquareText className="h-4 w-4 text-emerald-600" />
                          Commentaire administratif
                        </div>
                        <textarea
                          rows={5}
                          value={commentDraft[item.id] ?? item.admin_comment ?? ""}
                          onChange={(e) =>
                            setCommentDraft((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                          placeholder="Ajoutez un commentaire administratif..."
                          className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/15"
                        />
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="text-sm font-bold text-slate-900">Suivi décisionnel</div>
                        <div className="mt-3 space-y-3 text-sm">
                          <div className="rounded-2xl bg-slate-50 px-4 py-3">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                              Statut actuel
                            </div>
                            <div className="mt-1 font-semibold text-slate-900">
                              {statusLabel(item.status)}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                              Approuvée le
                            </div>
                            <div className="mt-1 font-semibold text-slate-900">
                              {formatDateTime(item.approved_at)}
                            </div>
                          </div>

                          <div className="rounded-2xl bg-slate-50 px-4 py-3">
                            <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                              Rejetée le
                            </div>
                            <div className="mt-1 font-semibold text-slate-900">
                              {formatDateTime(item.rejected_at)}
                            </div>
                          </div>
                        </div>
                      </div>

                      {item.status === "approved" ? (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                          Cette demande a été validée.
                        </div>
                      ) : null}

                      {item.status === "rejected" ? (
                        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                          Cette demande a été rejetée.
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}