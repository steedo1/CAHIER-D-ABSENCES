import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Download,
  FileSpreadsheet,
  FileText,
  ChevronLeft,
  CalendarRange,
  School,
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
  if (Number.isNaN(d.getTime())) return String(iso);
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

export default async function ExportMoyennesPage() {
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

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4">
          <Link
            href="/admin/dashboard"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100"
          >
            <ChevronLeft className="h-4 w-4" />
            Retour au tableau de bord
          </Link>
        </div>

        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-5 sm:px-6">
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
              <FileSpreadsheet className="h-4 w-4" />
              Export
            </div>

            <h1 className="mt-3 text-2xl font-extrabold text-slate-900">
              Export moyennes
            </h1>

            <p className="mt-1 text-sm text-slate-500">
              Choisissez les filtres puis exportez.
            </p>
          </div>

          <div className="p-5 sm:p-6">
            <form
              action="/api/admin/exports/averages"
              method="GET"
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <CalendarRange className="h-4 w-4" />
                    Année scolaire
                  </label>
                  <select
                    name="academic_year"
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
                    defaultValue={academicYears[0] ?? ""}
                  >
                    {academicYears.length === 0 ? (
                      <option value="">Aucune année disponible</option>
                    ) : (
                      academicYears.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <CalendarRange className="h-4 w-4" />
                    Période
                  </label>
                  <select
                    name="period_ref"
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Sélectionner une période
                    </option>

                    {academicYears.map((year) => (
                      <option key={`annual-${year}`} value={`annual:${year}`}>
                        [{year}] Annuel
                      </option>
                    ))}

                    {periods.map((period) => (
                      <option key={period.id} value={`period:${period.id}`}>
                        {periodDisplayLabel(period)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <School className="h-4 w-4" />
                    Classe
                  </label>
                  <select
                    name="class_id"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
                    defaultValue=""
                  >
                    <option value="">Toutes les classes</option>
                    {classes.map((cls) => (
                      <option key={cls.id} value={cls.id}>
                        {classDisplayLabel(cls)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-end">
                  <label className="flex w-full items-center gap-3 rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      name="include_subjects"
                      value="1"
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    Inclure les moyennes par matière
                  </label>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <button
                  type="submit"
                  name="format"
                  value="xlsx"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                >
                  <Download className="h-4 w-4" />
                  Exporter Excel (.xlsx)
                </button>

                <button
                  type="submit"
                  name="format"
                  value="csv"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100"
                >
                  <FileText className="h-4 w-4" />
                  Exporter CSV (.csv)
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}