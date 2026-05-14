// src/app/admin/finance/_shared/academic-year.tsx
import { CalendarClock } from "lucide-react";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export type FinanceAcademicYearRow = {
  id: string;
  code: string;
  label: string | null;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean | null;
};

export type FinanceAcademicYearContext = {
  academicYears: FinanceAcademicYearRow[];
  selectedAcademicYear: FinanceAcademicYearRow | null;
  selectedAcademicYearId: string | null;
  selectedAcademicYearCode: string;
  selectedAcademicYearLabel: string;
  selectedAcademicYearStart: string | null;
  selectedAcademicYearEnd: string | null;
};

function normalize(value: string | null | undefined) {
  return String(value || "").trim();
}

export function academicYearLabel(
  row: FinanceAcademicYearRow | null | undefined,
) {
  if (!row) return "Toutes les années";
  const label = normalize(row.label) || `Année scolaire ${row.code}`;
  return row.is_current ? `${label} — courante` : label;
}

export async function getFinanceAcademicYearContext(
  institutionId: string,
  requestedAcademicYear?: string | null,
): Promise<FinanceAcademicYearContext> {
  const supabase = await getSupabaseServerClient();

  const { data, error } = await supabase
    .from("academic_years")
    .select("id,code,label,start_date,end_date,is_current")
    .eq("institution_id", institutionId)
    .order("start_date", { ascending: false });

  if (error) throw new Error(error.message);

  const academicYears = ((data ?? []) as FinanceAcademicYearRow[])
    .map((row) => ({
      ...row,
      code: normalize(row.code),
      label: normalize(row.label) || null,
      start_date: normalize(row.start_date) || null,
      end_date: normalize(row.end_date) || null,
      is_current: row.is_current === true,
    }))
    .filter((row) => row.code);

  const requested = normalize(requestedAcademicYear);
  const selectedAcademicYear =
    academicYears.find(
      (row) =>
        row.code === requested ||
        row.id === requested ||
        normalize(row.label) === requested,
    ) ||
    academicYears.find((row) => row.is_current) ||
    academicYears[0] ||
    null;

  return {
    academicYears,
    selectedAcademicYear,
    selectedAcademicYearId: selectedAcademicYear?.id || null,
    selectedAcademicYearCode: selectedAcademicYear?.code || "",
    selectedAcademicYearLabel: academicYearLabel(selectedAcademicYear),
    selectedAcademicYearStart: selectedAcademicYear?.start_date || null,
    selectedAcademicYearEnd: selectedAcademicYear?.end_date || null,
  };
}

export function financeYearHref(path: string, academicYearCode: string) {
  if (!academicYearCode) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}academic_year=${encodeURIComponent(academicYearCode)}`;
}

export function classIdsForAcademicYear<
  T extends { id: string; academic_year?: string | null },
>(classes: T[], academicYearCode: string) {
  if (!academicYearCode) return classes.map((row) => row.id);
  return classes
    .filter((row) => normalize(row.academic_year) === academicYearCode)
    .map((row) => row.id);
}

export function filterStudentsByClassIds<
  T extends { class_id?: string | null },
>(students: T[], classIds: string[]) {
  if (classIds.length === 0) return [];
  const allowed = new Set(classIds);
  return students.filter(
    (row) => row.class_id && allowed.has(String(row.class_id)),
  );
}

export function buildNoRowsForEmptyClassScope<T>(
  classIds: string[],
  rows: T[],
) {
  return classIds.length === 0 ? [] : rows;
}

export function AcademicYearSelector({
  academicYears,
  selectedAcademicYearCode,
  currentPath,
  hiddenParams,
}: {
  academicYears: FinanceAcademicYearRow[];
  selectedAcademicYearCode: string;
  currentPath: string;
  hiddenParams?: Record<string, string | number | null | undefined>;
}) {
  if (academicYears.length === 0) return null;

  const safeHiddenParams = Object.entries(hiddenParams || {}).filter(
    ([key, value]) =>
      key !== "academic_year" &&
      value !== undefined &&
      value !== null &&
      String(value) !== "",
  );

  return (
    <section className="rounded-[28px] border border-emerald-100 bg-emerald-50/60 p-4 shadow-sm">
      <form
        method="GET"
        action={currentPath}
        className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"
      >
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-black uppercase tracking-[0.16em] text-emerald-800">
              Année scolaire consultée
            </div>
            <div className="mt-1 text-sm leading-6 text-emerald-900/80">
              Les classes, dettes, paiements, reçus, rapports et paies affichés
              sont filtrés sur cette année.
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {safeHiddenParams.map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={String(value)} />
          ))}
          <select
            name="academic_year"
            defaultValue={selectedAcademicYearCode}
            className="min-w-[240px] rounded-2xl border border-emerald-200 bg-white px-3 py-3 text-sm font-bold text-slate-800 outline-none"
          >
            {academicYears.map((row) => (
              <option key={row.id || row.code} value={row.code}>
                {academicYearLabel(row)}
              </option>
            ))}
          </select>
          <button className="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-emerald-700">
            Afficher
          </button>
        </div>
      </form>
    </section>
  );
}
