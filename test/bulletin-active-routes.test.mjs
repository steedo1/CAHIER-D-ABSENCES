import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { bulletinRoutes, loadBulletinPage, bulletinProps, renderBulletin } from "./helpers/bulletin-page-fixture.mjs";

function cells(document, name) {
  const row = [...document.querySelectorAll(".discipline-table tbody tr")].find(row => row.cells[0]?.textContent.trim() === name);
  assert.ok(row, `Missing rendered row: ${name}`);
  return [...row.cells].map(c => c.textContent.trim().replace(/(\d)\.(\d)/g, "$1,$2"));
}
for (const route of bulletinRoutes) {
  test(`${route}: real rendered cells, NC, zero, JSON numbers and totals`, () => {
    for (const [grades, coeff, points, frAvg, appreciation] of [
      [[14, 7, 7], 16, 193, "9,33", "Faible"],
      [["14.00", "7.00", "7.00"], 16, 193, "9,33", "Faible"],
      [[14, 7, null], 15, 186, "10,50", "Non classé"],
      [[14, 7, 0], 16, 186, "7,00", "Blâme"],
      [[14, null, null], 14, 179, "14,00", "Non classé"],
      [[null, null, null], 13, 165, "NC", "Non classé"],
    ]) {
      const props = bulletinProps(grades);
      const before = JSON.stringify(props);
      const win = new Window(); win.document.body.innerHTML = renderBulletin(route, props);
      assert.equal(JSON.stringify(props), before, "render never mutates the API payload");
      const totals = cells(win.document, "TOTAUX :");
      assert.equal(totals[2], String(coeff));
      assert.equal(totals[3], `${points},00`);
      assert.equal(cells(win.document, "Français")[1], frAvg);
      assert.equal(cells(win.document, "Composition française")[5], grades[0] === null ? "Non classé" : "Bien");
      assert.equal(cells(win.document, "Orthographe-Grammaire")[5], appreciation);
      assert.equal(cells(win.document, "Anglais")[5], "Assez bien");
      assert.equal(cells(win.document, "EPS")[5], "Non classé");
      assert.ok(["1", "—"].includes(cells(win.document, "EPS")[2]), "NC coefficient is informational or omitted, never added to totals");
      assert.equal(cells(win.document, "Orthographe-Grammaire")[4], grades[2] === null ? "NC" : "3e");
      assert.equal(cells(win.document, "Conduite")[3], "15,00");
      win.close();
    }
  });
  test(`${route}: existing API conduct is displayed and counted only once; CSCA components excluded`, () => {
    const props = bulletinProps();
    props.institution.institution_name = "CSCA Aboisso";
    props.subjects.push({ subject_id: "conduct", subject_name: "Conduite", coeff_bulletin: 1, include_in_average: true });
    props.item.per_subject.push({ subject_id: "conduct", avg20: 15 });
    for (const name of ["Latin", "Religion"]) {
      props.subjects.push({ subject_id: name, subject_name: name, coeff_bulletin: 1, include_in_average: false, is_conduct_component_only: true });
      props.item.per_subject.push({ subject_id: name, avg20: 18 });
    }
    const win = new Window(); win.document.body.innerHTML = renderBulletin(route, props);
    const rows = [...win.document.querySelectorAll(".discipline-table tbody tr")];
    assert.equal(rows.filter(r => r.cells[0]?.textContent.trim() === "Conduite").length, 1);
    assert.deepEqual(cells(win.document, "TOTAUX :").slice(2, 4), ["16", "193,00"]);
    assert.equal(cells(win.document, "Latin")[3], "—");
    win.close();
  });
  test(`${route}: actual rank enrichment keeps ties, zero, NC and component ranks`, () => {
    const props = bulletinProps();
    const input = { items: [12.06, "12.06", 0, null].map((general_avg, i) => ({ ...structuredClone(props.item), student_id: `p-${i}`, general_avg })) };
    const result = loadBulletinPage(route).computeRanksAndStats(input);
    assert.deepEqual(result.items.map(i => i.rank), [1, 1, 3, null]);
  });
}
