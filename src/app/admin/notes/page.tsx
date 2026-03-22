// src/app/admin/notes/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  NotebookPen,
  TrendingUp,
  AlertTriangle,
  GraduationCap,
  School,
  BarChart3,
  User2,
  RefreshCw,
  CalendarClock,
  ChevronRight,
  Send,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import Link from "next/link";

/* Types API */
type EvalKind = "devoir" | "interro_ecrite" | "interro_orale";

type LevelRow = {
  level: string;
  evals: number;
  avg_20: number | null;
};

type ClassRow = {
  class_id: string;
  class_label: string;
  level?: string | null;
  evals: number;
  avg_20: number | null;
};

type LatestEvalRow = {
  id: string;
  eval_date: string;
  eval_kind: EvalKind;
  scale: number;
  coeff: number;
  is_published: boolean;
  class_label: string;
  level: string | null;
  subject_name: string | null;
  teacher_name: string | null;
};

type NotesOverviewOk = {
  ok: true;
  meta: { days: number };
  counts: {
    evaluations_total: number;
    evaluations_published: number;
    evaluations_unpublished: number;
    scores_count: number;
    avg_score_20: number | null;
  };
  breakdown: {
    by_level: LevelRow[];
    by_class: ClassRow[];
    worst_classes: ClassRow[];
  };
  latest: LatestEvalRow[];
};

type NotesOverviewErr = { ok: false; error: string };

type GradeDigestSendResult =
  | {
      ok: true;
      run_id?: string | null;
      period_start?: string;
      period_end?: string;
      students_count?: number;
      notifications_created?: number;
      evaluations_count?: number;
      reason?: string;
    }
  | {
      ok: false;
      error: string;
      policy?: {
        smsPremiumEnabled?: boolean;
        smsProvider?: string | null;
        smsNotesDigestEnabled?: boolean;
      };
    };

type DaysRange = 7 | 30 | 90;

