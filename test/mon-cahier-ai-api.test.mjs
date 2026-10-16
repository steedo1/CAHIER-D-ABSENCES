import assert from "node:assert/strict";
import test from "node:test";
import { harness, institution, year, classes } from "./helpers/mon-cahier-ai-fixture.mjs";

test("both routes authorize an admin with several roles and reject teachers and signed-out users", async () => {
  for (const [options, status] of [
    [{ roles: ["teacher", "admin", "educator"] }, 200],
    [{ roles: ["teacher"] }, 403],
    [{ signedOut: true }, 401],
  ]) {
    const app = harness(options);
    assert.equal((await app.bootstrap()).status, status);
    assert.equal((await app.ask("Combien d’élèves compte l’établissement ?")).status, status);
    if (status !== 200) assert.ok(app.calls.every((call) => ["profiles", "user_roles"].includes(call.table)));
  }
});

test("an exact class count uses active distinct inscriptions for this school and year without prediction or bulletin calls", async () => {
  const app = harness();
  const response = await app.ask("Combien d’élèves compte la 3e3 ?");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.answer.quick_stats.cards[0].value, "2");
  assert.equal(result.answer.quick_stats.cards[1].value, "1");
  assert.equal(result.answer.quick_stats.scope_label, "3e3");
  assert.ok(app.calls.every((call) => !call.rpc && !call.bulletin && call.operation !== "insert"));
});

test("a bare effectif request also uses the direct count", async () => {
  const app = harness();
  const result = await (await app.ask("Quel est l’effectif ?")).json();
  assert.equal(result.answer.quick_stats.cards[0].value, "3");
  assert.ok(app.calls.every((call) => !call.rpc && !call.bulletin));
});

test("school counts include more than 80 classes and more than 1000 inscriptions without truncation", async () => {
  const manyClasses = Array.from({ length: 85 }, (_, n) => ({ ...classes[0], id: `class-${n}`, label: `3e${n + 1}` }));
  const enrollments = Array.from({ length: 1205 }, (_, n) => ({ id: String(n), class_id: manyClasses[n % 85].id, student_id: `student-${n}`, institution_id: institution, end_date: null }));
  const app = harness({ classes: manyClasses, enrollments });
  const result = await (await app.ask("Combien d’élèves compte l’établissement ?")).json();
  assert.equal(result.answer.quick_stats.cards[0].value, "1205");
  assert.equal(result.answer.quick_stats.cards[1].value, "85");
  assert.equal(app.calls.filter((call) => call.table === "class_enrollments").length, 2);
});

test("a missing level or another school's class never widens the analysis to this whole school", async () => {
  for (const overrides of [{ level: "Terminale" }, { class_id: "foreign" }, { academic_year: "2040-2041" }]) {
    const app = harness();
    const result = await (await app.ask("Résume la situation", overrides)).json();
    assert.equal(result.answer.title, "Aucune classe trouvée");
    assert.ok(app.calls.every((call) => !call.rpc && !call.bulletin));
  }
});

test("missing averages remain unknown and do not create a failing class or high-risk pupils", async () => {
  const app = harness({ bulletinItems: [{ student_id: "s1", full_name: "Élève test", general_avg: null, annual_avg: null, conduct_avg: null, per_subject: [] }] });
  const result = await (await app.ask("Résume la 3e3")).json();
  assert.equal(result.ok, true);
  assert.match(result.answer.summary, /Indice moyen de préparation : —/);
  assert.deepEqual(result.answer.classes_at_risk, []);
  assert.deepEqual(result.answer.students_to_follow, []);
  assert.equal(result.context_meta.students_count, 1);
  assert.equal(result.context_meta.data_quality.status, "missing");
  assert.deepEqual(app.calls.filter((call) => call.bulletin).map((call) => call.bulletin), ["a3"]);
  assert.ok(app.calls.filter((call) => call.operation === "insert").every((call) => call.table.startsWith("ai_")));
});

test("a genuine zero average still generates an alert and the council note and remediation are populated", async () => {
  for (const question of ["Prépare une note de conseil pour la 3e3", "Propose un plan de remédiation pour la 3e3"]) {
    const app = harness({ bulletinItems: [{ student_id: "s1", full_name: "Élève test", general_avg: 0, annual_avg: null, conduct_avg: null, per_subject: [] }] });
    const result = await (await app.ask(question)).json();
    assert.equal(result.answer.students_to_follow[0].general_avg_20, 0);
    assert.equal(result.answer.students_to_follow[0].risk_level, "high");
    assert.ok(result.answer.council_note || result.answer.remediation_plan?.length);
  }
});
