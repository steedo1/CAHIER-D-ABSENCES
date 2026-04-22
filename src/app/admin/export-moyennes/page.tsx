import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Download,
  FileSpreadsheet,
  FileText,
  ChevronLeft,
  GraduationCap,
  CalendarRange,
  School,
  Settings2,
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
  coeff?: number | null;
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
  const coeff =
    typeof period.coeff === "number" && Number.isFinite(period.coeff)
      ? ` • Coef ${period.coeff}`
      : "";

  return `${year ? `[${year}] ` : ""}${title} — ${formatDateFR(
    period.start_date
  )} → ${formatDateFR(period.end_date)}${coeff}`;
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

  const [{ data: classesData }, { data: periodsData }, { data: institutionData }] =
    await Promise.all([
      supabase
        .from("classes")
        .select("id, label, code, level, academic_year")
        .eq("institution_id", institutionId)
        .order("level", { ascending: true })
        .order("label", { ascending: true }),
      supabase
        .from("grade_periods")
        .select("id, academic_year, code, label, short_label, start_date, end_date, coeff")
        .eq("institution_id", institutionId)
        .order("start_date", { ascending: false }),
      supabase
        .from("institutions")
        .select("name")
        .eq("id", institutionId)
        .maybeSingle(),
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
      <div className="mx-auto max-w-6xl">
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
          <div className="border-b border-slate-200 bg-gradient-to-r from-emerald-600 to-emerald-500 px-6 py-6 text-white">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">
                  <FileSpreadsheet className="h-4 w-4" />
                  Export
                </div>
                <h1 className="mt-3 text-2xl font-extrabold sm:text-3xl">
                  Export moyennes
                </h1>
                <p className="mt-2 max-w-3xl text-sm text-emerald-50/90">
                  Générez un fichier prêt à transférer vers Ecole Media ou toute autre
                  plateforme, au format Excel ou CSV.
                </p>
              </div>

              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm">
                <div className="font-semibold">
                  {String((institutionData as any)?.name || "Établissement")}
                </div>
                <div className="mt-1 text-emerald-50/85">
                  Module d’export des moyennes administratives
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 p-6 lg:grid-cols-[1.25fr_0.75fr]">
            <section className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                    <Settings2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Préparer l’export
                    </h2>
                    <p className="text-sm text-slate-500">
                      Sélectionne les filtres puis choisis le format de sortie.
                    </p>
                  </div>
                </div>

                <form
                  action="/api/admin/exports/averages"
                  method="GET"
                  className="space-y-5"
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
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
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
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
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
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
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

                    <div>
                      <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <GraduationCap className="h-4 w-4" />
                        Modèle d’export
                      </label>
                      <select
                        name="export_model"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none ring-0 transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
                        defaultValue="standard"
                      >
                        <option value="standard">Standard</option>
                        <option value="generic">Ecole Media / Générique</option>
                      </select>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Pour la V1, l’export contiendra les colonnes principales :
                    matricule, nom, prénoms, classe, année scolaire, période,
                    moyenne générale, rang, moyenne annuelle, rang annuel et conduite.
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      type="submit"
                      name="format"
                      value="xlsx"
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                    >
                      <Download className="h-4 w-4" />
                      Exporter en Excel (.xlsx)
                    </button>

                    <button
                      type="submit"
                      name="format"
                      value="csv"
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-100"
                    >
                      <FileText className="h-4 w-4" />
                      Exporter en CSV (.csv)
                    </button>
                  </div>
                </form>
              </div>
            </section>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-800">
                  Modèles disponibles
                </h3>

                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="font-semibold text-slate-900">Standard</div>
                    <p className="mt-1 text-sm text-slate-600">
                      Idéal pour l’archivage, les contrôles internes et les traitements Excel.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="font-semibold text-slate-900">
                      Ecole Media / Générique
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      Colonnes simplifiées et prêtes pour un import vers une autre plateforme.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-800">
                  Recommandation
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Utilise <span className="font-semibold text-slate-900">Excel (.xlsx)</span>{" "}
                  par défaut. Le format CSV reste utile pour certains imports externes,
                  mais le XLSX est plus propre pour les secrétariats.
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                <h3 className="text-sm font-bold uppercase tracking-wide text-emerald-900">
                  Suite prévue
                </h3>
                <p className="mt-3 text-sm leading-6 text-emerald-900/80">
                  Après cette page, on branche l’API d’export pour générer les fichiers
                  réels en XLSX et CSV sans toucher aux bulletins existants.
                </p>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}