export type StatisticsGradePeriod = {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  coeff: number;
  class_ids: string[];
};
export type StatisticsAverage = { value: number | null; partial: boolean };
export type StatisticsTeachingTrack = "french" | "arabic";
type SpecializedProgram = {
  generalAverage: number | null;
  denominator: number;
  subjects: { id: string; name: string; average: number | null }[];
};
type SpecializedBulletinDocument = {
  studentId: string;
  document: Partial<Record<StatisticsTeachingTrack, SpecializedProgram>>;
  ready: boolean;
  programReadiness: Partial<Record<StatisticsTeachingTrack, boolean>>;
};
type SubjectCell = { subject_id: string; avg20?: number | null; is_nc?: boolean; is_assigned?: boolean; has_grade?: boolean };
type BulletinItem = {
  student_id: string;
  general_avg?: number | null;
  annual_avg?: number | null;
  admin_forced_nc?: boolean;
  admin_annual_forced_nc?: boolean;
  general_avg_status?: string;
  annual_avg_status?: string;
  coverage?: { is_complete?: boolean };
  annual_coverage?: { is_complete?: boolean };
  per_subject?: SubjectCell[];
};
export type StatisticsBulletin = {
  ok: boolean;
  class: { id: string; academic_year?: string };
  period: { from: string; to: string };
  subjects?: { subject_id: string; subject_name?: string }[];
  items: BulletinItem[];
  /** Specialized bulletins expose separate French/Arabic programmes, not legacy items. */
  specialized?: {
    engine: "specialized";
    documents: SpecializedBulletinDocument[];
  };
};
export type StatisticsBulletinCache = Map<string, { data: StatisticsBulletin; loadedAt: number }>;
export type StatisticsAcademicData = {
  periods: StatisticsGradePeriod[];
  bulletins: Map<string, StatisticsBulletin>;
  subjects: { id: string; label: string; track?: StatisticsTeachingTrack }[];
};
const CACHE_MS = 60_000;
const bulletinKey = (classId: string, periodId: string) => `${classId}|${periodId}`;

function numericAverage(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 20 ? n : null;
}
export function statisticsAverageBounds(minText: string, maxText: string) {
  function read(value: string) {
    if (!value.trim()) return null;
    return /^\d+(?:[.,]\d+)?$/.test(value.trim()) ? numericAverage(value.trim().replace(",", ".")) : NaN;
  }
  const min = read(minText), max = read(maxText);
  if ((minText.trim() && min === null) || (maxText.trim() && max === null) || Number.isNaN(min) || Number.isNaN(max)) {
    return { min: null, max: null, error: "Les moyennes doivent être comprises entre 0 et 20." };
  }
  if (min !== null && max !== null && min > max) {
    return { min, max, error: "La moyenne minimale ne peut pas dépasser la moyenne maximale." };
  }
  return { min, max, error: null };
}
export function statisticsAverageMatches(cell: StatisticsAverage, min: number | null, max: number | null) {
  if (min === null && max === null) return true;
  if (cell.value === null) return false;
  // Inclusive bounds match the two-decimal value displayed in the table/PDF.
  const value = Number(cell.value.toFixed(2));
  return (min === null || value >= min) && (max === null || value <= max);
}
export function formatStatisticsAverage(cell?: StatisticsAverage) {
  return cell?.value === null || cell?.value === undefined ? "—"
    : cell.value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cell.partial ? " *" : "");
}
function subjectAverage(item: BulletinItem | undefined, subjectId: string) {
  const cell = item?.per_subject?.find((row) => row.subject_id === subjectId);
  return !cell || cell.is_nc || cell.is_assigned === false || cell.has_grade === false ? null : numericAverage(cell.avg20);
}

