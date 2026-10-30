/**
 * Total affiché au pied du bulletin : les mêmes rubriques et les mêmes
 * coefficients effectifs doivent alimenter les points ET le dénominateur.
 * Une note NC est absente ; 0/20 reste une vraie note.
 */
export type BulletinVisibleContribution = {
  subjectId: string;
  average: number | string | null | undefined;
  coefficient: number;
  points: number | null | undefined;
  includeInAverage: boolean;
};

export function calculateBulletinVisibleTotals(rows: readonly BulletinVisibleContribution[]): {
  coefficient: number;
  points: number | null;
} {
  let coefficient = 0;
  let points = 0;
  let hasAnyGrade = false;
  const counted = new Set<string>();
  for (const row of rows) {
    if (!row.subjectId || !row.includeInAverage || counted.has(row.subjectId)) continue;
    // Ne pas convertir null ou la chaîne NC en zéro.
    if (row.average === null || row.average === undefined || row.average === "") continue;
    const average = Number(row.average);
    const w = Number(row.coefficient);
    const p = row.points;
    if (!Number.isFinite(average) || !Number.isFinite(w) || w <= 0 ||
        p === null || p === undefined || !Number.isFinite(Number(p))) continue;
    counted.add(row.subjectId);
    coefficient += w;
    points += Number(p);
    hasAnyGrade = true;
  }
  return { coefficient, points: hasAnyGrade ? Math.round(points * 100) / 100 : null };
}