/* Mini UI helpers */
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/70 ${className}`} />;
}

function CardShell({
  title,
  icon,
  children,
  subtitle,
}: {
  title: string;
  icon?: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            {icon}
            <span>{title}</span>
          </div>
          {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

function KpiTile({
  label,
  icon: Icon,
  value,
  suffix,
  tone = "emerald",
  loading,
}: {
  label: string;
  icon: any;
  value: string | number | null;
  suffix?: string;
  tone?: "emerald" | "sky" | "violet" | "amber";
  loading?: boolean;
}) {
  const colorMap: Record<typeof tone, string> = {
    emerald: "border-emerald-200/80 bg-emerald-50/60",
    sky: "border-sky-200/80 bg-sky-50/60",
    violet: "border-violet-200/80 bg-violet-50/60",
    amber: "border-amber-200/80 bg-amber-50/60",
  };

  return (
    <div
      className={[
        "flex h-full flex-col justify-between rounded-2xl border p-4 shadow-sm",
        colorMap[tone],
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-600/90">
            {label}
          </div>
          <div className="flex items-baseline gap-1">
            {loading ? (
              <Skeleton className="h-7 w-20" />
            ) : (
              <span className="text-2xl font-semibold text-slate-900">
                {value === null ? "—" : value}
              </span>
            )}
            {suffix && !loading && <span className="text-xs text-slate-600">{suffix}</span>}
          </div>
        </div>
        <div className="rounded-xl bg-white/80 p-2 ring-1 ring-slate-200">
          <Icon className="h-5 w-5 text-slate-700" />
        </div>
      </div>
    </div>
  );
}

function Segmented({ value, onChange }: { value: DaysRange; onChange: (v: DaysRange) => void }) {
  const options: DaysRange[] = [7, 30, 90];

  return (
    <div className="inline-flex rounded-full border border-emerald-200 bg-white p-1 text-xs shadow-sm">
      {options.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          className={[
            "rounded-full px-3 py-1.5 font-medium transition",
            value === d
              ? "bg-emerald-600 text-white shadow"
              : "text-emerald-700 hover:bg-emerald-50",
          ].join(" ")}
          aria-pressed={value === d}
        >
          {d} j
        </button>
      ))}
    </div>
  );
}

function QuickLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: any;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="group">
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50/80 sm:text-sm">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-white p-1.5 text-emerald-700 ring-1 ring-emerald-100">
            <Icon className="h-4 w-4" />
          </div>
          <span className="font-medium text-slate-800 group-hover:text-slate-900">
            {children}
          </span>
        </div>
        <ChevronRight className="h-4 w-4 text-emerald-500 transition group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

/* Page principale */
export default function AdminNotesOverviewPage() {
  const [data, setData] = useState<NotesOverviewOk | NotesOverviewErr | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState<DaysRange>(30);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const [sendingGradeDigest, setSendingGradeDigest] = useState(false);
  const [gradeDigestResult, setGradeDigestResult] = useState<GradeDigestSendResult | null>(null);

  async function load(d: DaysRange = days) {
    try {
      setRefreshing(true);

      const res = await fetch(`/api/admin/notes/overview?days=${d}`, {
        cache: "no-store",
      });

      const json = (await res.json().catch(() => ({}))) as NotesOverviewOk | NotesOverviewErr | any;

      if (!res.ok || !json || !json.ok) {
        throw new Error((json && json.error) || `HTTP_${res.status}`);
      }

      setData(json);
      setUpdatedAt(new Date());
    } catch (e: any) {
      console.error("[admin.notes] load error", e);
      setData({ ok: false, error: e?.message ?? "ERROR" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function sendGradeDigest() {
    try {
      setSendingGradeDigest(true);
      setGradeDigestResult(null);

      const res = await fetch("/api/admin/notifications/grades-digest/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({}),
      });

      const json = (await res.json().catch(() => ({}))) as GradeDigestSendResult;

      if (!res.ok) {
        setGradeDigestResult({
          ok: false,
          error: (json as any)?.error || `HTTP_${res.status}`,
          policy: (json as any)?.policy,
        });
        return;
      }

      setGradeDigestResult(json);
    } catch (e: any) {
      console.error("[admin.notes] sendGradeDigest error", e);
      setGradeDigestResult({
        ok: false,
        error: e?.message || "NETWORK_ERROR",
      });
    } finally {
      setSendingGradeDigest(false);
    }
  }

  useEffect(() => {
    load(days);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isOk = !!data && "ok" in data && data.ok;

  const counts = isOk
    ? (data as NotesOverviewOk).counts
    : {
        evaluations_total: 0,
        evaluations_published: 0,
        evaluations_unpublished: 0,
        scores_count: 0,
        avg_score_20: null,
      };

  const breakdown = isOk
    ? (data as NotesOverviewOk).breakdown
    : {
        by_level: [] as LevelRow[],
        by_class: [] as ClassRow[],
        worst_classes: [] as ClassRow[],
      };

  const latest = isOk ? (data as NotesOverviewOk).latest : ([] as LatestEvalRow[]);

  const periodLabel = useMemo(() => {
    const d = isOk ? (data as NotesOverviewOk).meta.days : days;
    return `${d} derniers jours`;
  }, [data, days, isOk]);

  const publishedRate =
    counts.evaluations_total > 0
      ? ((counts.evaluations_published * 100) / counts.evaluations_total).toFixed(1)
      : "0,0";

  const df = useMemo(
    () =>
      new Intl.DateTimeFormat("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
    []
  );

  function formatDate(value: string) {
    try {
      return df.format(new Date(value));
    } catch {
      return value;
    }
  }

  function evalKindLabel(kind: EvalKind) {
    if (kind === "devoir") return "Devoir";
    if (kind === "interro_orale") return "Interrogation orale";
    return "Interrogation écrite";
  }

  const hasError = !!data && "ok" in data && !data.ok;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-violet-700 via-emerald-600 to-lime-500 p-6 text-white shadow-sm">
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{
            background:
              "radial-gradient(500px 200px at 10% -10%, rgba(255,255,255,0.6), transparent 60%), radial-gradient(300px 120px at 90% 120%, rgba(255,255,255,0.5), transparent 60%)",
          }}
        />

        <div className="relative z-10 flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold ring-1 ring-white/25">
              <NotebookPen className="h-4 w-4" />
              Cahier de notes · Vue d&apos;ensemble
            </div>

            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              Suivi global des notes de l&apos;établissement
            </h1>

            <p className="text-xs text-white/90 sm:text-sm">
              Volume de contrôles, publication et saisie des notes sur{" "}
              <span className="font-semibold">{periodLabel}</span>.
            </p>
          </div>

          <div className="w-full max-w-xl xl:w-auto xl:min-w-[430px]">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <Segmented
                value={days}
                onChange={(d) => {
                  setDays(d);
                  load(d);
                }}
              />

              <button
                type="button"
                onClick={() => load(days)}
                disabled={refreshing}
                className={[
                  "inline-flex items-center justify-center gap-2 rounded-full border border-white/40 bg-white/10 px-3 py-1.5 text-xs font-medium",
                  refreshing ? "opacity-70" : "hover:bg-white/20",
                ].join(" ")}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                Actualiser
              </button>

              <button
                type="button"
                onClick={sendGradeDigest}
                disabled={sendingGradeDigest}
                className={[
                  "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition",
                  sendingGradeDigest
                    ? "bg-white/70 text-emerald-700"
                    : "bg-white text-emerald-700 hover:bg-emerald-50",
                ].join(" ")}
              >
                <Send className={`h-4 w-4 ${sendingGradeDigest ? "animate-pulse" : ""}`} />
                {sendingGradeDigest ? "Envoi en cours..." : "Envoyer les notes"}
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2 text-[11px] text-white/80">
              <CalendarClock className="h-3.5 w-3.5" />
              {updatedAt
                ? `Mis à jour à ${updatedAt.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : "En attente de données..."}
            </div>
          </div>
        </div>

        {hasError && (
          <div className="relative z-10 mt-4 rounded-xl border border-red-300/70 bg-red-50/90 px-4 py-2 text-xs text-red-800">
            {(data as NotesOverviewErr).error === "UNAUTHENTICATED"
              ? "Session expirée. Merci de vous reconnecter."
              : (data as NotesOverviewErr).error === "FORBIDDEN"
              ? "Accès non autorisé à cette vue."
              : "Erreur lors du chargement des indicateurs du cahier de notes."}
          </div>
        )}

        {gradeDigestResult?.ok && (
          <div className="relative z-10 mt-4 rounded-2xl border border-emerald-300/60 bg-emerald-50/95 px-4 py-3 text-sm text-emerald-900 shadow-sm">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">Résumé SMS lancé avec succès.</div>
                <div className="mt-1 text-xs text-emerald-800">
                  {gradeDigestResult.notifications_created ?? 0} notification(s) créée(s)
                  {" · "}
                  {gradeDigestResult.students_count ?? 0} élève(s) concerné(s)
                  {typeof gradeDigestResult.evaluations_count === "number" && (
                    <>
                      {" · "}
                      {gradeDigestResult.evaluations_count} évaluation(s)
                    </>
                  )}
                </div>
                {gradeDigestResult.reason && (
                  <div className="mt-1 text-xs text-emerald-800">
                    Motif : {gradeDigestResult.reason}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {gradeDigestResult && !gradeDigestResult.ok && (
          <div className="relative z-10 mt-4 rounded-2xl border border-red-300/70 bg-red-50/95 px-4 py-3 text-sm text-red-900 shadow-sm">
            <div className="flex items-start gap-2">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">Impossible d’envoyer le résumé SMS.</div>
                <div className="mt-1 text-xs text-red-800">
                  {gradeDigestResult.error === "SMS_NOTES_DIGEST_DISABLED"
                    ? "Le SMS premium pour le digest des notes n’est pas activé pour cet établissement."
                    : gradeDigestResult.error === "DIGEST_ALREADY_SENT_FOR_PERIOD"
                    ? "Un digest a déjà été envoyé pour cette période."
                    : gradeDigestResult.error === "FORBIDDEN"
                    ? "Accès non autorisé."
                    : gradeDigestResult.error === "NETWORK_ERROR"
                    ? "Erreur réseau."
                    : gradeDigestResult.error}
                </div>

                {gradeDigestResult.policy && (
                  <div className="mt-2 text-[11px] text-red-800">
                    premium={String(!!gradeDigestResult.policy.smsPremiumEnabled)}
                    {" · "}
                    provider={gradeDigestResult.policy.smsProvider || "—"}
                    {" · "}
                    notes_digest={String(!!gradeDigestResult.policy.smsNotesDigestEnabled)}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Évaluations créées"
          icon={NotebookPen}
          value={counts.evaluations_total.toLocaleString("fr-FR")}
          suffix="contrôles"
          tone="emerald"
          loading={loading}
        />
        <KpiTile
          label="Taux de publication"
          icon={TrendingUp}
          value={`${publishedRate}`.replace(".", ",")}
          suffix="% publiées"
          tone="sky"
          loading={loading}
        />
        <KpiTile
          label="Évaluations en brouillon"
          icon={AlertTriangle}
          value={counts.evaluations_unpublished.toLocaleString("fr-FR")}
          suffix="à publier"
          tone="amber"
          loading={loading}
        />
        <KpiTile
          label="Notes saisies"
          icon={GraduationCap}
          value={counts.scores_count.toLocaleString("fr-FR")}
          suffix="notes"
          tone="violet"
          loading={loading}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CardShell
          title="Par niveau"
          icon={<School className="h-4 w-4 text-slate-500" />}
          subtitle="Volume d’évaluations et moyenne par niveau de classe"
        >
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-full" />
              ))}
            </div>
          ) : breakdown.by_level.length === 0 ? (
            <div className="text-xs text-slate-500">
              Aucun contrôle enregistré sur la période choisie.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs sm:text-sm">
                <thead className="border-b bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Niveau</th>
                    <th className="px-2 py-1.5 text-right">Évaluations</th>
                    <th className="px-2 py-1.5 text-right">Moyenne /20</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.by_level.map((row) => (
                    <tr key={row.level} className="border-b last:border-0">
                      <td className="px-2 py-1.5 font-medium text-slate-800">{row.level}</td>
                      <td className="px-2 py-1.5 text-right text-slate-700">
                        {row.evals.toLocaleString("fr-FR")}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {row.avg_20 == null
                          ? "—"
                          : row.avg_20.toLocaleString("fr-FR", {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 2,
                            })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardShell>

        <div className="lg:col-span-2">
          <CardShell
            title="Classes en difficulté"
            icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
            subtitle="Classes dont la moyenne globale est la plus faible sur la période"
          >
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-7 w-full" />
                ))}
              </div>
            ) : breakdown.worst_classes.length === 0 ? (
              <div className="text-xs text-slate-500">
                Aucune moyenne calculable pour cette période.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs sm:text-sm">
                  <thead className="border-b bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Classe</th>
                      <th className="px-2 py-1.5 text-left">Niveau</th>
                      <th className="px-2 py-1.5 text-right">Évaluations</th>
                      <th className="px-2 py-1.5 text-right">Moyenne /20</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.worst_classes.map((row) => (
                      <tr key={row.class_id} className="border-b last:border-0">
                        <td className="px-2 py-1.5 font-medium text-slate-800">
                          {row.class_label}
                        </td>
                        <td className="px-2 py-1.5 text-slate-700">{row.level || "—"}</td>
                        <td className="px-2 py-1.5 text-right text-slate-700">
                          {row.evals.toLocaleString("fr-FR")}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-amber-700">
                          {row.avg_20 == null
                            ? "—"
                            : row.avg_20.toLocaleString("fr-FR", {
                                minimumFractionDigits: 1,
                                maximumFractionDigits: 2,
                              })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardShell>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CardShell
            title="Dernières évaluations"
            icon={<NotebookPen className="h-4 w-4 text-slate-500" />}
            subtitle="10 derniers contrôles saisis, avec état de publication"
          >
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-7 w-full" />
                ))}
              </div>
            ) : latest.length === 0 ? (
              <div className="text-xs text-slate-500">
                Aucun contrôle enregistré sur la période.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs sm:text-sm">
                  <thead className="border-b bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Date</th>
                      <th className="px-2 py-1.5 text-left">Classe</th>
                      <th className="px-2 py-1.5 text-left">Matière</th>
                      <th className="px-2 py-1.5 text-left">Type</th>
                      <th className="px-2 py-1.5 text-right">Échelle</th>
                      <th className="px-2 py-1.5 text-right">Coeff</th>
                      <th className="px-2 py-1.5 text-left">Enseignant</th>
                      <th className="px-2 py-1.5 text-center">État</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latest.map((ev) => (
                      <tr key={ev.id} className="border-b last:border-0">
                        <td className="px-2 py-1.5 text-slate-700">{formatDate(ev.eval_date)}</td>
                        <td className="px-2 py-1.5 text-slate-800">
                          {ev.class_label}
                          {ev.level && (
                            <span className="ml-1 text-[11px] text-slate-500">({ev.level})</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-slate-700">{ev.subject_name || "—"}</td>
                        <td className="px-2 py-1.5 text-slate-700">
                          {evalKindLabel(ev.eval_kind)}
                        </td>
                        <td className="px-2 py-1.5 text-right text-slate-700">/{ev.scale}</td>
                        <td className="px-2 py-1.5 text-right text-slate-700">
                          {ev.coeff.toLocaleString("fr-FR")}
                        </td>
                        <td className="px-2 py-1.5 text-slate-700">
                          <span className="inline-flex items-center gap-1">
                            <User2 className="h-3.5 w-3.5 text-slate-400" />
                            {ev.teacher_name || "—"}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <span
                            className={[
                              "inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              ev.is_published
                                ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                                : "bg-slate-50 text-slate-600 ring-1 ring-slate-200",
                            ].join(" ")}
                          >
                            {ev.is_published ? "Publié" : "Brouillon"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardShell>
        </div>

        <CardShell
          title="Actions rapides"
          icon={<BarChart3 className="h-4 w-4 text-emerald-600" />}
          subtitle="Accès direct aux vues détaillées du cahier de notes"
        >
          <div className="space-y-2">
            <QuickLink href="/admin/notes/evaluations" icon={NotebookPen}>
              Liste détaillée des évaluations
            </QuickLink>
            <QuickLink href="/admin/notes/statistiques" icon={BarChart3}>
              Statistiques avancées (par classe / matière)
            </QuickLink>
            <QuickLink href="/admin/classes" icon={School}>
              Compléter les classes avant la saisie
            </QuickLink>
          </div>
        </CardShell>
      </section>
    </div>
  );
}