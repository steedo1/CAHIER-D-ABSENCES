// src/lib/academicYear.ts
export function computeAcademicYear(
  d = new Date(),
  startMonth = Number(process.env.ACADEMIC_YEAR_START_MONTH || 8) // 8 = ao�t
) {
  const m = d.getUTCMonth() + 1; // 1..12
  const y = d.getUTCFullYear();
  return m >= startMonth ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}


