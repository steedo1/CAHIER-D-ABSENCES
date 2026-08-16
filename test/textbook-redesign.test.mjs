import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const adminPage = fs.readFileSync(
  new URL("../src/app/admin/cahier-de-texte/page.tsx", import.meta.url),
  "utf8",
);

const teacherPage = fs.readFileSync(
  new URL("../src/app/enseignant/cahier-de-texte/page.tsx", import.meta.url),
  "utf8",
);

const autoAssignment = fs.readFileSync(
  new URL("../src/lib/textbook/auto-assignment.ts", import.meta.url),
  "utf8",
);

const monitorRoute = fs.readFileSync(
  new URL("../src/app/api/admin/textbook/monitor/route.ts", import.meta.url),
  "utf8",
);

test("le suivi admin est centré sur la consultation et les filtres métier", () => {
  const labels = [
    'label="Année scolaire"',
    'label="Trimestre"',
    'label="Niveau"',
    'label="Classe"',
    'label="Discipline"',
    'label="Enseignant"',
  ];

  let cursor = -1;
  for (const marker of labels) {
    const next = adminPage.indexOf(marker);
    assert.ok(next > cursor, `${marker} doit apparaître après le filtre précédent`);
    cursor = next;
  }

  for (const tab of [
    "Vue d’ensemble",
    "Niveaux",
    "Classes",
    "Disciplines",
    "Enseignants",
  ]) {
    assert.match(adminPage, new RegExp(tab.replace(/[’]/g, "[’']")));
  }

  assert.doesNotMatch(adminPage, /Progressions & affectations/);
  assert.doesNotMatch(adminPage, /selectedClassIds/);
  assert.doesNotMatch(adminPage, /Créer une progression/);
});

test("le professeur dispose de trois tâches lisibles sans mode hors ligne", () => {
  assert.match(teacherPage, /Programme/);
  assert.match(teacherPage, /Saisir la séance/);
  assert.match(teacherPage, /Séances réalisées/);
  assert.doesNotMatch(teacherPage, /OfflineSyncBar/);
  assert.doesNotMatch(teacherPage, /OfflineReadinessCard/);
  assert.doesNotMatch(teacherPage, /offline-textbook/);
  assert.doesNotMatch(teacherPage, /useOnlineStatus/);
  assert.doesNotMatch(teacherPage, /conservée sur cet appareil/);
});

test("l'association des progressions suit les affectations pédagogiques réelles", () => {
  assert.match(autoAssignment, /\.from\("class_teachers"\)/);
  assert.match(autoAssignment, /\.is\("end_date", null\)/);
  assert.match(autoAssignment, /textbookAssignmentMatchesClassTeacherRows/);
  assert.match(autoAssignment, /resolveTextbookAssignmentSubject/);
  assert.doesNotMatch(autoAssignment, /manual_subject/);
  assert.doesNotMatch(autoAssignment, /espagnol.*skipped/i);
  assert.doesNotMatch(autoAssignment, /allemand.*skipped/i);
});

test("le monitoring calcule aussi l'exécution par trimestre", () => {
  assert.match(monitorRoute, /trimester/);
  assert.match(monitorRoute, /\["T1", "T2", "T3"\]/);
  assert.match(monitorRoute, /periodMetric/);
  assert.match(monitorRoute, /sessions_count/);
  assert.match(monitorRoute, /completion_rate/);
});
