/** Appréciation officielle commune aux matières et à leurs sous-matières.
 * Une note manquante ne doit jamais être interprétée comme zéro.
 */
export function computeSubjectAppreciation(avg: number | string | null | undefined): string {
  if (avg === null || avg === undefined || avg === "") return "";
  // Les moyennes directes peuvent arriver sous forme de chaînes numériques
  // depuis Postgres/JSON. Une vraie note zéro est bien prise en compte.
  const a = Number(avg);
  if (!Number.isFinite(a)) return "";
  if (a >= 18) return "Excellent";
  if (a >= 16) return "TRÈS bien";
  if (a >= 14) return "Bien";
  if (a >= 12) return "Assez bien";
  if (a >= 10) return "Passable";
  if (a >= 8) return "Insuffisant";
  if (a >= 6) return "Faible";
  return "Blâme";
}
