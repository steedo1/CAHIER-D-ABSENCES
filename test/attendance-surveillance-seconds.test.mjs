import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const file = "src/app/admin/absences/appels/page.tsx";
const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["formatDateFr", "hmToMinutes", "isoToHm", "plannedIso", "plannedDuration", "isAbsenceStatus", "formatMinutes", "rawLateMinutes", "rawEarlyDepartureMinutes", "effectiveDuration", "detailLabel", "ManualCourseDetails"];
const source = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map((node) => node.getText(ast)).join("\n");
const receiptSource = read("src/lib/attendance-surveillance.ts");
const receipts = {};
new Function("exports", ts.transpileModule(receiptSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(receipts);
const helpers = new Function("require", "attendanceReceiptLabel", "exports", `${ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText}; return { ${names.join(", ")} };`)((name) => { assert.equal(name, "react/jsx-runtime"); return jsx; }, receipts.attendanceReceiptLabel, {});

const row = { date: "2026-10-08", planned_start: "03:20", planned_end: "03:22", status: "ok" };
for (const [actual, expected] of [["03:20:12.241", "12 s"], ["03:20:39.293", "39 s"], ["03:21:04.208", "1 min 4 s"]]) {
  test(`actual start ${actual} displays ${expected}, without rounding upward`, () => {
    const session = { actual_call_at: `2026-10-08T${actual}Z` };
    const minutes = helpers.rawLateMinutes(row, session);
    assert.equal(helpers.formatMinutes(minutes), expected);
    assert.equal(helpers.isoToHm(session.actual_call_at), actual.slice(0, 8));
    assert.match(helpers.detailLabel({ ...row, ...session, status: "late", late_minutes: minutes, early_departure_minutes: 0 }).suffix, new RegExp(expected));
  });
}

test("seconds are preserved in early departures, effective duration and accumulated totals", () => {
  const course = { ...row, actual_call_at: "2026-10-08T03:20:12.241Z", ended_at: "2026-10-08T03:20:42.223Z", actual_start: "03:20:12", actual_end: "03:20:42" };
  assert.equal(helpers.formatMinutes(helpers.rawEarlyDepartureMinutes(row, course)), "1 min 18 s");
  assert.equal(helpers.formatMinutes(helpers.effectiveDuration(course)), "30 s");
  const minutes = helpers.rawLateMinutes(row, course) + helpers.rawLateMinutes(row, { actual_call_at: "2026-10-08T03:20:39.293Z" });
  assert.equal(helpers.formatMinutes(minutes), "52 s");
  assert.equal(helpers.effectiveDuration({ ...course, actual_call_at: "2026-10-08T03:19:00Z", ended_at: "2026-10-08T03:23:00Z" }), 2);
});

test("manual course detail renders its real times, duration and receipt, including an all-present call", () => {
  const html = renderToStaticMarkup(helpers.ManualCourseDetails({ rows: [{
    id: "manual-fr", session_id: "manual-fr", date: "2026-10-08", class_label: "3e1", subject_name: "Français", teacher_name: "Professeur",
    actual_call_at: "2026-10-08T03:16:27.289Z", ended_at: "2026-10-08T03:17:02.930Z",
    attendance_receipt_available: true, attendance_received_at: "2026-10-08T03:25:48.415103Z",
  }] }));
  assert.match(html, /Démarrage réel : 03:16:27/);
  assert.match(html, /Fin réelle : 03:17:02/);
  assert.match(html, /Durée enregistrée : 36 s/);
  assert.match(html, /Appel élèves reçu · séance clôturée/);
  assert.match(html, /Réception à 03:25:48/);
});

