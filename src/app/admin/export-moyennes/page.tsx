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
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl">
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
          <div className="border-b border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 px-5 py-6 text-white sm:px-6">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-100 ring-1 ring-white/15">
              <FileSpreadsheet className="h-4 w-4" />
              Exports officiels
            </div>

            <h1 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
              Export DESPS
            </h1>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-200">
              Générez les fichiers officiels au format DESPS : notes par matière et
              récapitulatif annuel. Les exports utilisent les notes publiées afin de
              rester cohérents avec les bulletins officiels.
            </p>
          </div>

          <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-2">
            <section className="rounded-[28px] border border-emerald-100 bg-emerald-50/60 p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-sm">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">
                    Notes par matière
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Produit un fichier de notes avec une ligne par élève et les matières
                    DESPS en colonnes. Au second cycle, le Français reste une seule
                    colonne.
                  </p>
                </div>
              </div>

              <form
                action="/api/admin/exports/averages"
                method="GET"
                className="space-y-4 rounded-2xl border border-emerald-100 bg-white p-4"
              >
                <input type="hidden" name="export_kind" value="dsps_notes" />

                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <CalendarRange className="h-4 w-4" />
                    Année scolaire
                  </label>
                  <select
                    name="academic_year"
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
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
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <CalendarRange className="h-4 w-4" />
                    Trimestre / période
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
                      <option key={`notes-class-${cls.id}`} value={cls.id}>
                        {classDisplayLabel(cls)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                  <strong>Règle intégrée :</strong> 6e, 5e, 4e, 3e utilisent
                  Composition Française / Orthographe / Oral Français. Seconde,
                  Première et Terminale utilisent Français.
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="submit"
                    name="format"
                    value="xlsx"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                  >
                    <Download className="h-4 w-4" />
                    Excel DESPS notes
                  </button>

                  <button
                    type="submit"
                    name="format"
                    value="csv"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100"
                  >
                    <FileText className="h-4 w-4" />
                    CSV DESPS notes
                  </button>
                </div>
              </form>
            </section>

            <section className="rounded-[28px] border border-indigo-100 bg-indigo-50/60 p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
                  <Layers3 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">
                    Récapitulatif annuel
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Produit le tableau annuel DESPS avec les moyennes et rangs des trois
                    trimestres, la MGA, le rang annuel et la décision du conseil.
                  </p>
                </div>
              </div>

              <form
                action="/api/admin/exports/averages"
                method="GET"
                className="space-y-4 rounded-2xl border border-indigo-100 bg-white p-4"
              >
                <input type="hidden" name="export_kind" value="dsps_annual" />

                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <CalendarRange className="h-4 w-4" />
                    Année scolaire
                  </label>
                  <select
                    name="academic_year"
                    required
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15"
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
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <School className="h-4 w-4" />
                    Classe
                  </label>
                  <select
                    name="class_id"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15"
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

                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                  Le récapitulatif annuel reprend les périodes configurées dans les
                  paramètres de l’établissement et se base sur les moyennes publiées.
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="submit"
                    name="format"
                    value="xlsx"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
                  >
                    <Download className="h-4 w-4" />
                    Excel récapitulatif
                  </button>

                  <button
                    type="submit"
                    name="format"
                    value="csv"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100"
                  >
                    <FileText className="h-4 w-4" />
                    CSV récapitulatif
                  </button>
                </div>
              </form>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
