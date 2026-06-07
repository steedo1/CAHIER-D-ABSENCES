export type ClassTeacherFetchResult = {
  rows: any[];
  academicYear: string | null;
  usedInactiveFallback: boolean;
  warnings: string[];
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function firstRelation(value: any) {
  return Array.isArray(value) ? value[0] : value;
}

function rowClass(row: any) {
  return firstRelation(row?.class);
}

function rowClassAcademicYear(row: any): string {
  return clean(rowClass(row)?.academic_year);
}

function hasUsableAcademicYear(rows: any[]) {
  return rows.some((row) => Boolean(rowClassAcademicYear(row)));
}

export async function getCurrentAcademicYearCode(
  srv: any,
  institutionId: string,
): Promise<string | null> {
  const { data: current, error: currentError } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (currentError) {
    return null;
  }

  if (current?.code) return String(current.code);

  const { data: latest } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return latest?.code ? String(latest.code) : null;
}

export function filterRowsByClassAcademicYear<T extends any[]>(
  rows: T,
  academicYear: string | null,
): T {
  if (!academicYear || !Array.isArray(rows) || rows.length === 0) return rows;
  if (!hasUsableAcademicYear(rows)) return rows;

  const matching = rows.filter((row) => rowClassAcademicYear(row) === academicYear);
  return (matching.length > 0 ? matching : rows) as T;
}

export function filterClassRowsByAcademicYear<T extends any[]>(
  rows: T,
  academicYear: string | null,
): T {
  if (!academicYear || !Array.isArray(rows) || rows.length === 0) return rows;

  const hasYearColumn = rows.some((row) => Boolean(clean(row?.academic_year)));
  if (!hasYearColumn) return rows;

  const matching = rows.filter((row) => clean(row?.academic_year) === academicYear);
  return (matching.length > 0 ? matching : rows) as T;
}

export async function fetchClassTeacherRows(
  srv: any,
  institutionId: string,
  selectQuery: string,
): Promise<ClassTeacherFetchResult> {
  const academicYear = await getCurrentAcademicYearCode(srv, institutionId);
  const warnings: string[] = [];

  const active = await srv
    .from("class_teachers")
    .select(selectQuery)
    .eq("institution_id", institutionId)
    .is("end_date", null)
    .limit(10000);

  if (active.error) {
    throw new Error(active.error.message);
  }

  const activeRows = filterRowsByClassAcademicYear(active.data || [], academicYear);
  if (activeRows.length > 0) {
    return { rows: activeRows, academicYear, usedInactiveFallback: false, warnings };
  }

  const fallback = await srv
    .from("class_teachers")
    .select(selectQuery)
    .eq("institution_id", institutionId)
    .limit(10000);

  if (fallback.error) {
    throw new Error(fallback.error.message);
  }

  const fallbackRows = filterRowsByClassAcademicYear(fallback.data || [], academicYear);

  if (fallbackRows.length > 0) {
    warnings.push(
      "Aucune affectation active avec end_date vide n’a été trouvée : lecture de secours des affectations Mon Cahier existantes pour éviter un écran vide.",
    );
  }

  return { rows: fallbackRows, academicYear, usedInactiveFallback: true, warnings };
}
