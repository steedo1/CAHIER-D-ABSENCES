const fs = require('fs');

const path = 'src/app/admin/finance/payroll/page.tsx';
let source = fs.readFileSync(path, 'utf8');

const replacements = [
  [
`function periodIsInsideAcademicYear(
  periodStart: string,
  periodEnd: string,
  academicYearStart?: string | null,
  academicYearEnd?: string | null,
) {
  if (academicYearStart && periodStart < academicYearStart) return false;
  if (academicYearEnd && periodEnd > academicYearEnd) return false;
  return true;
}`,
`function periodIsInsideAcademicYear(
  periodStart: string,
  periodEnd: string,
  academicYearStart?: string | null,
  academicYearEnd?: string | null,
) {
  if (academicYearStart && periodEnd < academicYearStart) return false;
  if (academicYearEnd && periodStart > academicYearEnd) return false;
  return true;
}

function clampPeriodToAcademicYear(
  periodStart: string,
  periodEnd: string,
  academicYearStart?: string | null,
  academicYearEnd?: string | null,
) {
  return {
    periodStart: academicYearStart && academicYearStart > periodStart ? academicYearStart : periodStart,
    periodEnd: academicYearEnd && academicYearEnd < periodEnd ? academicYearEnd : periodEnd,
  };
}`
  ],
  [
`  if (!periodIsInsideAcademicYear(periodStart, periodEnd, selectedAcademicYearStart, selectedAcademicYearEnd)) {
    redirect(\`/admin/finance/payroll?\${returnParams}&message=month_outside_academic_year\`);
  }

  const [{ data: classRows, error: clsErr }, teachers] = await Promise.all([`,
`  if (!periodIsInsideAcademicYear(periodStart, periodEnd, selectedAcademicYearStart, selectedAcademicYearEnd)) {
    redirect(\`/admin/finance/payroll?\${returnParams}&message=month_outside_academic_year\`);
  }

  const effectiveRange = clampPeriodToAcademicYear(
    periodStart,
    periodEnd,
    selectedAcademicYearStart,
    selectedAcademicYearEnd,
  );

  const [{ data: classRows, error: clsErr }, teachers] = await Promise.all([`
  ],
  [
`    period_start: periodStart,
    period_end: periodEnd,`,
`    period_start: effectiveRange.periodStart,
    period_end: effectiveRange.periodEnd,`
  ],
  [
`      fetchStatisticsDetailServer(teacher.profile_id, periodStart, periodEnd),`,
`      fetchStatisticsDetailServer(teacher.profile_id, effectiveRange.periodStart, effectiveRange.periodEnd),`
  ],
  [
`        periodStart,
        periodEnd,
        classMap,`,
`        periodStart: effectiveRange.periodStart,
        periodEnd: effectiveRange.periodEnd,
        classMap,`
  ],
  [
`  const message = payrollMessage(params?.message);
  const monthInsideYear = periodIsInsideAcademicYear(
    currentRange.periodStart,
    currentRange.periodEnd,
    selectedAcademicYearStart,
    selectedAcademicYearEnd,
  );`,
`  const message = payrollMessage(params?.message);`
  ],
  [
`      {!monthInsideYear ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">Le mois choisi n’appartient pas à l’année scolaire sélectionnée.</div>
      ) : null}

`,
``
  ],
  [
`              <button type="submit" disabled={!monthInsideYear} className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">`,
`              <button type="submit" className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-black text-white hover:bg-emerald-700">`
  ],
  [
`  const currentRange = monthRange(month);

`,
``
  ],
];

for (const [before, after] of replacements) {
  if (!source.includes(before)) {
    console.error('Expected source block not found:\n', before);
    process.exit(1);
  }
  source = source.replace(before, after);
}

fs.writeFileSync(path, source);
console.log('Payroll month stability patch applied.');
