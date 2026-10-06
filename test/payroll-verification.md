# Teacher vacation and permanent overtime payroll verification

## Automated checks

Run `node --test test/payroll-calculation.test.mjs` and `npx tsc --noEmit`.
The tests cover missing/default parameters, explicit zero values, independent late/early
tolerances, unclosed sessions, exact period matching, grouped classes, duplicate
observations, assignment dates and legacy net amounts.

For permanent overtime, also run
`node --test test/permanent-payroll.test.mjs test/permanent-payroll-action.test.mjs test/permanent-payroll-profile.test.mjs`.
These execute the actual server calculation with an in-memory database, including
college 21-hour and lycée 18-hour thresholds, weekly resets, boundary weeks shared
by two months, mixed-cycle rates, unchanged vacation calculations, missing-category
validation before any writes, disabled profiles, settings merge conflicts, profile
API round trips and institution access checks, and the real print sheet with
synthetic data.

## Permanent configuration and rules

- Admin → Users → teacher payroll profile: choose collège (21 h/week) or lycée
  (18 h/week). The category belongs to the teacher, independently of class cycles.
- Existing permanent profiles remain unconfigured until an administrator selects
  their category. A combined calculation stops before any payroll write when an
  active permanent has no category; vacations-only calculation remains available.
- The category is stored in the existing institution settings, with a compare-and-
  swap update that preserves unrelated settings. No database schema change is needed.
- Quotas reset Monday, count completed physical teaching sessions, and cover both
  class cycles together. One physical period is one pedagogical hour, matching the
  existing vacation unit. Grouped classes count once. Missing/unclosed lessons do
  not consume the quota. Applicable lateness/early-leaving deductions are retained
  only on the payable overtime; this module does not calculate fixed salaries.
- Read full boundary weeks, clamped to the academic year, before allocating the
  quota; save only the selected month's sessions to avoid a month-boundary reset.
- Permanents have exactly one overtime rate: collège-category teachers receive
  the college rate and lycée-category teachers receive the lycée rate, regardless
  of the classes taught. Vacation teachers retain their class-cycle rates.
  The payroll line snapshots category, quota, monthly service and overtime counts.
- New combined runs use scope `all_teachers` plus notes marker
  `permanent_overtime_v1`. Pre-existing unmarked all-teachers runs are neither
  reused nor included; vacation history and validated runs are preserved.

## Browser fixture

`node test/payroll-print-server.mjs` serves the actual print components with synthetic
data on localhost:4177. Requires the app dependencies and `esbuild` available in the
local module resolution path. This helper is not an application route or deployed page.

- `/?auto`: automatic print trigger, then manual retry; by default `window.print`
  is replaced **in the fixture only** with a visible counter.
- `/?long&native`: 38 teachers and the browser's actual print action.
- `/?broken&auto`: configured logo load failure must show an error.
- `/?nologo&auto`: no configured logo must not block printing.

Verified in the embedded browser: logo/header, six columns including blank signature
cells, 38 rows, totals, hidden admin shell, one automatic trigger under StrictMode,
manual retry, missing-logo error and successful trigger with no configured logo.
The embedded browser does not expose the native print preview. A4 landscape
pagination, repeated table headers and physical/PDF output still require a final
Edge/Chrome preview check. No physical print job was sent.

## Scope and remaining limitations

- Existing payroll records are not recalculated by this code deployment.
- The preserved model pays per session, not per hour; confirm tariffs and tolerances
  before real payroll use.
- Historical calculations still use the available timetable, not a versioned
  timetable/holiday snapshot.
- Read/calculation failures now happen before replacing a draft. Database replacement
  is still multiple writes, not an atomic transaction.
- No schema, RLS, migration, grade-entry or production-data changes.
