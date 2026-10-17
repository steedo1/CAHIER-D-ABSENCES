/** Competition ranking: 1, 2, 2, 4. Only complete results participate. */
export function buildPedagogicalRanks(rows: readonly { studentId: string; average: number | null; complete: boolean }[]): Map<string, number> {
  const ordered = rows.filter((row): row is typeof row & { average: number } => row.complete && row.average !== null && Number.isFinite(row.average))
    .slice().sort((left, right) => right.average - left.average);
  const ranks = new Map<string, number>();
  let previous: number | null = null, rank = 0;
  ordered.forEach((row, index) => {
    if (previous === null || row.average !== previous) rank = index + 1;
    ranks.set(row.studentId, rank); previous = row.average;
  });
  return ranks;
}
