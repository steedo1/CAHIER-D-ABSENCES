/** Appréciation officielle commune aux matières et à leurs sous-matières.
 * Une note manquante ne doit jamais être interprétée comme zéro.
 */
export function computeSubjectAppreciation(avg: number | null | undefined): string {
  if (avg === null || avg === undefined) return "";
  if (!Number.isFinite(avg)) return "";
  const a = Number(avg);
  if (a >= 18) return "Excellent";
  if (a >= 16) return "TRÈS bien";
  if (a >= 14) return "Bien";
  if (a >= 12) return "Assez bien";
  if (a >= 10) return "Passable";
  if (a >= 8) return "Insuffisant";
  if (a >= 6) return "Faible";
  return "Blâme";
}
