// src/app/admin/notes/publication-requests/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Send,
  TrendingDown,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";

type PublicationStatus =
  | "draft"
  | "submitted"
  | "changes_requested"
  | "published"
  | string;

type ScoreSource = "student_grades" | "grade_published_scores";

type EvaluationStats = {
  student_count: number;
  graded_count: number;
  missing_count: number;
  average_score: number | null;
  above_average_count: number;
  below_average_count: number;
  highest_score: number | null;
  lowest_score: number | null;
  success_rate: number | null;
  pass_mark: number;
  score_source: ScoreSource;
};

type RequestItem = {
  id: string;
  evaluation_id: string;

  class_id: string;
  class_label: string;
  class_level?: string | null;

  subject_id: string | null;
  subject_name: string;

  subject_component_id?: string | null;
  teacher_id?: string | null;
  teacher_name?: string | null;

  eval_date: string;
  eval_kind: string;
  scale: number;
  coeff: number;

  is_published: boolean;
  published_at?: string | null;

  publication_status: PublicationStatus;
  publication_version: number;

  submitted_at?: string | null;
  submitted_by?: string | null;
  submitted_by_name?: string | null;

  reviewed_at?: string | null;
  reviewed_by?: string | null;
  reviewed_by_name?: string | null;
  review_comment?: string | null;

  scores_count?: number;
  stats?: EvaluationStats;
};

type StudentScore = {
  student_id: string;
  student_name: string;
  matricule?: string | null;
  score: number | null;
  comment?: string | null;
  has_score: boolean;
};

type Detail = {
  students: StudentScore[];
  summary: {
    roster_count: number;
    scores_count: number;
    filled_scores_count: number;
    missing_scores_count: number;
    average_score: number | null;
    above_average_count: number;
    below_average_count: number;
    highest_score: number | null;
    lowest_score: number | null;
    success_rate: number | null;
    pass_mark: number;
    score_source: ScoreSource;
  };
};

type StatusFilter = "submitted" | "changes_requested" | "published" | "all";

function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "emerald" | "slate" | "amber" | "red";
  }
) {
  const { tone = "emerald", className = "", ...rest } = props;

  const tones: Record<string, string> = {
    emerald:
      "bg-emerald-600 text-white hover:bg-emerald-700 focus:ring-emerald-500/30",
    slate: "bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-500/30",
    amber:
      "bg-amber-500 text-slate-950 hover:bg-amber-600 focus:ring-amber-400/30",
    red: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500/30",
  };

  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition",
        "focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50",
        tones[tone],
        className,
      ].join(" ")}
    />
  );
}

function GhostButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    tone?: "emerald" | "slate" | "amber" | "red";
  }
) {
  const { tone = "slate", className = "", ...rest } = props;

  const tones: Record<string, string> = {
    emerald:
      "border-emerald-300 text-emerald-700 hover:bg-emerald-50 focus:ring-emerald-500/20",
    slate:
      "border-slate-300 text-slate-700 hover:bg-slate-50 focus:ring-slate-500/20",
    amber:
      "border-amber-300 text-amber-800 hover:bg-amber-50 focus:ring-amber-500/20",
    red: "border-red-300 text-red-700 hover:bg-red-50 focus:ring-red-500/20",
  };

  return (
    <button
      {...rest}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition",
        "focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-50",
        tones[tone],
        className,
      ].join(" ")}
    />
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition",
        "placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
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
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition",
        "placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
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
        "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none transition",
        "focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/20",
        props.className ?? "",
      ].join(" ")}
    />
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = "slate",
  icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "slate" | "emerald" | "amber" | "red" | "blue";
  icon?: React.ReactNode;
}) {
  const classes = {
    slate: "border-slate-200 bg-slate-50 text-slate-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-950",
    red: "border-red-200 bg-red-50 text-red-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
  };

  const labelClasses = {
    slate: "text-slate-500",
    emerald: "text-emerald-700",
    amber: "text-amber-800",
    red: "text-red-700",
    blue: "text-blue-700",
  };

  return (
    <div className={["rounded-2xl border p-3", classes[tone]].join(" ")}>
      <div className={["flex items-center gap-2 text-xs", labelClasses[tone]].join(" ")}>
        {icon}
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-[11px] opacity-75">{hint}</div> : null}
    </div>
  );
}

function formatDateFr(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("fr-FR");
  } catch {
    return value;
  }
}

function formatDateTimeFr(value?: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return value;
  }
}

function evalKindLabel(kind: string) {
  if (kind === "devoir") return "Devoir";
  if (kind === "interro_ecrite") return "Interrogation écrite";
  if (kind === "interro_orale") return "Interrogation orale";
  return kind || "Évaluation";
}