export function statisticsStudentAverage(
  data: StatisticsAcademicData | null, classId: string | null, studentId: string,
  selection: string, subjectId: string, track?: StatisticsTeachingTrack,
): StatisticsAverage {
  const empty = { value: null, partial: false };
  if (!data || !classId || !selection) return empty;
  const periods = data.periods.filter((p) => p.class_ids.includes(classId) && (selection === "annual" || p.id === selection))
    .sort((a, b) => a.end_date.localeCompare(b.end_date) || a.start_date.localeCompare(b.start_date));
  if (!periods.length) return empty;
  const bulletinFor = (period: StatisticsGradePeriod) => data.bulletins.get(bulletinKey(classId, period.id));
  const itemFor = (period: StatisticsGradePeriod) => bulletinFor(period)?.items.find((item) => item.student_id === studentId);
  // Never use legacy general_avg for specialized schools. French and Arabic
  // have distinct denominators and are not mathematically interchangeable.
  if (periods.some((period) => bulletinFor(period)?.specialized?.engine === "specialized")) {
    if (!track) return empty; // Whole-school headcount is valid; a combined mean is not.
    const specializedAverage = (period: StatisticsGradePeriod) => {
      const response = bulletinFor(period);
      if (!response || response.specialized?.engine !== "specialized") return null;
      const row = response.specialized.documents.find((item) => item.studentId === studentId);
      if (!row || row.programReadiness?.[track] !== true) return null;
      const program = row.document[track];
      if (!program) return null;
      // The specialized grade scale is configurable (e.g. /10 or /20).
      // Statistics always compare normalized scores on /20, without mixing tracks.
      const raw = subjectId === "all"
        ? program.generalAverage
        : program.subjects.find((subject) => subject.id === subjectId)?.average;
      const scale = Number(program.denominator);
      const score = raw === null || raw === undefined ? NaN : Number(raw);
      if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(score) ||
          score < 0 || score > scale) return null;
      return Number((score * 20 / scale).toFixed(4));
    };
    if (selection !== "annual") {
      return { value: specializedAverage(periods[0]), partial: false };
    }
    // These are provisional weighted period means; no specialized official
    // council-approved annual result exists in this response.
    let sum = 0, weights = 0;
    for (const period of periods) {
      const value = specializedAverage(period);
      if (value === null) continue;
      const weight = Number.isFinite(period.coeff) && period.coeff > 0 ? period.coeff : 1;
      sum += value * weight;
      weights += weight;
    }
    return weights ? { value: Number((sum / weights).toFixed(4)), partial: true } : empty;
  }
  if (selection !== "annual") {
    const item = itemFor(periods[0]);
    if (subjectId !== "all") return { value: subjectAverage(item, subjectId), partial: false };
    return !item || item.admin_forced_nc || item.general_avg_status === "admin_nc" ? empty
      : { value: numericAverage(item.general_avg), partial: item.coverage?.is_complete === false };
  }
  if (subjectId === "all") {
    const item = itemFor(periods[periods.length - 1]);
    if (item?.admin_annual_forced_nc || item?.annual_avg_status === "admin_nc") return empty;
    const official = numericAverage(item?.annual_avg);
    if (official !== null) return { value: official, partial: item?.annual_coverage?.is_complete === false };
    // Before the final bulletin exists, expose a clearly provisional yearly
    // value from the available official quarterly means, using the same weights.
    let sum = 0, weights = 0;
    for (const period of periods) {
      const term = itemFor(period);
      if (term?.admin_forced_nc || term?.general_avg_status === "admin_nc") continue;
      const value = numericAverage(term?.general_avg);
      if (value === null) continue;
      const weight = Number.isFinite(period.coeff) && period.coeff > 0 ? period.coeff : 1;
      sum += value * weight; weights += weight;
    }
    return weights > 0 ? { value: Number((sum / weights).toFixed(4)), partial: true } : empty;
  }
  let sum = 0, weights = 0, covered = 0;
  for (const period of periods) {
    const value = subjectAverage(itemFor(period), subjectId);
    if (value === null) continue;
    const weight = Number.isFinite(period.coeff) && period.coeff > 0 ? period.coeff : 1;
    sum += value * weight; weights += weight; covered++;
  }
  return weights > 0 ? { value: Number((sum / weights).toFixed(4)), partial: covered < periods.length } : empty;
}

