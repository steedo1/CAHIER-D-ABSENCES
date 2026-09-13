# Vacation payroll verification

## Automated checks

Run `node --test test/payroll-calculation.test.mjs` and `npx tsc --noEmit`.
The tests cover missing/default parameters, explicit zero values, independent late/early
tolerances, unclosed sessions, exact period matching, grouped classes, duplicate
observations, assignment dates and legacy net amounts.

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
