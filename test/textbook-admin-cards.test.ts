import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  combineMetrics,
  groupCards,
  type Metric,
  type MonitorItem,
} from "../src/lib/textbook/monitor-cards";

const metric = (done: number, expected: number, recorded: number, planned: number): Metric => ({
  expected_items: expected,
  completed_items: done,
  planned_minutes: expected * 55,
  completed_planned_minutes: done * 55,
  completion_rate: expected ? done / expected * 100 : 0,
  sessions_count: recorded,
  planned_sessions_count: planned,
  recording_rate: planned ? recorded / planned * 100 : 0,
  realized_minutes: recorded * 55,
  realized_hours: recorded * 55 / 60,
});

function assignment(
  id: string,
  cls: string,
  subject: string,
  teacher: string,
  m: Metric,
): MonitorItem {
  return {
    assignment_id: id,
    progression_title: "Programme",
    academic_year: "2026-2027",
    class_id: cls,
    class_label: cls,
    subject_id: subject,
    subject_name: subject,
    teacher_id: teacher,
    teacher_name: teacher,
    ...m,
    periods: { T1: m, T2: metric(0, 0, 0, 0), T3: metric(0, 0, 0, 0) },
  };
}

test("aggregation uses planned denominators, not the mean of percentages", () => {
  const items = [
    assignment("a", "5e", "Math", "Prof", metric(1, 2, 2, 2)),
    assignment("b", "6e", "Math", "Prof", metric(9, 10, 1, 8)),
  ];
  const summary = combineMetrics(items, "ALL");
  assert.equal(summary.completion_rate, 83.3);
  assert.equal(summary.recording_rate, 30);
  assert.equal(summary.sessions_count, 3);
});

test("filters by selected period without inventing activity", () => {
  const item = assignment("a", "5e", "Math", "Prof", metric(1, 2, 1, 2));
  const empty = combineMetrics([item], "T2");
  assert.equal(empty.expected_items, 0);
  assert.equal(empty.planned_sessions_count, 0);
  assert.equal(empty.recording_rate, 0);
});

test("class view separates subjects and teacher; subject view separates classes and teacher", () => {
  const items = [
    assignment("a", "5e", "Math", "A", metric(1, 2, 1, 2)),
    assignment("b", "5e", "Français", "B", metric(1, 2, 1, 2)),
    assignment("c", "6e", "Math", "A", metric(1, 2, 1, 2)),
  ];
  assert.equal(groupCards(items.filter(x => x.class_id === "5e"), "ALL", "class").length, 2);
  assert.equal(groupCards(items.filter(x => x.subject_id === "Math"), "ALL", "subject").length, 2);
});

test("recording percent is capped at 100 when entries exceed planned sessions", () => {
  const item = assignment("a", "5e", "Math", "Prof", metric(1, 1, 5, 2));
  assert.equal(combineMetrics([item], "ALL").recording_rate, 100);
});

test("a taught subject without progression is displayed as unconfigured", () => {
  const missing = assignment("", "CP1", "Arabe", "Enseignant", metric(0, 0, 0, 0));
  const cards = groupCards([missing], "T1", "subject");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].title, "CP1");
  assert.equal(cards[0].metric.planned_sessions_count, 0);
});

test("dashboard GET is read-only and detail lookups have bounded results", () => {
  const monitor = readFileSync("src/app/api/admin/textbook/monitor/route.ts", "utf8");
  const page = readFileSync("src/app/admin/cahier-de-texte/page.tsx", "utf8");
  const details = readFileSync("src/app/api/admin/textbook/details/route.ts", "utf8");
  assert.doesNotMatch(monitor, /syncTextbookAssignmentsFromTeaching/);
  assert.doesNotMatch(page, /setInterval\s*\(/);
  assert.match(page, /method: "POST"/);
  assert.match(details, /requireTextbookManager/);
  assert.match(details, /\.limit\(40\)/);
});

test("admin cards display only teacher and execution rate without session drilldown", () => {
  const page = readFileSync("src/app/admin/cahier-de-texte/page.tsx", "utf8");
  const monitor = readFileSync("src/app/api/admin/textbook/monitor/route.ts", "utf8");
  assert.match(page, /card\.teacher/);
  assert.match(page, /card\.metric\.completion_rate/);
  assert.match(page, /execution_only: "1"/);
  assert.doesNotMatch(page, /Séances consignées|Voir les séances|Aucune prévision renseignée|toggleDetails/);
  assert.doesNotMatch(page, /\/api\/admin\/textbook\/details/);
  assert.match(monitor, /if \(!executionOnly && assignmentIds\.length\)/);
});
