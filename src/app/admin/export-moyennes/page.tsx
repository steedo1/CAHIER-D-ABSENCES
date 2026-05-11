// src/app/admin/export-moyennes/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Download,
  FileSpreadsheet,
  FileText,
  ChevronLeft,
  CalendarRange,
  School,
  ClipboardList,
  Layers3,
  CheckCircle2,
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

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
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
              <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-3xl">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.2em] text-emerald-100 ring-1 ring-white/15">
                    <ShieldCheck className="h-4 w-4" />
                    Exports officiels DESPS
                  </div>

                  <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
                    Export des moyennes et récapitulatifs
                  </h1>

                  <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-200 sm:text-base">
                    Préparez les fichiers Excel ou CSV à partir des moyennes publiées,
                    par période ou sur l’ensemble de l’année scolaire.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3 rounded-3xl bg-white/10 p-3 ring-1 ring-white/15 backdrop-blur">
                  <div className="rounded-2xl bg-white/10 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                      Années
                    </p>
                    <p className="mt-1 text-2xl font-black text-white">
                      {academicYears.length}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white/10 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                      Classes
                    </p>
                    <p className="mt-1 text-2xl font-black text-white">
                      {classes.length}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white/10 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                      Périodes
                    </p>
                    <p className="mt-1 text-2xl font-black text-white">
                      {periods.length}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-2 lg:p-7">
            <section className="rounded-[28px] border border-emerald-100 bg-emerald-50/70 p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
                  <ClipboardList className="h-5 w-5" />
                </div>

                <div>
                  <h2 className="text-lg font-black text-slate-950">
                    Moyennes par matière
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Exportez les notes et moyennes d’une période pour une classe ou
                    pour toutes les classes.
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
                    className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
                    defaultValue={defaultAcademicYear}
                  >
                    {academicYears.length === 0 ? (
                      <option value="">Aucune année disponible</option>
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
                    className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Sélectionner une période
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
                    className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
                    defaultValue=""
                  >
                    <option value="">Toutes les classes</option>

                    {classes.map((cls) => (
                      <option key={`notes-class-${cls.id}`} value={cls.id}>
                        {classDisplayLabel(cls)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-start gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-xs leading-5 text-emerald-900">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    Les données exportées utilisent les moyennes officiellement publiées
                    afin de conserver une cohérence avec les bulletins et les états
                    administratifs.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="submit"
                    name="format"
                    value="xlsx"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
                  >
                    <Download className="h-4 w-4" />
                    Excel DESPS notes
                  </button>

                  <button
                    type="submit"
                    name="format"
                    value="csv"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-100"
                  >
                    <FileText className="h-4 w-4" />
                    CSV DESPS notes
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
                    Récapitulatif annuel
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Générez le récapitulatif de l’année scolaire à partir des périodes
                    configurées dans l’établissement.
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
                    className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15"
                    defaultValue={defaultAcademicYear}
                  >
                    {academicYears.length === 0 ? (
                      <option value="">Aucune année disponible</option>
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
                    className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15"
                    defaultValue=""
                  >
                    <option value="">Toutes les classes</option>

                    {classes.map((cls) => (
                      <option key={`annual-class-${cls.id}`} value={cls.id}>
                        {classDisplayLabel(cls)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-start gap-2 rounded-2xl border border-indigo-100 bg-indigo-50 px-3 py-3 text-xs leading-5 text-indigo-900">
                  <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    Le fichier annuel consolide les résultats des périodes disponibles
                    pour l’année sélectionnée, avec une sortie adaptée au suivi
                    administratif.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="submit"
                    name="format"
                    value="xlsx"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-indigo-700"
                  >
                    <Download className="h-4 w-4" />
                    Excel récapitulatif
                  </button>

                  <button
                    type="submit"
                    name="format"
                    value="csv"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-100"
                  >
                    <FileText className="h-4 w-4" />
                    CSV récapitulatif
                  </button>
                </div>
              </form>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}