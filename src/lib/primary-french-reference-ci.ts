/**
 * Référentiel des RUBRIQUES du bulletin primaire français ivoirien,
 * relevées sur le bulletin fourni par l'établissement.
 *
 * Ce fichier ne crée aucune discipline en base et ne définit AUCUN coefficient.
 * Les barèmes sont des dénominateurs de notes, pas des poids de matières.
 */
export const CI_PRIMARY_FRENCH_REFERENCE = [
  { code: "lecture", label: "Lecture", aliases: ["Lecture"] },
  { code: "ecriture_copie", label: "Écriture / Copie", aliases: ["Écriture / Copie", "Écriture", "Copie", "Écriture et copie"] },
  { code: "orthographe_dictee", label: "Orthographe / Dictée", aliases: ["Orthographe / Dictée", "Orthographe", "Dictée", "Orthographe et dictée"] },
  { code: "expression_ecrite", label: "Expression écrite", aliases: ["Expression écrite", "Production écrite"] },
  { code: "exploitation_texte", label: "Exploitation de texte", aliases: ["Exploitation de texte", "Exploitation du texte"] },
  { code: "eveil_milieu", label: "Éveil au milieu", aliases: ["Éveil au milieu", "Éveil du milieu"] },
  { code: "mathematiques", label: "Mathématiques", aliases: ["Mathématiques", "Mathématique", "Maths"] },
  { code: "chant_poeme", label: "Chant / Poème", aliases: ["Chant / Poème", "Chant et poème", "Chant", "Poème", "Poésie"] },
  { code: "dessin", label: "Dessin", aliases: ["Dessin"] },
  { code: "edhc", label: "EDHC", aliases: ["EDHC", "Éducation aux droits de l'homme et à la citoyenneté"] },
  { code: "eps", label: "EPS", aliases: ["EPS", "Éducation physique et sportive"] },
] as const;

export type CiPrimaryFrenchCode = (typeof CI_PRIMARY_FRENCH_REFERENCE)[number]["code"];
export type CiPrimaryFrenchSubject = { id: string; name: string };
export type CiPrimaryFrenchMatch = {
  code: CiPrimaryFrenchCode; label: string; subjectId: string;
  subjectName: string; denominator: number;
};

export const normalizeCiPrimaryName = (name: string): string =>
  name.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[’']/g, " ").replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\s+/g, " ");

const ALIASES = CI_PRIMARY_FRENCH_REFERENCE.map(entry => ({
  ...entry, keys: new Set<string>(entry.aliases.map(normalizeCiPrimaryName)),
}));

export function isCiPrimaryFrenchLevel(level: string): boolean {
  return /^(cp[12]|ce[12]|cm[12])$/i.test(level.replace(/[\s.-]/g, ""));
}

export function ciPrimaryFrenchDenominator(level: string, code: CiPrimaryFrenchCode): number {
  const course = level.replace(/[\s.-]/g, "").toUpperCase();
  // CP2 and CE1/CE2: local school booklets supplied for the default template.
  if (course === "CP2" && code === "mathematiques") return 20;
  if ((course === "CE1" || course === "CE2") &&
      (code === "exploitation_texte" || code === "mathematiques" || code === "eveil_milieu")) return 30;
  if (course !== "CM1" && course !== "CM2") return 10;
  if (code === "orthographe_dictee") return 20;
  if (code === "exploitation_texte" || code === "mathematiques" || code === "eveil_milieu") return 50;
  return 10;
}

/** Only exact, conservative aliases: never infer a subject from a substring. */
export function ciPrimaryFrenchEntryForName(name: string) {
  const key = normalizeCiPrimaryName(name);
  const matches = ALIASES.filter(entry => entry.keys.has(key));
  return matches.length === 1 ? matches[0] : null;
}

/** Pure preview: no subjects invented, no teachers reassigned, no existing extras removed. */
export function planCiPrimaryFrenchReference(
  level: string, catalog: readonly CiPrimaryFrenchSubject[], selectedIds: readonly string[],
) {
  if (!isCiPrimaryFrenchLevel(level)) throw new Error("ci_primary_invalid_level");
  const matches: CiPrimaryFrenchMatch[] = [];
  const missing: string[] = [];
  const ambiguous: Array<{ label: string; candidates: string[] }> = [];
  const reservedIds = new Set<string>();
  for (const entry of ALIASES) {
    const candidates = catalog.filter(subject =>
      entry.keys.has(normalizeCiPrimaryName(subject.name)));
    if (candidates.length !== 1 || reservedIds.has(candidates[0]?.id)) {
      if (candidates.length === 0) missing.push(entry.label);
      else ambiguous.push({ label: entry.label, candidates: candidates.map(item => item.name) });
      continue;
    }
    const subject = candidates[0];
    matches.push({ code: entry.code, label: entry.label, subjectId: subject.id,
      subjectName: subject.name, denominator: ciPrimaryFrenchDenominator(level, entry.code) });
    reservedIds.add(subject.id);
  }
  const nextIds = [...new Set([...selectedIds, ...matches.map(entry => entry.subjectId)])];
  return { matches, missing, ambiguous,
    existingExtras: selectedIds.filter(id => !reservedIds.has(id)),
    newlyAssociated: matches.filter(row => !selectedIds.includes(row.subjectId)).map(row => row.subjectId),
    proposedSubjectIds: nextIds };
}

/**
 * The 11 official subjects stay available to the teacher and in school
 * settings, but a pupil's bulletin prints ONLY subjects with an actual mark.
 * A true zero is a mark; null (not evaluated) is NOT zero.
 * Preserve CI order and display the matching composition denominators.
 * Real scored subjects outside the CI reference remain visible at the end.
 * Franco-Arabic previews may explicitly keep ungraded curriculum rows; their
 * null marks and the default behavior of other schools remain unchanged.
 */
export function ciPrimaryFrenchBulletinRows<T extends {
  id: string; name: string; average: number | null; coefficient: number | null;
  includeInAverage?: boolean; denominator?: number;
}>(level: string, subjects: readonly T[], includeUngraded = false): Array<T & { denominator?: number }> {
  const scored = subjects.filter(row => includeUngraded || (typeof row.average === "number" && Number.isFinite(row.average)));
  const used = new Set<string>();
  const ordered = CI_PRIMARY_FRENCH_REFERENCE.flatMap(entry => {
    const candidates = scored.filter(row => ciPrimaryFrenchEntryForName(row.name)?.code === entry.code);
    if (candidates.length !== 1 || used.has(candidates[0].id)) return [];
    const subject = candidates[0];
    used.add(subject.id);
    return [{ ...subject, name: entry.label, denominator: subject.denominator ?? ciPrimaryFrenchDenominator(level, entry.code) }];
  });
  return [...ordered, ...scored.filter(row => !used.has(row.id))];
}

/** Appreciation grid printed in the school's CI primary booklet.
 * Normalize the mark to /10 without changing or rounding the stored score.
 * Null is unevaluated; an actual zero receives the booklet's zero label. */
export function ciPrimaryFrenchAppreciation(score: number | null | undefined, denominator: number): string | null {
  if (score == null || !Number.isFinite(score) || !Number.isFinite(denominator) ||
      denominator <= 0 || score < 0 || score > denominator) return null;
  const outOfTen = score / denominator * 10;
  if (outOfTen >= 10) return "Très bien";
  if (outOfTen >= 8) return "Bien";
  if (outOfTen >= 6) return "Assez bien";
  if (outOfTen >= 5) return "Passable";
  if (outOfTen >= 3) return "Médiocre";
  if (outOfTen >= 1) return "Mal";
  return "Travail très mal";
}
