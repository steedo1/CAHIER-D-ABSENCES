// src/app/admin/export-moyennes/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Download,
  FileText,
  ChevronLeft,
  CalendarRange,
  School,
  ClipboardList,
  Layers3,
  ShieldCheck,
  FileSpreadsheet,
  Database,
  LockKeyhole,
  CheckCircle2,
  BarChart3,
  BookOpen,
  Trophy,
} from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "super_admin" | "admin" | "educator" | "teacher" | "parent" | string;

type ClassRow = {
  id: string;
  label?: string | null;
  code?: string | null;
  level?: string | null;
  academic_year?: string | null;
};

type GradePeriodRow = {
  id: string;
  academic_year?: string | null;
  code?: string | null;
  label?: string | null;
  short_label?: string | null;
  start_date: string;
  end_date: string;
};

function formatDateFR(iso?: string | null) {
  if (!iso) return "—";

  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) {
    return String(iso);
  }

  return d.toLocaleDateString("fr-FR");
}

function periodDisplayLabel(period: GradePeriodRow) {
  const title =
    String(period.short_label || "").trim() ||
    String(period.label || "").trim() ||
    String(period.code || "").trim() ||
    "Période";

  const year = String(period.academic_year || "").trim();

  return `${year ? `[${year}] ` : ""}${title} — ${formatDateFR(
    period.start_date
  )} → ${formatDateFR(period.end_date)}`;
}

function classDisplayLabel(cls: ClassRow) {
  const label = String(cls.label || cls.code || "Classe").trim();
  const level = String(cls.level || "").trim();
  const year = String(cls.academic_year || "").trim();

  const suffix = [level, year].filter(Boolean).join(" • ");

  return suffix ? `${label} — ${suffix}` : label;
}

async function getAdminContext() {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("institution_id, role")
    .eq("profile_id", user.id)
    .in("role", ["admin", "super_admin"])
    .limit(1)
    .maybeSingle();

  if (!roleRow?.institution_id) {
    redirect("/admin/dashboard");
  }

  return {
    supabase,
    role: roleRow.role as Role,
    institutionId: String(roleRow.institution_id),
  };
}

function EmptyOption({ label }: { label: string }) {
  return <option value="">{label}</option>;
}

function PeriodSelect({
  focusColor = "emerald",
}: {
  focusColor?: "emerald" | "indigo" | "amber" | "sky";
}) {
  const focusClass =
    focusColor === "indigo"
      ? "focus:border-indigo-500 focus:ring-indigo-500/15"
      : focusColor === "amber"
        ? "focus:border-amber-500 focus:ring-amber-500/15"
        : focusColor === "sky"
          ? "focus:border-sky-500 focus:ring-sky-500/15"
          : "focus:border-emerald-500 focus:ring-emerald-500/15";

  return focusClass;
}

