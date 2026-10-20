// src/app/admin/dashboard/client.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import "./dashboard-premium.css";
import { educationQuoteOfDay } from "@/lib/education-quote-of-day";
import Link from "next/link";
import { useSchoolNavigation } from "@/components/admin/SchoolNavigationProvider";
import {
  isScopedDashboardSelection,
  resolveScopedDashboardCounts,
  type CycleDashboardSummary,
} from "@/lib/multicycle-dashboard";
import {
  School,
  Users,
  UserRoundCheck,
  GraduationCap,
  CalendarClock,
  BookOpen,
  AlarmClock,
  RefreshCw,
  ChevronRight,
  TrendingUp,
  AlertTriangle,
  Clock4,
  BarChart3,
  FileSpreadsheet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { isFileCorrespondentPathAllowed } from "@/lib/auth/file-correspondent";
import { useAdminRole } from "../ui/admin-role-context";
import {
  fetchDashboardMetrics,
  fetchInstitutionSettings,
  syncRelayBootstrap,
  type LocalDataSource,
} from "@/lib/local-relay";

/* ─────────────────────────────
   Types d'API
───────────────────────────── */
type MetricsOk = {
  ok: true;
  counts: {
    classes: number;
    teachers: number;
    parents: number;
    students: number; // élèves ACTIFS
    students_total?: number;
    assigned_students?: number;
    not_assigned_students?: number;
    assignment_unknown?: number;
    boarder_students?: number;
    not_boarder_students?: number;
    boarding_unknown?: number;
    boys?: number;
    girls?: number;
    gender_unknown?: number;
  };
  kpis: { absences: number; retards: number };
  meta?: { days?: number; academic_year?: string | null; academic_year_label?: string | null };
};

type MetricsErr = { ok: false; error: string };
type DaysRange = 7 | 30 | 90;

type InstitutionInfo = {
  name: string;
  logo_url: string | null;
};

/** Heure civile ivoirienne, calculée uniquement dans le navigateur. */
function SchoolClockAndQuotes() {
  const [clock, setClock] = useState<{ date: string; time: string; quote: string } | null>(null);

  useEffect(() => {
    const dateFormat = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Africa/Abidjan",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const timeFormat = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Africa/Abidjan",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const refreshClock = () => {
      const now = new Date();
      setClock({ date: dateFormat.format(now), time: timeFormat.format(now), quote: educationQuoteOfDay(now) });
    };

    refreshClock();
    const timer = window.setInterval(refreshClock, 30_000);
    document.addEventListener("visibilitychange", refreshClock);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshClock);
    };
  }, []);

  return (
    <div className="premium-school-insights flex min-w-0 flex-col gap-2 rounded-2xl border border-blue-900/30 bg-[#10243A] px-4 py-2.5 text-white shadow-sm sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300 sm:text-xs">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          <span>Citation du jour</span>
        </div>
        <p className="premium-school-quote min-w-0 flex-1" aria-label="Citation du jour">
          {clock ? `« ${clock.quote} »` : "Chargement de la citation du jour…"}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/15 pt-2 text-xs sm:border-l sm:border-t-0 sm:py-0 sm:pl-4 sm:pt-0" aria-label="Date et heure en Côte d’Ivoire">
        <span className="inline-flex items-center gap-1.5 text-slate-200">
          <CalendarClock className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          <span className="capitalize">{clock?.date ?? "Date du jour"}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-white">
          <Clock4 className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          <span>{clock?.time ?? "--:--"}</span>
          <span className="sr-only">heure d’Abidjan</span>
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────────────
   Petites briques UI
───────────────────────────── */
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200/70 ${className}`} />;
}

function CountUp({
  value,
  duration = 700,
  className = "",
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  const [display, setDisplay] = useState(0);
  const prev = useRef(0);

  useEffect(() => {
    const start = performance.now();
    const from = prev.current;
    const diff = value - from;
    let raf = 0;

    function tick(t: number) {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + diff * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    prev.current = value;
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <span className={className} aria-live="polite" aria-atomic="true">
      {display.toLocaleString()}
    </span>
  );
}

type StatAccent = "blue" | "indigo" | "amber" | "violet" | "emerald" | "rose" | "sky" | "slate" | "pink";

const statAccents: Record<StatAccent, { ring: string; icon: string; bar: string }> = {
  blue: { ring: "ring-blue-100 hover:ring-blue-200", icon: "bg-blue-50 text-blue-600 ring-blue-100", bar: "bg-blue-500" },
  indigo: { ring: "ring-indigo-100 hover:ring-indigo-200", icon: "bg-indigo-50 text-indigo-600 ring-indigo-100", bar: "bg-indigo-500" },
  amber: { ring: "ring-amber-100 hover:ring-amber-200", icon: "bg-amber-50 text-amber-600 ring-amber-100", bar: "bg-amber-500" },
  violet: { ring: "ring-violet-100 hover:ring-violet-200", icon: "bg-violet-50 text-violet-600 ring-violet-100", bar: "bg-violet-500" },
  emerald: { ring: "ring-emerald-100 hover:ring-emerald-200", icon: "bg-emerald-50 text-emerald-600 ring-emerald-100", bar: "bg-emerald-500" },
  rose: { ring: "ring-rose-100 hover:ring-rose-200", icon: "bg-rose-50 text-rose-600 ring-rose-100", bar: "bg-rose-500" },
  sky: { ring: "ring-sky-100 hover:ring-sky-200", icon: "bg-sky-50 text-sky-600 ring-sky-100", bar: "bg-sky-500" },
  slate: { ring: "ring-slate-100 hover:ring-slate-200", icon: "bg-slate-100 text-slate-600 ring-slate-200", bar: "bg-slate-500" },
  pink: { ring: "ring-pink-100 hover:ring-pink-200", icon: "bg-pink-50 text-pink-600 ring-pink-100", bar: "bg-pink-500" },
};

/** Purely presentational: never invent a percentage for incomplete or inconsistent totals. */
function percentageOf(part: number, total: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0 || part < 0 || part > total) return null;
  return Math.round((part / total) * 1000) / 10;
}

function StatCard({
  label,
  value,
  Icon,
  accent = "emerald",
  loading,
  sub,
  percentage,
}: {
  label: string;
  value: number | null;
  Icon: any;
  accent?: StatAccent;
  loading?: boolean;
  sub?: string;
  percentage?: number | null;
}) {
  const theme = statAccents[accent];
  const showPercentage = !loading && value !== null && percentage !== null && percentage !== undefined && Number.isFinite(percentage);
  const percentageLabel = showPercentage
    ? percentage.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : "";

  return (
    <Card className={`rounded-2xl border-slate-200/80 shadow-sm ring-1 transition ${theme.ring}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="text-sm text-slate-500">{label}</div>
            <div className="text-3xl font-semibold tracking-tight">
              {loading ? <Skeleton className="h-8 w-16" /> : value === null ? <span aria-label="Non disponible">—</span> : <CountUp value={value} />}
            </div>
            {sub && <div className="text-xs text-slate-500">{sub}</div>}
          </div>
          <div className={`shrink-0 rounded-xl p-3 ring-1 ${theme.icon}`}>
            <Icon className="h-6 w-6" />
          </div>
        </div>
        {showPercentage && (
          <div className="mt-3 space-y-1.5">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-label={`${label} : ${percentageLabel} % des élèves`}
              aria-valuenow={percentage}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className={`h-full rounded-full ${theme.bar}`} style={{ width: `${percentage}%` }} />
            </div>
            <div className="text-right text-xs font-medium tabular-nums text-slate-500">{percentageLabel} %</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KpiCard({
  title,
  value,
  hint,
  tone = "red",
  periodLabel = "30 derniers jours",
  loading,
}: {
  title: string;
  value: number | null;
  hint?: string;
  tone?: "red" | "amber" | "emerald";
  periodLabel?: string;
  loading?: boolean;
}) {
  const tones = {
    red: {
      ring: "ring-red-500/30",
      chip: "bg-red-50 text-red-700",
      icon: <AlertTriangle className="h-4 w-4" />,
      bg: "from-red-50 to-white",
      border: "border-red-200/70",
    },
    amber: {
      ring: "ring-amber-500/30",
      chip: "bg-amber-50 text-amber-800",
      icon: <AlarmClock className="h-4 w-4" />,
      bg: "from-amber-50 to-white",
      border: "border-amber-200/70",
    },
    emerald: {
      ring: "ring-emerald-500/30",
      chip: "bg-emerald-50 text-emerald-700",
      icon: <TrendingUp className="h-4 w-4" />,
      bg: "from-emerald-50 to-white",
      border: "border-emerald-200/70",
    },
  } as const;

  const t = tones[tone];

  return (
    <Card
      className={`rounded-2xl shadow-sm ring-1 ${t.ring} ${t.border} border bg-gradient-to-b ${t.bg}`}
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-sm text-slate-600">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs ${t.chip}`}
          >
            {t.icon}
            {periodLabel}
          </span>
          <span className="ml-auto text-[11px] font-medium text-slate-500">{title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="text-3xl font-semibold">
          {loading ? <Skeleton className="h-8 w-20" /> : value === null ? <span aria-label="Non disponible">—</span> : <CountUp value={value} />}
        </div>
        {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
      </CardContent>
    </Card>
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
  const role = useAdminRole();
  if (role === "file_correspondent" && !isFileCorrespondentPathAllowed(href)) {
    return null;
  }
  return (
    <Link href={href} className="group">
      <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-100">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-white p-2 text-emerald-700 ring-1 ring-emerald-100">
            <Icon className="h-5 w-5" />
          </div>
          <span className="text-sm font-medium text-emerald-900 group-hover:text-emerald-950">
            {children}
          </span>
        </div>
        <ChevronRight className="h-5 w-5 text-emerald-500 transition group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function Segmented({ value, onChange }: { value: DaysRange; onChange: (v: DaysRange) => void }) {
  const opts: DaysRange[] = [7, 30, 90];
  return (
    <div className="inline-flex rounded-full border border-emerald-200 bg-white p-1 text-sm shadow-sm">
      {opts.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          className={`rounded-full px-3 py-1.5 transition ${
            value === d ? "bg-emerald-600 text-white shadow" : "text-emerald-700 hover:bg-emerald-50"
          }`}
          aria-pressed={value === d}
        >
          {d}j
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────────
   Composant principal
───────────────────────────── */
export default function AdminDashboardClient() {
  const [data, setData] = useState<MetricsOk | MetricsErr | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState<DaysRange>(30);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const [institution, setInstitution] = useState<InstitutionInfo | null>(null);
  const [loadingInstitution, setLoadingInstitution] = useState(true);
  const role = useAdminRole();
  const schoolNavigation = useSchoolNavigation();
  const specializedViewSelected = schoolNavigation
    ? isScopedDashboardSelection(schoolNavigation.selection) : false;
  const [cycleSummary, setCycleSummary] = useState<CycleDashboardSummary | null>(null);
  const [cycleLoading, setCycleLoading] = useState(false);
  const [cycleError, setCycleError] = useState("");
  const [dataSource, setDataSource] = useState<LocalDataSource>("cloud");

  useEffect(() => {
    if (!specializedViewSelected) return;
    const controller = new AbortController();
    let live = true;
    setCycleLoading(true);
    setCycleError("");
    fetch("/api/admin/school-cycles", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const result = await response.json() as CycleDashboardSummary & { error?: string };
        if (!response.ok || !result.ok || !result.enabled) {
          throw new Error(result.error || "Effectifs pédagogiques indisponibles");
        }
        if (live) setCycleSummary(result);
      })
      .catch(error => {
        if (!live) return;
        setCycleSummary(null);
        setCycleError(error instanceof Error ? error.message : "Effectifs indisponibles");
      })
      .finally(() => { if (live) setCycleLoading(false); });
    return () => { live = false; controller.abort(); };
  }, [specializedViewSelected]);

  const nfmt = useMemo(() => new Intl.NumberFormat(), []);
  void nfmt;

  async function load(d: DaysRange = days) {
    try {
      setRefreshing(true);
      const result = await fetchDashboardMetrics<MetricsOk | MetricsErr>(d);
      setData(result.data);
      setDataSource(result.source);
      setUpdatedAt(new Date(result.saved_at));
      if (result.source === "cloud" && role !== "file_correspondent") void syncRelayBootstrap();
    } catch (e: any) {
      setData({ ok: false, error: e?.message ?? "NETWORK_ERROR" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadingInstitution(true);

    (async () => {
      try {
        const [metricsResult, institutionResult] = await Promise.all([
          fetchDashboardMetrics<MetricsOk | MetricsErr>(days),
          fetchInstitutionSettings<Record<string, any>>(),
        ]);

        if (!alive) return;

        setData(metricsResult.data);
        setDataSource(metricsResult.source);
        setUpdatedAt(new Date(metricsResult.saved_at));

        const instJson = institutionResult.data;
        const name = String(instJson?.institution_name || "").trim();
        const logo =
          typeof instJson?.institution_logo_url === "string"
            ? instJson.institution_logo_url
            : "";
        setInstitution({
          name: name || "Votre établissement",
          logo_url: logo || null,
        });

        if (metricsResult.source === "cloud" && role !== "file_correspondent") void syncRelayBootstrap();
      } catch (e: any) {
        if (!alive) return;
        setData({ ok: false, error: e?.message ?? "NETWORK_ERROR" });
      } finally {
        if (!alive) return;
        setLoading(false);
        setLoadingInstitution(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isOk = !!data && "ok" in data && (data as any).ok;
  const counts = isOk
    ? (data as MetricsOk).counts
    : {
        classes: 0,
        teachers: 0,
        parents: 0,
        students: 0,
        students_total: 0,
        assigned_students: 0,
        not_assigned_students: 0,
        assignment_unknown: 0,
        boarder_students: 0,
        not_boarder_students: 0,
        boarding_unknown: 0,
        boys: 0,
        girls: 0,
        gender_unknown: 0,
      };

  const absences = isOk ? (data as MetricsOk).kpis?.absences ?? 0 : 0;
  const retards = isOk ? (data as MetricsOk).kpis?.retards ?? 0 : 0;

  const meta = isOk ? (data as MetricsOk).meta : undefined;
  const periodLabel = `${meta?.days || days} derniers jours`;
  const academicYearLabel = String(meta?.academic_year_label || meta?.academic_year || "").trim();
  const assignedStudents = counts.assigned_students ?? 0;
  const notAssignedStudents = counts.not_assigned_students ?? 0;
  const assignmentUnknown = counts.assignment_unknown ?? 0;
  const boarderStudents = counts.boarder_students ?? 0;
  const notBoarderStudents = counts.not_boarder_students ?? 0;
  const boardingUnknown = counts.boarding_unknown ?? 0;
  const boys = counts.boys ?? 0;
  const girls = counts.girls ?? 0;
  const genderUnknown = counts.gender_unknown ?? 0;
  const isFinanceManager = role === "finance_manager";
  const selection = schoolNavigation?.selection;
  const scoped = selection ? isScopedDashboardSelection(selection) : false;
  const scopedCounts = selection && scoped
    ? resolveScopedDashboardCounts(selection, cycleSummary)
    : null;
  const countLoading = loading || (scoped && cycleLoading);
  // Only cycle-wide roster counts and mapped teaching assignments are verified.
  // No other school-wide counts may silently carry over under a teaching filter.
  const unavailableHint = "Non disponible pour ce filtre";

  return (
    <div className="premium-school-dashboard space-y-6">
      <div className="space-y-2">
      {/* En-tête gradient (section héro) */}
      <div className="premium-school-hero relative overflow-hidden rounded-3xl p-5 text-white sm:p-6">
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            background:
              "radial-gradient(500px 200px at 10% -10%, rgba(255,255,255,0.6), transparent 60%), radial-gradient(300px 120px at 90% 120%, rgba(255,255,255,0.4), transparent 60%)",
          }}
        />
        <div className="relative z-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {institution?.logo_url && (
              <div className="hidden h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/40 sm:flex">
                <img
                  src={institution.logo_url}
                  alt={`Logo de ${institution.name}`}
                  className="h-10 w-10 object-contain"
                />
              </div>
            )}
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-black/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide">
                <span className="opacity-90">Mon Cahier</span>
                <span className="h-1 w-1 rounded-full bg-white/70" />
                <span className="opacity-80">Absences &amp; notes</span>
              </div>
              <h1 className="mt-2 text-xl font-semibold tracking-tight drop-shadow-sm sm:text-2xl">
                {loadingInstitution
                  ? "Espace établissement"
                  : institution?.name || "Espace établissement"}
              </h1>
              <p className="mt-1 text-sm leading-5 text-white/90">
                Suivi des <strong>absences</strong>, des <strong>retards</strong>, de la{" "}
                <strong>conduite</strong> et des <strong>notes</strong> de votre établissement.
              </p>
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <Segmented
              value={days}
              onChange={(d) => {
                setDays(d);
                load(d);
              }}
            />
            <div className="flex items-center justify-end gap-2">
              {academicYearLabel && (
                <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/30">
                  <School className="mr-1 h-3.5 w-3.5" />
                  Année : {academicYearLabel}
                </Badge>
              )}
              <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/30">
                <CalendarClock className="mr-1 h-3.5 w-3.5" />
                {periodLabel}
              </Badge>
              <Button
                variant="secondary"
                className="bg-white text-emerald-700 hover:bg-white/90"
                onClick={() => load(days)}
                disabled={refreshing}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                Actualiser
              </Button>
            </div>
          </div>
        </div>

        <div className="relative z-10 mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className={`rounded-full border px-3 py-1 ${
            dataSource === "cloud"
              ? "border-white/40 bg-white/20 text-white"
              : dataSource === "relay"
              ? "border-sky-100 bg-sky-50 text-sky-800"
              : "border-amber-100 bg-amber-50 text-amber-900"
          }`}>
            {dataSource === "cloud"
              ? "Cloud connecté"
              : dataSource === "relay"
              ? "Relais local actif"
              : "Dernière vue locale connue"}
          </span>
          {updatedAt && <span className="text-white/90">Actualisé à {updatedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>}
        </div>

        {/* État d'erreur */}
        {!loading && data && "ok" in data && !data.ok && (
          <div className="relative z-10 mt-4 rounded-xl border border-red-300/60 bg-red-50/90 px-4 py-3 text-sm text-red-800">
            {(data as MetricsErr).error === "UNAUTHENTICATED"
              ? "Session expirée. Réactualisez la page ou reconnectez-vous."
              : (data as MetricsErr).error === "FORBIDDEN"
              ? "Accès non autorisé."
              : "Erreur lors du chargement des métriques."}
          </div>
        )}
      </div>
      <SchoolClockAndQuotes />
      </div>

      {scoped && (
        <div role="status" className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950">
          <strong>Vue pédagogique filtrée.</strong> Les effectifs affichés correspondent aux
          inscriptions du cycle ou aux enseignants affectés aux matières de l’enseignement.
          Les statistiques non attribuables de façon certaine restent « — », et non zéro.
          {cycleError && <p className="mt-1 text-amber-900">Chargement : {cycleError}</p>}
          <p className="mt-1 text-xs">
            Les absences, finances et autres modules ne sont pas encore filtrés par ce sélecteur.
          </p>
        </div>
      )}

      {/* Cartes compteurs (vue globale simple, 1 colonne mobile) */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Classes"
          value={scoped ? scopedCounts?.classes ?? null : counts.classes}
          sub={scoped && scopedCounts?.classes === null ? unavailableHint : undefined}
          Icon={School}
          accent="blue"
          loading={countLoading}
        />
        <StatCard
          label="Enseignants"
          value={scoped ? scopedCounts?.teachers ?? null : counts.teachers}
          sub={scoped && scopedCounts?.teachers === null ? unavailableHint : undefined}
          Icon={Users}
          accent="indigo"
          loading={countLoading}
        />
        <StatCard
          label="Parents"
          value={scoped ? null : counts.parents}
          sub={scoped ? unavailableHint : undefined}
          Icon={UserRoundCheck}
          accent="amber"
          loading={countLoading}
        />
        <StatCard
          label="Élèves"
          value={scoped ? scopedCounts?.students ?? null : counts.students}
          sub={scoped ? scopedCounts?.students === null ? unavailableHint : undefined : (
            counts.students_total !== undefined && counts.students_total !== counts.students
              ? `Total : ${counts.students_total}`
              : undefined)
          }
          Icon={GraduationCap}
          accent="violet"
          loading={countLoading}
        />
      </section>

      {/* Profil élèves : lecture financière et administrative sans casser le dashboard existant */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Affectés"
          value={scoped ? null : assignedStudents}
          Icon={UserRoundCheck}
          accent="emerald"
          loading={loading}
          sub={!scoped && assignmentUnknown > 0 ? `${assignmentUnknown} non renseigné(s)` : undefined}
          percentage={scoped ? null : percentageOf(assignedStudents, counts.students)}
        />
        <StatCard
          label="Non affectés"
          value={scoped ? null : notAssignedStudents}
          Icon={Users}
          accent="rose"
          loading={loading}
          percentage={scoped ? null : percentageOf(notAssignedStudents, counts.students)}
        />
        <StatCard
          label="Internes"
          value={scoped ? null : boarderStudents}
          Icon={School}
          accent="sky"
          loading={loading}
          sub={!scoped && boardingUnknown > 0 ? `${boardingUnknown} internat non renseigné` : undefined}
          percentage={scoped ? null : percentageOf(boarderStudents, counts.students)}
        />
        <StatCard
          label="Non internes"
          value={scoped ? null : notBoarderStudents}
          Icon={School}
          accent="slate"
          loading={loading}
          percentage={scoped ? null : percentageOf(notBoarderStudents, counts.students)}
        />
        <StatCard
          label="Garçons"
          value={scoped ? null : boys}
          Icon={GraduationCap}
          accent="blue"
          loading={loading}
          sub={!scoped && genderUnknown > 0 ? `${genderUnknown} sexe non renseigné` : undefined}
          percentage={scoped ? null : percentageOf(boys, counts.students)}
        />
        <StatCard
          label="Filles"
          value={scoped ? null : girls}
          Icon={GraduationCap}
          accent="pink"
          loading={loading}
          percentage={scoped ? null : percentageOf(girls, counts.students)}
        />
      </section>

      {/* KPIs + Raccourcis (raccourcis cachés sur mobile) */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <KpiCard
          title="Absences / période"
          value={scoped ? null : absences}
          hint="Total des absences enregistrées sur la période sélectionnée."
          tone="red"
          periodLabel={periodLabel}
          loading={loading}
        />
        <KpiCard
          title="Retards / période"
          value={scoped ? null : retards}
          hint="Total des retards enregistrés sur la période sélectionnée."
          tone="amber"
          periodLabel={periodLabel}
          loading={loading}
        />
        {/* 👉 Raccourcis visibles uniquement à partir de md (pas sur mobile) */}
        <Card className="hidden rounded-2xl border-emerald-200 bg-emerald-50/50 shadow-sm md:block">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-emerald-900">
              Raccourcis établissement
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {isFinanceManager ? (
                <>
                  <QuickLink href="/admin/finance" icon={FileSpreadsheet}>
                    Gestion financière
                  </QuickLink>
                  <QuickLink href="/admin/parents" icon={Users}>
                    Listes de classe
                  </QuickLink>
                </>
              ) : (
                <>
                  <QuickLink href="/admin/classes" icon={School}>
                    Créer des classes
                  </QuickLink>
                  <QuickLink href="/admin/users" icon={Users}>
                    Créer un enseignant
                  </QuickLink>
                  <QuickLink href="/admin/affectations" icon={UserRoundCheck}>
                    Affecter des classes
                  </QuickLink>
                  <QuickLink href="/admin/parents" icon={Users}>
                    Liste des classes
                  </QuickLink>
                  <QuickLink href="/admin/import" icon={GraduationCap}>
                    Importer élèves
                  </QuickLink>
                  <QuickLink href="/admin/statistiques" icon={BarChart3}>
                    Contrôle des enseignants
                  </QuickLink>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Bandeau onboarding si aucune classe */}
      {!loading && isOk && counts.classes === 0 && (
        <Card className="rounded-2xl border-amber-200 bg-amber-50/60 shadow-sm">
          <CardContent className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-medium text-amber-900">Commencez par créer vos classes</div>
              <div className="text-sm text-amber-800/90">
                Aucune classe trouvée pour le moment. Ajoutez vos classes pour activer la prise de
                présence.
              </div>
            </div>
            <Button asChild className="bg-amber-600 text-white hover:bg-amber-600/90">
              <Link href="/admin/classes">
                <School className="mr-2 h-4 w-4" /> Créer des classes
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <Separator className="my-2" />
      </div>
      <div className="flex items-center justify-between text-xs text-slate-400">
        <div>
          © {new Date().getFullYear()} Mon Cahier · Absences &amp; Notes · Tableau de bord
        </div>
        <div className="inline-flex items-center gap-1 text-slate-400">
          <Clock4 className="h-3.5 w-3.5" />
          {updatedAt
            ? `Mis à jour à ${updatedAt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}`
            : "—"}
        </div>
      </div>
    </div>
  );
}