function statusLabel(status: PublicationStatus) {
  if (status === "draft") return "Brouillon";
  if (status === "submitted") return "En attente de validation";
  if (status === "changes_requested") return "Correction demandée";
  if (status === "published") return "Publié";
  return status || "Brouillon";
}

function statusClasses(status: PublicationStatus) {
  if (status === "published") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "submitted") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (status === "changes_requested") {
    return "border-red-200 bg-red-50 text-red-800";
  }

  return "border-slate-200 bg-slate-50 text-slate-700";
}

function statusIcon(status: PublicationStatus) {
  if (status === "published") return <CheckCircle2 className="h-4 w-4" />;
  if (status === "submitted") return <Clock3 className="h-4 w-4" />;
  if (status === "changes_requested") return <AlertTriangle className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
}

function scoreLabel(score: number | null, scale: number) {
  if (score === null || score === undefined || !Number.isFinite(Number(score))) {
    return "—";
  }

  return `${Number(score).toFixed(2).replace(/\.00$/, "")}/${scale}`;
}

function percentLabel(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "—";
  }

  return `${Number(value).toFixed(1).replace(/\.0$/, "")}%`;
}

function sourceLabel(source?: ScoreSource) {
  if (source === "grade_published_scores") return "Source officielle";
  return "Source de travail";
}

