import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createMulticycleFixture, createFixtureRouteLoader } from "./multicycle-fixture.mjs";

// Render the actual card used by each URL, not a reimplementation of its table.
// The test-only export does not change the Next page's public exports.
export const bulletinRoutes = ["src/app/admin/bulletins/page.tsx", "src/app/admin/notes/bulletins/page.tsx"];
const pageCache = new Map();
export function loadBulletinPage(route) {
  if (pageCache.has(route)) return pageCache.get(route);
  const source = readFileSync(route, "utf8");
  const overrides = new Map([[route, source + "\nexport { StudentBulletinCard, computeRanksAndStats };\n"]]);
  const page = createFixtureRouteLoader(createMulticycleFixture(), null, overrides)(route);
  pageCache.set(route, page);
  return page;
}
export function bulletinProps(grades = [14, 7, 7]) {
  const subjects = [
    ["en", "Anglais", 2, 13], ["fr", "Français", 3, null],
    ["hg", "Histoire-Géographie", 2, 12], ["ma", "Mathématiques", 3, 12],
    ["pc", "Physique-Chimie", 2, 12], ["svt", "Sciences de la Vie et de la Terre", 2, 12],
    ["edhc", "EDHC", 1, 16], ["eps", "EPS", 1, null],
  ];
  const present = grades.filter(v => v !== null && v !== undefined && v !== "NC");
  const points = present.reduce((sum, v) => sum + Number(v), 0);
  subjects[1][3] = present.length ? Math.round(points / present.length * 100) / 100 : null;
  const components = ["Composition française", "Expression orale", "Orthographe-Grammaire"].map((label, i) => ({
    id: `comp-${i}`, subject_id: "fr", label, short_label: null, coeff_in_subject: 1, order_index: i,
  }));
  return {
    index: 0, total: 1, previewZoomForMeasure: 1, signaturesEnabled: false, disableLocalQr: true,
    subjects: subjects.map(([subject_id, subject_name, coeff_bulletin]) => ({ subject_id, subject_name, coeff_bulletin, include_in_average: true })),
    subjectComponents: components, subjectGroups: [],
    classInfo: { id: "fixture-class", label: "5e1", level: "5e", academic_year: "2026-2027" },
    period: { from: "2026-09-14", to: "2026-12-04", label: "1er trimestre", academic_year: "2026-2027" },
    institution: { institution_name: "Collège de démonstration", institution_status: "Privé" },
    stats: { highest: 15, lowest: 8, classAvg: 12 },
    conduct: { total: 15 }, conductRank: 2,
    item: { student_id: "fixture-student", full_name: "ÉLÈVE TÉMOIN", rank: 2,
      general_avg: Math.round((165 + points) / (13 + present.length) * 100) / 100,
      per_subject: subjects.map(([subject_id, , , avg20]) => ({ subject_id, avg20, subject_rank: avg20 === null ? null : 2, average_source: "direct" })),
      per_subject_components: components.map((c, i) => ({ subject_id: "fr", component_id: c.id, avg20: grades[i], component_rank: grades[i] === null ? null : i + 1 })),
    },
  };
}
export function renderBulletin(route, props) {
  return renderToStaticMarkup(React.createElement(loadBulletinPage(route).StudentBulletinCard, props));
}