async function readBulletin(url: string, signal: AbortSignal, fetcher: typeof fetch) {
  const controller = new AbortController();
  let rejectAborted: (cause: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAborted = reject; });
  const abort = () => { controller.abort(signal.reason); rejectAborted(signal.reason || new DOMException("aborted", "AbortError")); };
  signal.addEventListener("abort", abort, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    signal.throwIfAborted();
    return await Promise.race([
      (async () => {
        const response = await fetcher(url, { cache: "no-store", credentials: "include", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || data?.ok !== true) throw new Error("Le chargement des moyennes a échoué. Réessayez.");
        return data as StatisticsBulletin;
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Le calcul des moyennes prend trop de temps. Réessayez ou sélectionnez une classe."));
          controller.abort();
        }, 30_000);
      }),
      aborted,
    ]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export async function loadStatisticsAcademicData(input: {
  classIds: string[]; selection: string; periods: StatisticsGradePeriod[]; academicYear: string;
  cache: StatisticsBulletinCache; signal: AbortSignal; fetcher?: typeof fetch;
  onProgress?: (done: number, total: number) => void;
}): Promise<StatisticsAcademicData> {
  const { cache, academicYear } = input;
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal.reason);
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.signal.aborted) abort();
  const signal = controller.signal;
  const jobs = input.classIds.flatMap((classId) => input.periods
    .filter((p) => p.class_ids.includes(classId) && (input.selection === "annual" || p.id === input.selection))
    .map((period) => ({ classId, period })));
  const bulletins = new Map<string, StatisticsBulletin>();
  let next = 0, done = 0;
  async function worker() {
    while (next < jobs.length) {
      signal.throwIfAborted();
      const { classId, period } = jobs[next++];
      const key = `${academicYear}|${bulletinKey(classId, period.id)}|${period.start_date}|${period.end_date}`;
      const cached = cache.get(key);
      let data = cached && Date.now() - cached.loadedAt < CACHE_MS ? cached.data : null;
      if (!data) {
        const params = new URLSearchParams({ class_id: classId, academic_year: academicYear,
          from: period.start_date, to: period.end_date, export_light: "1" });
        data = await readBulletin(`/api/admin/grades/bulletin?${params}`, signal, input.fetcher || fetch);
        signal.throwIfAborted();
        if (data.class?.id !== classId || data.class.academic_year !== academicYear ||
          data.period?.from !== period.start_date || data.period?.to !== period.end_date || !Array.isArray(data.items)) {
          throw new Error("Les moyennes reçues ne correspondent pas à la classe et à la période demandées.");
        }
        cache.set(key, { data, loadedAt: Date.now() });
      }
      bulletins.set(bulletinKey(classId, period.id), data);
      input.onProgress?.(++done, jobs.length);
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(2, jobs.length) }, worker));
    signal.throwIfAborted();
    const subjects = new Map<string, { id: string; label: string; track?: StatisticsTeachingTrack }>();
    for (const data of bulletins.values()) {
      if (data.specialized?.engine === "specialized") {
        for (const row of data.specialized.documents) {
          for (const track of ["french", "arabic"] as const) {
            for (const subject of row.document[track]?.subjects || []) {
              if (subject.id) subjects.set(`${track}|${subject.id}`, {
                id: subject.id, label: subject.name || "Discipline", track,
              });
            }
          }
        }
      } else for (const subject of data.subjects || []) {
        if (subject.subject_id) subjects.set(subject.subject_id, {
          id: subject.subject_id, label: subject.subject_name || "Discipline",
        });
      }
    }
    return { periods: input.periods, bulletins, subjects: Array.from(subjects.values())
      .sort((a, b) => a.label.localeCompare(b.label, "fr")) };
  } catch (cause) {
    controller.abort();
    throw cause;
  } finally {
    input.signal.removeEventListener("abort", abort);
  }
}
