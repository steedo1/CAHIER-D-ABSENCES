// src/app/admin/export-moyennes/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ChevronLeft,
  Download,
  FileSpreadsheet,
  GraduationCap,
  Layers3,
  ShieldCheck,
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

function periodTextForMatch(period: GradePeriodRow) {
  return [period.code, period.label, period.short_label]
    .map((value) => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    .join(" ");
}

function periodMatchesTerm(period: GradePeriodRow, term: 1 | 2 | 3) {
  const raw = periodTextForMatch(period);

  if (term === 1) {
    return /(^|\s)(t1|trim1|trim\s*1|trimestre1|trimestre\s*1|1er|1ere|premier|premiere)(\s|$)/.test(raw);
  }

  if (term === 2) {
    return /(^|\s)(t2|trim2|trim\s*2|trimestre2|trimestre\s*2|2e|2eme|deuxieme)(\s|$)/.test(raw);
  }

  return /(^|\s)(t3|trim3|trim\s*3|trimestre3|trimestre\s*3|3e|3eme|troisieme)(\s|$)/.test(raw);
}

function resolveFixedTermPeriod(periods: GradePeriodRow[], term: 1 | 2 | 3) {
  return periods.find((period) => periodMatchesTerm(period, term)) || null;
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

  if (!user) redirect("/login");

  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("institution_id, role")
    .eq("profile_id", user.id)
    .in("role", ["admin", "super_admin"])
    .limit(1)
    .maybeSingle();

  if (!roleRow?.institution_id) redirect("/admin/dashboard");

  return {
    supabase,
    role: roleRow.role as Role,
    institutionId: String(roleRow.institution_id),
  };
}

function EmptyOption({ label }: { label: string }) {
  return <option value="">{label}</option>;
}

function TermExportCard({
  title,
  term,
  period,
  classes,
  academicYears,
  defaultAcademicYear,
  hasAcademicYears,
  hasClasses,
}: {
  title: string;
  term: 1 | 2 | 3;
  period: GradePeriodRow | null;
  classes: ClassRow[];
  academicYears: string[];
  defaultAcademicYear: string;
  hasAcademicYears: boolean;
  hasClasses: boolean;
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-400">
            Fichier de recueil de moyennes établissement
          </p>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
          <FileSpreadsheet className="h-5 w-5" />
        </div>
      </div>

      <form action="/api/admin/exports/averages" method="GET" className="grid gap-3">
        <input type="hidden" name="export_kind" value="desps_official_term" />
        <input type="hidden" name="term" value={term} />
        <input type="hidden" name="period_ref" value={period ? `period:${period.id}` : ""} />
        <input type="hidden" name="format" value="xlsx" />

        <select
          name="academic_year"
          required
          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
          defaultValue={defaultAcademicYear}
        >
          {!hasAcademicYears ? (
            <EmptyOption label="Aucune année disponible" />
          ) : (
            academicYears.map((year) => (
              <option key={`${term}-year-${year}`} value={year}>
                {year}
              </option>
            ))
          )}
        </select>

        <select
          name="class_id"
          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
          defaultValue=""
        >
          <option value="">{hasClasses ? "Toutes les classes" : "Aucune classe disponible"}</option>
          {classes.map((cls) => (
            <option key={`${term}-class-${cls.id}`} value={cls.id}>
              {classDisplayLabel(cls)}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={!hasAcademicYears || !period}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
        >
          <Download className="h-4 w-4" />
          Télécharger Excel officiel
        </button>
      </form>
    </section>
  );
}

function AnnualExportCard({
  classes,
  academicYears,
  defaultAcademicYear,
  hasAcademicYears,
  hasClasses,
}: {
  classes: ClassRow[];
  academicYears: string[];
  defaultAcademicYear: string;
  hasAcademicYears: boolean;
  hasClasses: boolean;
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950">Résultats annuels / DFA</h2>
          <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-400">
            Établissement résultats annuels DFA
          </p>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-50 text-violet-700 ring-1 ring-violet-100">
          <GraduationCap className="h-5 w-5" />
        </div>
      </div>

      <form action="/api/admin/exports/averages" method="GET" className="grid gap-3">
        <input type="hidden" name="export_kind" value="desps_official_annual" />
        <input type="hidden" name="format" value="xlsx" />

        <select
          name="academic_year"
          required
          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-500/15"
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

        <select
          name="class_id"
          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-500/15"
          defaultValue=""
        >
          <option value="">{hasClasses ? "Toutes les classes" : "Aucune classe disponible"}</option>
          {classes.map((cls) => (
            <option key={`annual-class-${cls.id}`} value={cls.id}>
              {classDisplayLabel(cls)}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={!hasAcademicYears}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
        >
          <Download className="h-4 w-4" />
          Télécharger Excel officiel
        </button>
      </form>
    </section>
  );
}

function RapportFCard({
  classes,
  academicYears,
  defaultAcademicYear,
  hasAcademicYears,
  hasClasses,
}: {
  classes: ClassRow[];
  academicYears: string[];
  defaultAcademicYear: string;
  hasAcademicYears: boolean;
  hasClasses: boolean;
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950">Rapport F</h2>
          <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-400">
            Rapport établissement secondaire public
          </p>
        </div>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-amber-100">
          <Layers3 className="h-5 w-5" />
        </div>
      </div>

      <form action="/api/admin/exports/averages" method="GET" className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <input type="hidden" name="export_kind" value="rapport_f_official" />
        <input type="hidden" name="format" value="xlsx" />

        <select
          name="academic_year"
          required
          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
          defaultValue={defaultAcademicYear}
        >
          {!hasAcademicYears ? (
            <EmptyOption label="Aucune année disponible" />
          ) : (
            academicYears.map((year) => (
              <option key={`rapport-year-${year}`} value={year}>
                {year}
              </option>
            ))
          )}
        </select>

        <select
          name="class_id"
          className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-500/15"
          defaultValue=""
        >
          <option value="">{hasClasses ? "Toutes les classes" : "Aucune classe disponible"}</option>
          {classes.map((cls) => (
            <option key={`rapport-class-${cls.id}`} value={cls.id}>
              {classDisplayLabel(cls)}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={!hasAcademicYears}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
        >
          <Download className="h-4 w-4" />
          Télécharger Excel officiel
        </button>
      </form>
    </section>
  );
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
  const hasClasses = classes.length > 0;

  const firstTermPeriod = resolveFixedTermPeriod(periods, 1);
  const secondTermPeriod = resolveFixedTermPeriod(periods, 2);
  const thirdTermPeriod = resolveFixedTermPeriod(periods, 3);

  const cardProps = {
    classes,
    academicYears,
    defaultAcademicYear,
    hasAcademicYears,
    hasClasses,
  };

  const annualProps = {
    classes,
    academicYears,
    defaultAcademicYear,
    hasAcademicYears,
    hasClasses,
  };

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
          <header className="relative overflow-hidden bg-slate-950">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.35),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(124,58,237,0.3),transparent_35%)]" />
            <div className="relative px-5 py-7 text-white sm:px-7 lg:px-8">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.2em] text-emerald-100 ring-1 ring-white/15">
                    <ShieldCheck className="h-4 w-4" />
                    Export DESPS
                  </div>
                  <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
                    Modèles officiels
                  </h1>
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

          <div className="grid gap-4 p-5 sm:p-6 lg:grid-cols-2 lg:p-7">
            <TermExportCard title="1er trimestre" term={1} period={firstTermPeriod} {...cardProps} />
            <TermExportCard title="2e trimestre" term={2} period={secondTermPeriod} {...cardProps} />
            <TermExportCard title="3e trimestre" term={3} period={thirdTermPeriod} {...cardProps} />
            <AnnualExportCard {...annualProps} />
            <RapportFCard {...annualProps} />
          </div>
        </section>
      </div>
    </main>
  );
}