export default async function ExportDespsPage() {
  const { supabase, institutionId } = await getAdminContext();

  const [{ data: classesData }, { data: periodsData }] = await Promise.all([
    supabase
      .from("classes")
      .select("id, label, code, level, academic_year")
      .eq("institution_id", institutionId)
      .order("level", { ascending: true })
      .order("label", { ascending: true }),

    supabase
      .from("grade_periods")
      .select("id, academic_year, code, label, short_label, start_date, end_date")
      .eq("institution_id", institutionId)
      .order("start_date", { ascending: false }),
  ]);

  const classes = ((classesData || []) as ClassRow[]).filter((c) => !!c.id);
  const periods = ((periodsData || []) as GradePeriodRow[]).filter((p) => !!p.id);

  const academicYears = Array.from(
    new Set(
      [...classes.map((c) => c.academic_year), ...periods.map((p) => p.academic_year)]
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => b.localeCompare(a, "fr"));

  const defaultAcademicYear = academicYears[0] ?? "";
  const hasAcademicYears = academicYears.length > 0;
  const hasPeriods = periods.length > 0;
  const hasClasses = classes.length > 0;

  const selectBase =
    "w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:ring-4";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5">
          <Link
            href="/admin/dashboard"
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
          >
            <ChevronLeft className="h-4 w-4" />
            Retour au tableau de bord
          </Link>
        </div>

        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-sm">
          <header className="relative overflow-hidden border-b border-slate-200 bg-slate-950">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.35),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(79,70,229,0.32),transparent_35%)]" />

            <div className="relative px-5 py-7 text-white sm:px-7 lg:px-8">
              <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-end">
                <div className="max-w-4xl">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.2em] text-emerald-100 ring-1 ring-white/15">
                    <ShieldCheck className="h-4 w-4" />
                    Exports officiels DESPS
                  </div>

                  <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
                    États officiels, moyennes et résultats annuels
                  </h1>

                  <p className="mt-3 max-w-3xl text-sm font-medium leading-6 text-slate-200">
                    Centralisation des exports utilisés pour les états de moyennes,
                    les récapitulatifs annuels, le DFA, le Rapport F et le recensement
                    annuel des établissements.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3 rounded-[26px] border border-white/10 bg-white/10 p-3 backdrop-blur">
                  <div className="rounded-2xl bg-white/10 px-3 py-3 text-center ring-1 ring-white/10">
                    <div className="text-2xl font-black">{classes.length}</div>
                    <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-200">
                      Classes
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white/10 px-3 py-3 text-center ring-1 ring-white/10">
                    <div className="text-2xl font-black">{periods.length}</div>
                    <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-200">
                      Périodes
                    </div>
                  </div>

                  <div className="rounded-2xl bg-white/10 px-3 py-3 text-center ring-1 ring-white/10">
                    <div className="text-2xl font-black">{academicYears.length}</div>
                    <div className="mt-1 text-[11px] font-bold uppercase tracking-wide text-slate-200">
                      Années
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <div className="border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-7 lg:px-8">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="flex items-center gap-3 rounded-3xl border border-emerald-100 bg-white px-4 py-3 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-black text-slate-950">
                    Exports existants conservés
                  </p>
                  <p className="text-xs font-medium text-slate-500">
                    Notes et récapitulatif annuel
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-3xl border border-indigo-100 bg-white px-4 py-3 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
                  <BarChart3 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-black text-slate-950">
                    Agrégats DESPS actifs
                  </p>
                  <p className="text-xs font-medium text-slate-500">
                    Rendement, discipline, DFA
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-3xl border border-amber-100 bg-white px-4 py-3 shadow-sm">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-amber-100">
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-black text-slate-950">
                    Intégration progressive
                  </p>
                  <p className="text-xs font-medium text-slate-500">
                    Modèles Excel officiels ensuite
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-6 lg:p-7">
            <div className="mb-5">
              <h2 className="text-xl font-black text-slate-950">
                Exports déjà disponibles
              </h2>
              <p className="mt-1 text-sm font-medium text-slate-500">
                Ces exports gardent le comportement existant de Mon Cahier.
              </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-[28px] border border-emerald-100 bg-emerald-50/70 p-4 shadow-sm sm:p-5">
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
                    <ClipboardList className="h-5 w-5" />
                  </div>

                  <div>
                    <h2 className="text-lg font-black text-slate-950">
                      Moyennes trimestrielles DESPS
                    </h2>
                    <p className="mt-1 text-sm font-medium text-slate-600">
                      Export des notes et moyennes par matière sur une période donnée.
                    </p>
                  </div>
                </div>

                <form
                  action="/api/admin/exports/averages"
                  method="GET"
                  className="space-y-4 rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm"
                >
                  <input type="hidden" name="export_kind" value="dsps_notes" />

                  <div>
                    <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                      <CalendarRange className="h-4 w-4" />
                      Année scolaire
                    </label>

                    <select
                      name="academic_year"
                      required
                      className={`${selectBase} ${PeriodSelect({ focusColor: "emerald" })}`}
                      defaultValue={defaultAcademicYear}
                    >
                      {!hasAcademicYears ? (
                        <EmptyOption label="Aucune année disponible" />
                      ) : (
                        academicYears.map((year) => (
                          <option key={`notes-year-${year}`} value={year}>
                            {year}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                      <CalendarRange className="h-4 w-4" />
                      Trimestre / période
                    </label>

                    <select
                      name="period_ref"
                      required
                      className={`${selectBase} ${PeriodSelect({ focusColor: "emerald" })}`}
                      defaultValue=""
                    >
                      <option value="" disabled>
                        {hasPeriods ? "Sélectionner une période" : "Aucune période disponible"}
                      </option>

                      {periods.map((period) => (
                        <option key={period.id} value={`period:${period.id}`}>
                          {periodDisplayLabel(period)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                      <School className="h-4 w-4" />
                      Classe
                    </label>

                    <select
                      name="class_id"
                      className={`${selectBase} ${PeriodSelect({ focusColor: "emerald" })}`}
                      defaultValue=""
                    >
                      <option value="">
                        {hasClasses ? "Toutes les classes" : "Aucune classe disponible"}
                      </option>

                      {classes.map((cls) => (
                        <option key={`notes-class-${cls.id}`} value={cls.id}>
                          {classDisplayLabel(cls)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="submit"
                      name="format"
                      value="xlsx"
                      disabled={!hasAcademicYears || !hasPeriods}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      <Download className="h-4 w-4" />
                      Excel trimestriel
                    </button>

                    <button
                      type="submit"
                      name="format"
                      value="csv"
                      disabled={!hasAcademicYears || !hasPeriods}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <FileText className="h-4 w-4" />
                      CSV trimestriel
                    </button>
                  </div>
                </form>
              </section>

              <section className="rounded-[28px] border border-indigo-100 bg-indigo-50/70 p-4 shadow-sm sm:p-5">
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
                    <Layers3 className="h-5 w-5" />
                  </div>

                  <div>
                    <h2 className="text-lg font-black text-slate-950">
                      Résultats annuels / DFA
                    </h2>
                    <p className="mt-1 text-sm font-medium text-slate-600">
                      Export annuel des moyennes, rangs et décisions disponibles.
                    </p>
                  </div>
                </div>

                <form
                  action="/api/admin/exports/averages"
                  method="GET"
                  className="space-y-4 rounded-3xl border border-indigo-100 bg-white p-4 shadow-sm"
                >
                  <input type="hidden" name="export_kind" value="dsps_annual" />

                  <div>
                    <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                      <CalendarRange className="h-4 w-4" />
                      Année scolaire
                    </label>

                    <select
                      name="academic_year"
                      required
                      className={`${selectBase} ${PeriodSelect({ focusColor: "indigo" })}`}
                      defaultValue={defaultAcademicYear}
                    >
                      {!hasAcademicYears ? (
                        <EmptyOption label="Aucune année disponible" />
                      ) : (
                        academicYears.map((year) => (
                          <option key={`annual-year-${year}`} value={year}>
                            {year}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                      <School className="h-4 w-4" />
                      Classe
                    </label>

                    <select
                      name="class_id"
                      className={`${selectBase} ${PeriodSelect({ focusColor: "indigo" })}`}
                      defaultValue=""
                    >
                      <option value="">
                        {hasClasses ? "Toutes les classes" : "Aucune classe disponible"}
                      </option>

                      {classes.map((cls) => (
                        <option key={`annual-class-${cls.id}`} value={cls.id}>
                          {classDisplayLabel(cls)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="submit"
                      name="format"
                      value="xlsx"
                      disabled={!hasAcademicYears}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      <Download className="h-4 w-4" />
                      Excel annuel
                    </button>

                    <button
                      type="submit"
                      name="format"
                      value="csv"
                      disabled={!hasAcademicYears}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <FileText className="h-4 w-4" />
                      CSV annuel
                    </button>
                  </div>
                </form>
              </section>
            </div>
          </div>

          <div className="border-t border-slate-200 bg-slate-50 p-5 sm:p-6 lg:p-7">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-black text-slate-950">
                  Tableaux agrégés DESPS
                </h2>
                <p className="mt-1 text-sm font-medium text-slate-500">
                  Ces exports préparent les tableaux officiels attendus dans les modèles DESPS.
                </p>
              </div>

              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-100">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Actif
              </span>
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <section className="rounded-[28px] border border-amber-100 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-sm">
                    <BarChart3 className="h-5 w-5" />
                  </div>

                  <div>
                    <h3 className="text-lg font-black text-slate-950">
                      Rendement trimestriel
                    </h3>
                    <p className="mt-1 text-sm font-medium text-slate-600">
                      Effectifs, classés, non classés, moyennes et taux de réussite.
                    </p>
                  </div>
                </div>

                <form
                  action="/api/admin/exports/averages"
                  method="GET"
                  className="space-y-4"
                >
                  <input type="hidden" name="export_kind" value="desps_term_summary" />

                  <div>
                    <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                      <CalendarRange className="h-4 w-4" />
                      Année scolaire
                    </label>

                    <select
                      name="academic_year"
                      required
                      className={`${selectBase} ${PeriodSelect({ focusColor: "amber" })}`}
                      defaultValue={defaultAcademicYear}
                    >
                      {!hasAcademicYears ? (
                        <EmptyOption label="Aucune année disponible" />
                      ) : (
                        academicYears.map((year) => (
                          <option key={`term-summary-year-${year}`} value={year}>
                            {year}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                      <CalendarRange className="h-4 w-4" />
                      Trimestre / période
                    </label>

                    <select
                      name="period_ref"
                      required
                      className={`${selectBase} ${PeriodSelect({ focusColor: "amber" })}`}
                      defaultValue=""
                    >
                      <option value="" disabled>
                        {hasPeriods ? "Sélectionner une période" : "Aucune période disponible"}
                      </option>

                      {periods.map((period) => (
                        <option key={`term-summary-period-${period.id}`} value={`period:${period.id}`}>
                          {periodDisplayLabel(period)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                      <School className="h-4 w-4" />
                      Classe
                    </label>

                    <select
                      name="class_id"
                      className={`${selectBase} ${PeriodSelect({ focusColor: "amber" })}`}
                      defaultValue=""
                    >
                      <option value="">
                        {hasClasses ? "Toutes les classes" : "Aucune classe disponible"}
                      </option>

                      {classes.map((cls) => (
                        <option key={`term-summary-class-${cls.id}`} value={cls.id}>
                          {classDisplayLabel(cls)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <button
                      type="submit"
                      name="format"
                      value="xlsx"
                      disabled={!hasAcademicYears || !hasPeriods}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      <Download className="h-4 w-4" />
                      Excel
                    </button>

                    <button
                      type="submit"
                      name="format"
                      value="csv"
                      disabled={!hasAcademicYears || !hasPeriods}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <FileText className="h-4 w-4" />
                      CSV
                    </button>
                  </div>
                </form>
              </section>

              <section className="rounded-[28px] border border-sky-100 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-600 text-white shadow-sm">
                    <BookOpen className="h-5 w-5" />
                  </div>

                  <div>
                    <h3 className="text-lg font-black text-slate-950">
                      Moyennes par discipline
                    </h3>
                    <p className="mt-1 text-sm font-medium text-slate-600">
                      Synthèse par matière, niveau, classe et taux de réussite.
                    </p>
                  </div>
                </div>

                <form
                  action="/api/admin/exports/averages"
                  method="GET"
                  className="space-y-4"
                >
                  <input type="hidden" name="export_kind" value="desps_subject_summary" />

                  <div>
                    <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                      <CalendarRange className="h-4 w-4" />
                      Année scolaire
                    </label>

                    <select
                      name="academic_year"
                      required
                      className={`${selectBase} ${PeriodSelect({ focusColor: "sky" })}`}
                      defaultValue={defaultAcademicYear}
                    >
                      {!hasAcademicYears ? (
                        <EmptyOption label="Aucune année disponible" />
                      ) : (
                        academicYears.map((year) => (
                          <option key={`subject-summary-year-${year}`} value={year}>
                            {year}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                      <CalendarRange className="h-4 w-4" />
                      Trimestre / période
                    </label>

                    <select
                      name="period_ref"
                      required
                      className={`${selectBase} ${PeriodSelect({ focusColor: "sky" })}`}
                      defaultValue=""
                    >
                      <option value="" disabled>
                        {hasPeriods ? "Sélectionner une période" : "Aucune période disponible"}
                      </option>

                      {periods.map((period) => (
                        <option
                          key={`subject-summary-period-${period.id}`}
                          value={`period:${period.id}`}
                        >
                          {periodDisplayLabel(period)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                      <School className="h-4 w-4" />
                      Classe
                    </label>

                    <select
                      name="class_id"
                      className={`${selectBase} ${PeriodSelect({ focusColor: "sky" })}`}
                      defaultValue=""
                    >
                      <option value="">
                        {hasClasses ? "Toutes les classes" : "Aucune classe disponible"}
                      </option>

                      {classes.map((cls) => (
                        <option key={`subject-summary-class-${cls.id}`} value={cls.id}>
                          {classDisplayLabel(cls)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <button
                      type="submit"
                      name="format"
                      value="xlsx"
                      disabled={!hasAcademicYears || !hasPeriods}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-sky-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      <Download className="h-4 w-4" />
                      Excel
                    </button>

                    <button
                      type="submit"
                      name="format"
                      value="csv"
                      disabled={!hasAcademicYears || !hasPeriods}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <FileText className="h-4 w-4" />
                      CSV
                    </button>
                  </div>
                </form>
              </section>

              <section className="rounded-[28px] border border-violet-100 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-sm">
                    <Trophy className="h-5 w-5" />
                  </div>

                  <div>
                    <h3 className="text-lg font-black text-slate-950">
                      Synthèse DFA annuel
                    </h3>
                    <p className="mt-1 text-sm font-medium text-slate-600">
                      Préparation des admis, redoublants, exclus et non classés.
                    </p>
                  </div>
                </div>

                <form
                  action="/api/admin/exports/averages"
                  method="GET"
                  className="space-y-4"
                >
                  <input type="hidden" name="export_kind" value="desps_dfa_summary" />

                  <div>
                    <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                      <CalendarRange className="h-4 w-4" />
                      Année scolaire
                    </label>

                    <select
                      name="academic_year"
                      required
                      className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-500/15"
                      defaultValue={defaultAcademicYear}
                    >
                      {!hasAcademicYears ? (
                        <EmptyOption label="Aucune année disponible" />
                      ) : (
                        academicYears.map((year) => (
                          <option key={`dfa-summary-year-${year}`} value={year}>
                            {year}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-700">
                      <School className="h-4 w-4" />
                      Classe
                    </label>

                    <select
                      name="class_id"
                      className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-500/15"
                      defaultValue=""
                    >
                      <option value="">
                        {hasClasses ? "Toutes les classes" : "Aucune classe disponible"}
                      </option>

                      {classes.map((cls) => (
                        <option key={`dfa-summary-class-${cls.id}`} value={cls.id}>
                          {classDisplayLabel(cls)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <button
                      type="submit"
                      name="format"
                      value="xlsx"
                      disabled={!hasAcademicYears}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
                    >
                      <Download className="h-4 w-4" />
                      Excel
                    </button>

                    <button
                      type="submit"
                      name="format"
                      value="csv"
                      disabled={!hasAcademicYears}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <FileText className="h-4 w-4" />
                      CSV
                    </button>
                  </div>
                </form>
              </section>
            </div>
          </div>

          <div className="border-t border-slate-200 bg-white p-5 sm:p-6 lg:p-7">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-black text-slate-950">
                  Modules officiels restants
                </h2>
                <p className="mt-1 text-sm font-medium text-slate-500">
                  Ces blocs restent visibles pour organiser la suite du chantier.
                </p>
              </div>

              <span className="inline-flex w-fit items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-slate-600 ring-1 ring-slate-200">
                <LockKeyhole className="h-3.5 w-3.5" />
                En préparation
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200">
                  <Database className="h-5 w-5" />
                </div>
                <h3 className="text-base font-black text-slate-950">
                  Rapport F établissement
                </h3>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
                  Base élèves, moyennes trimestrielles, décisions de fin d’année
                  et états imprimables.
                </p>
                <div className="mt-4 inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
                  Après remplissage des modèles Excel
                </div>
              </div>

              <div className="rounded-[26px] border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200">
                  <School className="h-5 w-5" />
                </div>
                <h3 className="text-base font-black text-slate-950">
                  Recensement annuel
                </h3>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-600">
                  Identification établissement, DRENAET, infrastructures, TIC,
                  santé, effectifs et personnel.
                </p>
                <div className="mt-4 inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
                  Module dédié à créer
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}