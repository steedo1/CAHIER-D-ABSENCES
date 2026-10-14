/**
 * Niveau de suivi des éducateurs : dans l'ancien secondaire général,
 * classes.level utilise "5e" tandis que formation_level_code utilise "5eme".
 * Seules ces variantes non ambiguës sont réunies ; les autres niveaux et
 * les formations techniques/professionnelles conservent leurs codes exacts.
 */
export function canonicalEducatorLevel(
  value: unknown,
  educationType: string,
): string {
  const raw = String(value ?? "").trim();
  if (educationType !== "general_secondary") return raw;

  const compact = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s._-]/g, "");

  const secondaryMatch = compact.match(/^([3-6])(?:e|eme)$/);
  if (secondaryMatch) return `${secondaryMatch[1]}e`;

  return raw;
}
