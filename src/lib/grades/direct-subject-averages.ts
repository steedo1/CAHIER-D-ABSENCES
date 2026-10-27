/** Absolute period averages, kept apart from the numeric pedagogical bonus.
 * The existing adjustment has an annual unique key. Its reason carries all
 * periods so entering T2 cannot overwrite T1. No schema change is required.
 */
export const DIRECT_AVERAGES_PREFIX = "MC_DIRECT_SUBJECT_AVERAGES_V1:";
type AuditValue = { average: number; actor: string; at: string };
type Entry = { average?: number; actor?: string; at?: string; components?: Record<string, AuditValue> };
type Source = { periods: Record<string, Entry>; previousReason: string | null; createdForDirect?: boolean };

export function parseAverage20(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value).trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return null;
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 20 ? n : null;
}

export function readDirectAverages(reason: unknown): Source {
  if (typeof reason !== "string" || !reason.startsWith(DIRECT_AVERAGES_PREFIX))
    return { periods: {}, previousReason: typeof reason === "string" ? reason : null };
  const source = JSON.parse(reason.slice(DIRECT_AVERAGES_PREFIX.length));
  if (!source?.periods || typeof source.periods !== "object" || Array.isArray(source.periods))
    throw new Error("Moyennes enregistrées illisibles. Aucune donnée n’a été remplacée.");
  for (const entry of Object.values(source.periods) as Entry[]) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        (entry.average !== undefined && parseAverage20(entry.average) === null))
      throw new Error("Moyenne enregistrée invalide. Aucune donnée n’a été remplacée.");
    if (entry.components !== undefined) {
      if (!entry.components || typeof entry.components !== "object" || Array.isArray(entry.components))
        throw new Error("Sous-matières enregistrées illisibles.");
      for (const [id, component] of Object.entries(entry.components)) {
        if (!/^[a-f0-9-]{36}$/i.test(id) || !component || parseAverage20(component.average) === null)
          throw new Error("Moyenne de sous-matière enregistrée invalide.");
      }
    }
    if (entry.average === undefined && !Object.keys(entry.components || {}).length)
      throw new Error("Période de moyennes vide ou corrompue.");
  }
  return { periods: source.periods, previousReason: source.previousReason ?? null, ...(source.createdForDirect ? { createdForDirect: true } : {}) };
}

export function directAverage(reason: unknown, periodId: string | null | undefined): number | null {
  if (!periodId) return null;
  return readDirectAverages(reason).periods[periodId]?.average ?? null;
}

export function setDirectAverage(reason: unknown, periodId: string, average: number | null, actor: string, at: string, createdForDirect = false): string | null {
  const source = readDirectAverages(reason);
  if (createdForDirect) source.createdForDirect = true;
  // Saisie globale et saisie par sous-matières sont deux modes exclusifs.
  // Le changement de mode reste explicite et ne détruit aucune note de devoir.
  if (average === null) delete source.periods[periodId];
  else {
    if (parseAverage20(average) === null) throw new Error("Moyenne invalide");
    source.periods[periodId] = { average, actor, at };
  }
  return Object.keys(source.periods).length ? DIRECT_AVERAGES_PREFIX + JSON.stringify(source) : source.previousReason;
}


/** Moyennes directes des composantes, conservées dans la même source annuelle/période. */
export function directComponentAverages(reason: unknown, periodId: string | null | undefined): Record<string, number> {
  if (!periodId) return {};
  const entries = readDirectAverages(reason).periods[periodId]?.components || {};
  return Object.fromEntries(Object.entries(entries).map(([id, item]) => [id, item.average]));
}

export function setDirectComponentAverages(
  reason: unknown, periodId: string, values: Record<string, number | null>,
  actor: string, at: string, createdForDirect = false,
): string | null {
  const source = readDirectAverages(reason);
  if (createdForDirect) source.createdForDirect = true;
  const prev = source.periods[periodId];
  const components = { ...(prev?.components || {}) };
  for (const [id, average] of Object.entries(values)) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Sous-matière invalide");
    if (average === null) delete components[id];
    else {
      if (parseAverage20(average) === null) throw new Error("Moyenne de sous-matière invalide");
      components[id] = { average, actor, at };
    }
  }
  // Entrer une sous-matière remplace la saisie directe globale sur cette période.
  if (Object.keys(components).length) source.periods[periodId] = { components };
  else delete source.periods[periodId];
  return Object.keys(source.periods).length ? DIRECT_AVERAGES_PREFIX + JSON.stringify(source) : source.previousReason;
}

export type DirectAverageRow = { student_id: string; subject_id: string | null; reason?: string | null };
export function directAverageMap(rows: DirectAverageRow[], periodId: string | null | undefined): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const value = directAverage(row.reason, periodId);
    if (value === null || !row.subject_id) continue;
    const subjects = result.get(row.student_id) || new Map<string, number>();
    subjects.set(row.subject_id, value);
    result.set(row.student_id, subjects);
  }
  return result;
}

export function directComponentAverageMap(rows: DirectAverageRow[], periodId: string | null | undefined): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const components = directComponentAverages(row.reason, periodId);
    if (!Object.keys(components).length) continue;
    const stored = result.get(row.student_id) || new Map<string, number>();
    for (const [id, value] of Object.entries(components)) stored.set(id, value);
    result.set(row.student_id, stored);
  }
  return result;
}

export function finalSubjectAverage(calculated: number | null, bonus: number, direct: number | null | undefined): number | null {
  if (direct !== null && direct !== undefined) return direct;
  return calculated === null ? null : Math.max(0, Math.min(20, calculated + bonus));
}
