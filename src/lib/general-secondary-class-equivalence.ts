export type GeneralSecondaryClassIdentity = {
  id?: string | null;
  label?: string | null;
  code?: string | null;
  level?: string | null;
  official_track_code?: string | null;
  education_type?: string | null;
};

function compact(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/**
 * Cle semantique volontairement conservative pour les classes du secondaire
 * general. Elle corrige notamment les variantes historiques de Premiere :
 * 1D1 / 1eD1 / 1reD1 / 1ereD1 / PremiereD1.
 *
 * Les autres niveaux restent strictement bases sur leur libelle afin de ne pas
 * fusionner deux classes legitimes par heuristique trop large.
 */
export function generalSecondaryClassSemanticKey(
  row: GeneralSecondaryClassIdentity,
): string {
  const candidates = [row.label, row.code].map(compact).filter(Boolean);

  for (const key of candidates) {
    const match = key.match(/^(?:PREMIERE|1ERE|1RE|1E|1)([ACD][0-9]*)$/);
    if (match) return `GENERAL:PREMIERE:${match[1]}`;
  }

  const fallback = candidates[0] || compact(row.level) || compact(row.id);
  return `GENERAL:EXACT:${fallback}`;
}

export function areGeneralSecondaryClassesEquivalent(
  a: GeneralSecondaryClassIdentity,
  b: GeneralSecondaryClassIdentity,
) {
  return generalSecondaryClassSemanticKey(a) === generalSecondaryClassSemanticKey(b);
}

function preferenceScore(row: GeneralSecondaryClassIdentity) {
  let score = 0;
  const label = compact(row.label);
  const code = compact(row.code);

  // Les classes deja rattachees au referentiel officiel sont prioritaires.
  if (String(row.official_track_code || "").trim()) score += 100;

  // Preferer les libelles canoniques courts (ex. 1D1) aux alias 1eD1/1reD1.
  if (/^1[ACD][0-9]*$/.test(label)) score += 50;
  if (/^1[ACD][0-9]*$/.test(code)) score += 20;

  return score;
}

export function choosePreferredEquivalentClass<T extends GeneralSecondaryClassIdentity>(
  rows: T[],
): T | null {
  if (rows.length === 0) return null;

  return [...rows].sort((a, b) => {
    const scoreDiff = preferenceScore(b) - preferenceScore(a);
    if (scoreDiff !== 0) return scoreDiff;

    const labelDiff = String(a.label || "").localeCompare(
      String(b.label || ""),
      "fr",
      { sensitivity: "base", numeric: true },
    );
    if (labelDiff !== 0) return labelDiff;

    return String(a.id || "").localeCompare(String(b.id || ""));
  })[0];
}

export function dedupeEquivalentGeneralSecondaryClasses<
  T extends GeneralSecondaryClassIdentity,
>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();

  for (const row of rows) {
    const key = generalSecondaryClassSemanticKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return Array.from(groups.values())
    .map((group) => choosePreferredEquivalentClass(group))
    .filter((row): row is T => Boolean(row));
}
