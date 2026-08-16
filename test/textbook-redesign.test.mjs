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

test("le suivi admin propose seulement les deux vues utiles", () => {
  assert.match(adminPage, /Par classe/);
  assert.match(adminPage, /Par discipline/);
  assert.doesNotMatch(adminPage, /Vue d’ensemble/);
  assert.doesNotMatch(adminPage, />Niveaux</);
  assert.doesNotMatch(adminPage, />Classes</);
  assert.doesNotMatch(adminPage, />Disciplines</);
  assert.doesNotMatch(adminPage, />Enseignants</);
  assert.doesNotMatch(adminPage, /Classes suivies/);
  assert.doesNotMatch(adminPage, /Séances réalisées/);
});

test("la vue classe garde seulement année, période, niveau et classe", () => {
  assert.match(adminPage, /label="Année scolaire"/);
  assert.match(adminPage, /label="Trimestre \/ période"/);
  assert.match(adminPage, /label="Niveau"/);
  assert.match(adminPage, /view === "class"/);
  assert.match(adminPage, /label="Classe"/);
  assert.match(adminPage, /"Discipline" : "Classe"/);
  assert.match(adminPage, />Enseignant</);
  assert.match(adminPage, />Exécution</);
});

test("la vue discipline compare les classes et enseignants du niveau", () => {
  assert.match(adminPage, /view === "subject"/);
  assert.match(adminPage, /label="Discipline"/);
  assert.match(adminPage, /subjectKey\(item\) === subjectId/);
  assert.match(adminPage, /Exécution moyenne de \$\{selectedSubject\.label\} en/);
  assert.match(adminPage, /classe\(s\) concernée\(s\)/);
});

test("le filtre de période exploite réellement les métriques T1 T2 T3", () => {
  assert.match(adminPage, /<option value="T1">Trimestre 1<\/option>/);
  assert.match(adminPage, /<option value="T2">Trimestre 2<\/option>/);
  assert.match(adminPage, /<option value="T3">Trimestre 3<\/option>/);
  assert.match(adminPage, /item\.periods\?\.\[period\]/);
  assert.match(adminPage, /combineMetrics\(selectedRows, period\)/);
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

test("le monitoring résout le vrai nom du professeur", () => {
  assert.match(monitorRoute, /\.from\("teachers"\)\.select\("id,full_name"\)/);
  assert.match(monitorRoute, /\.from\("profiles"\)/);
  assert.match(monitorRoute, /teacherNames\.has\(id\)/);
  assert.doesNotMatch(
    monitorRoute,
    /teacherNames\.get\(teacherId\) \|\| "Enseignant"/,
  );
  assert.match(monitorRoute, /Nom enseignant indisponible/);
});