export default function AdminGradePublicationRequestsPage() {
  const [status, setStatus] = useState<StatusFilter>("submitted");
  const [items, setItems] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [selected, setSelected] = useState<RequestItem | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [query, setQuery] = useState("");
  const [comment, setComment] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();

    if (!q) return items;

    return items.filter((item) => {
      const haystack = [
        item.class_label,
        item.class_level,
        item.subject_name,
        item.teacher_name,
        item.submitted_by_name,
        item.eval_kind,
        item.publication_status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [items, query]);

  const submittedCount = useMemo(
    () => items.filter((x) => x.publication_status === "submitted").length,
    [items]
  );

  const selectedCanApprove =
    !!selected &&
    selected.publication_status !== "published" &&
    selected.is_published !== true;

  const selectedCanRequestChanges =
    !!selected &&
    selected.publication_status !== "published" &&
    selected.is_published !== true;

  async function loadRequests(nextStatus: StatusFilter = status) {
    setLoading(true);
    setErr(null);
    setMsg(null);

    try {
      const params = new URLSearchParams();
      params.set("status", nextStatus);
      params.set("limit", "200");

      const res = await fetch(
        `/api/admin/grades/publication-requests?${params.toString()}`,
        { cache: "no-store" }
      );

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Impossible de charger les demandes.");
      }

      const arr = (json.items || []) as RequestItem[];
      setItems(arr);

      if (selected && !arr.some((item) => item.evaluation_id === selected.evaluation_id)) {
        setSelected(null);
        setDetail(null);
        setComment("");
      }
    } catch (e: any) {
      setItems([]);
      setErr(e?.message || "Erreur de chargement des demandes.");
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(item: RequestItem) {
    setSelected(item);
    setDetail(null);
    setComment(item.review_comment || "");
    setDetailLoading(true);
    setErr(null);
    setMsg(null);

    try {
      const params = new URLSearchParams();
      params.set("evaluation_id", item.evaluation_id);
      params.set("include_scores", "1");

      const res = await fetch(
        `/api/admin/grades/publication-requests?${params.toString()}`,
        { cache: "no-store" }
      );

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Impossible de charger le détail.");
      }

      setSelected((json.item as RequestItem) || item);
      setDetail((json.detail as Detail) || null);
    } catch (e: any) {
      setErr(e?.message || "Erreur de chargement du détail.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function submitAction(action: "approve" | "request_changes") {
    if (!selected) return;

    const cleanComment = comment.trim();

    if (action === "request_changes" && !cleanComment) {
      setErr("Un commentaire est obligatoire pour demander une correction.");
      return;
    }

    setActionBusy(true);
    setErr(null);
    setMsg(null);

    try {
      const res = await fetch("/api/admin/grades/publication-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evaluation_id: selected.evaluation_id,
          action,
          comment: cleanComment || null,
          queue_push: true,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json?.ok) {
        throw new Error(json?.message || json?.error || "Action impossible.");
      }

      const updated = json.item as RequestItem | null;

      if (updated) {
        setSelected(updated);
      }

      if (action === "approve") {
        setMsg("Demande validée : les notes sont maintenant publiées officiellement.");
        setComment("");
      } else {
        setMsg("Correction demandée : l’enseignant pourra revoir les notes.");
      }

      await loadRequests(status);

      if (updated) {
        await openDetail(updated);
      }
    } catch (e: any) {
      setErr(e?.message || "Erreur pendant l’action.");
    } finally {
      setActionBusy(false);
    }
  }

  useEffect(() => {
    void loadRequests(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-950 via-indigo-950 to-slate-950 px-5 py-5 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-200/80">
              Administration des notes
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
              Demandes de publication
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-indigo-100/85">
              Validez les notes avant leur envoi aux parents, ou demandez une correction à l’enseignant.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-300/10 px-3 py-1.5 text-sm text-amber-100">
              <Clock3 className="h-4 w-4" />
              {submittedCount} en attente
            </span>
            <Button
              tone="amber"
              onClick={() => loadRequests(status)}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Actualiser
            </Button>
          </div>
        </div>
      </header>

      <section className="rounded-2xl border border-emerald-100 bg-gradient-to-b from-emerald-50/70 to-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-500">
              Statut
            </div>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              <option value="submitted">En attente</option>
              <option value="changes_requested">Corrections demandées</option>
              <option value="published">Publiées</option>
              <option value="all">Toutes</option>
            </Select>
          </div>

          <div>
            <div className="mb-1 text-xs font-medium text-slate-500">
              Recherche
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Classe, matière, enseignant..."
                className="pl-9"
              />
            </div>
          </div>
        </div>

        {msg && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {msg}
          </div>
        )}

        {err && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {err}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Liste des demandes
              </h2>
              <p className="text-xs text-slate-500">
                {filteredItems.length} résultat{filteredItems.length > 1 ? "s" : ""}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-12 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
              <FileText className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-2 text-sm font-medium text-slate-700">
                Aucune demande trouvée.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Les demandes soumises par les enseignants apparaîtront ici.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredItems.map((item) => {
                const active = selected?.evaluation_id === item.evaluation_id;
                const average = item.stats?.average_score ?? null;
                const successRate = item.stats?.success_rate ?? null;

                return (
                  <button
                    key={item.evaluation_id}
                    type="button"
                    onClick={() => openDetail(item)}
                    className={[
                      "w-full rounded-2xl border p-4 text-left transition",
                      active
                        ? "border-emerald-300 bg-emerald-50/70 shadow-sm"
                        : "border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          {item.class_label} — {item.subject_name}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {evalKindLabel(item.eval_kind)} du {formatDateFr(item.eval_date)}
                        </div>
                      </div>

                      <span
                        className={[
                          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium",
                          statusClasses(item.publication_status),
                        ].join(" ")}
                      >
                        {statusIcon(item.publication_status)}
                        {statusLabel(item.publication_status)}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <div className="rounded-xl bg-slate-50 px-2 py-1.5">
                        Enseignant :{" "}
                        <span className="font-medium text-slate-800">
                          {item.teacher_name || "—"}
                        </span>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-2 py-1.5">
                        Notes :{" "}
                        <span className="font-medium text-slate-800">
                          {item.scores_count ?? 0}
                        </span>
                      </div>
                      <div className="rounded-xl bg-emerald-50 px-2 py-1.5 text-emerald-800">
                        Moyenne :{" "}
                        <span className="font-semibold">
                          {scoreLabel(average, item.scale)}
                        </span>
                      </div>
                      <div className="rounded-xl bg-blue-50 px-2 py-1.5 text-blue-800">
                        Réussite :{" "}
                        <span className="font-semibold">
                          {percentLabel(successRate)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 text-xs text-slate-500">
                      Soumis le {formatDateTimeFr(item.submitted_at)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          {!selected ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 text-center">
              <Eye className="h-9 w-9 text-slate-400" />
              <h2 className="mt-3 text-base font-semibold text-slate-800">
                Sélectionnez une demande
              </h2>
              <p className="mt-1 max-w-md text-sm text-slate-500">
                Cliquez sur une demande à gauche pour consulter les notes avant validation.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-slate-900">
                      {selected.class_label} — {selected.subject_name}
                    </h2>
                    <span
                      className={[
                        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium",
                        statusClasses(selected.publication_status),
                      ].join(" ")}
                    >
                      {statusIcon(selected.publication_status)}
                      {statusLabel(selected.publication_status)}
                    </span>
                  </div>

                  <p className="mt-1 text-sm text-slate-500">
                    {evalKindLabel(selected.eval_kind)} du {formatDateFr(selected.eval_date)} •
                    Barème /{selected.scale} • Coeff {selected.coeff}
                  </p>

                  <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      Enseignant :{" "}
                      <span className="font-medium text-slate-800">
                        {selected.teacher_name || "—"}
                      </span>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      Soumis par :{" "}
                      <span className="font-medium text-slate-800">
                        {selected.submitted_by_name || "—"}
                      </span>
                    </div>
                  </div>
                </div>

                <GhostButton
                  onClick={() => openDetail(selected)}
                  disabled={detailLoading}
                  tone="emerald"
                >
                  {detailLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Recharger
                </GhostButton>
              </div>

              {detailLoading ? (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-14 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Chargement des notes...
                </div>
              ) : detail ? (
                <>
                  <div className="grid gap-3 md:grid-cols-4">
                    <StatCard
                      label="Élèves"
                      value={detail.summary.roster_count}
                      tone="slate"
                      icon={<Users className="h-4 w-4" />}
                    />

                    <StatCard
                      label="Notes saisies"
                      value={detail.summary.filled_scores_count}
                      tone="emerald"
                    />

                    <StatCard
                      label="Sans note"
                      value={detail.summary.missing_scores_count}
                      tone="amber"
                    />

                    <StatCard
                      label="Version"
                      value={selected.publication_version || 0}
                      tone="slate"
                    />
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">
                          Synthèse pédagogique de l’évaluation
                        </h3>
                        <p className="text-xs text-slate-500">
                          Seules les notes réellement saisies sont prises en compte.
                        </p>
                      </div>
                      <span className="inline-flex w-fit rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                        {sourceLabel(detail.summary.score_source)}
                      </span>
                    </div>

                    <div className="grid gap-3 md:grid-cols-5">
                      <StatCard
                        label="Moyenne évaluat."
                        value={scoreLabel(detail.summary.average_score, selected.scale)}
                        tone="blue"
                      />

                      <StatCard
                        label="≥ moyenne"
                        value={detail.summary.above_average_count}
                        tone="emerald"
                        hint={`Seuil : ${scoreLabel(detail.summary.pass_mark, selected.scale)}`}
                        icon={<TrendingUp className="h-4 w-4" />}
                      />

                      <StatCard
                        label="< moyenne"
                        value={detail.summary.below_average_count}
                        tone="red"
                        hint={percentLabel(detail.summary.success_rate)}
                        icon={<TrendingDown className="h-4 w-4" />}
                      />

                      <StatCard
                        label="Note max"
                        value={scoreLabel(detail.summary.highest_score, selected.scale)}
                        tone="emerald"
                      />

                      <StatCard
                        label="Note min"
                        value={scoreLabel(detail.summary.lowest_score, selected.scale)}
                        tone="amber"
                      />
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-2xl border">
                    <div className="max-h-[420px] overflow-auto">
                      <table className="min-w-full text-sm">
                        <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-3 py-2">N°</th>
                            <th className="px-3 py-2">Matricule</th>
                            <th className="px-3 py-2">Élève</th>
                            <th className="px-3 py-2 text-right">Note</th>
                            <th className="px-3 py-2">Observation</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {detail.students.map((student, index) => (
                            <tr key={student.student_id} className="hover:bg-slate-50">
                              <td className="px-3 py-2 text-slate-500">
                                {index + 1}
                              </td>
                              <td className="px-3 py-2 text-slate-600">
                                {student.matricule || "—"}
                              </td>
                              <td className="px-3 py-2 font-medium text-slate-800">
                                {student.student_name}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <span
                                  className={[
                                    "inline-flex rounded-full px-2 py-1 text-xs font-semibold",
                                    student.score === null
                                      ? "bg-amber-50 text-amber-800"
                                      : Number(student.score) >= detail.summary.pass_mark
                                        ? "bg-emerald-50 text-emerald-800"
                                        : "bg-red-50 text-red-800",
                                  ].join(" ")}
                                >
                                  {scoreLabel(student.score, selected.scale)}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-slate-500">
                                {student.comment || (student.has_score ? "" : "Non saisie")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <Send className="h-4 w-4" />
                      Décision administrative
                    </div>

                    <Textarea
                      rows={3}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Commentaire facultatif pour valider, obligatoire pour demander correction..."
                    />

                    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                      <GhostButton
                        tone="red"
                        onClick={() => submitAction("request_changes")}
                        disabled={!selectedCanRequestChanges || actionBusy}
                      >
                        {actionBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <XCircle className="h-4 w-4" />
                        )}
                        Demander correction
                      </GhostButton>

                      <Button
                        tone="emerald"
                        onClick={() => submitAction("approve")}
                        disabled={!selectedCanApprove || actionBusy}
                      >
                        {actionBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        Valider et publier
                      </Button>
                    </div>

                    {selected.publication_status === "published" && (
                      <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                        Cette évaluation est déjà publiée officiellement.
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                  Aucun détail disponible.
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}