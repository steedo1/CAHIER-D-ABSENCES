/** Shared rules for the official DESPS export and its registry diagnostic. */
export class DespsSourceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
    this.name = "DespsSourceError";
  }
}

export async function readDespsEnrollmentPages<T>(
  readPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  const maxRows = 20_000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await readPage(from, from + pageSize - 1);
    if (error) throw new DespsSourceError("DESPS_REGISTRY_UNAVAILABLE",
      "Impossible de lire toutes les inscriptions. Aucun fichier incomplet n'a été généré.");
    const page = data || [];
    if (rows.length + page.length > maxRows) throw new DespsSourceError("DESPS_REGISTRY_TOO_LARGE",
      "Sélection trop volumineuse : exporter les classes séparément.", 422);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function normalizeDespsMatricule(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/\s/g, "");
}

export function normalizeDespsGender(value: unknown): "F" | "M" | "" {
  const raw = String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (["f", "feminin", "feminine", "female", "fille", "filles"].includes(raw)) return "F";
  if (["m", "masculin", "masculine", "male", "garcon", "garcons", "homme"].includes(raw)) return "M";
  return "";
}

export type DespsPeriodSubjectValue = { value: number; coeff: number | null };

/** Same period weighting and missing-value policy as the bulletin/statistics engine. */
export function weightedDespsSubjectAverage(values: readonly DespsPeriodSubjectValue[]): number | null {
  let sum = 0, sumWeight = 0;
  for (const { value, coeff } of values) {
    if (!Number.isFinite(value)) continue;
    const weight = coeff == null ? 1 : Math.max(0, Number(coeff) || 0) || 1;
    sum += value * weight;
    sumWeight += weight;
  }
  return sumWeight > 0 ? Number((sum / sumWeight).toFixed(4)) : null;
}
