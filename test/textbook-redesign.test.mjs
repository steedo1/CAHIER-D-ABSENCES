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

const lessonStatusRoute = fs.readFileSync(
  new URL("../src/app/api/teacher/textbook/lesson-status/route.ts", import.meta.url),
  "utf8",
);

const teacherSyncRoute = fs.readFileSync(
  new URL("../src/app/api/teacher/textbook/sync/route.ts", import.meta.url),
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

test("la vue classe utilise le contexte pédagogique partagé", () => {
  assert.match(adminPage, /<EducationScopeFilter/);
  assert.match(adminPage, /title="Contexte du suivi"/);
  assert.match(adminPage, /showClass=\{view === "class"\}/);
  assert.match(adminPage, /label="Année scolaire"/);
  assert.match(adminPage, /label="Trimestre \/ période"/);
  assert.match(adminPage, /view === "class"/);
  assert.match(adminPage, /item\.class_id === educationScope\.classId/);
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

test("le professeur suit le flux année, classe, progression, leçon, séance", () => {
  assert.match(teacherPage, /Année scolaire/);
  assert.match(teacherPage, /Classe/);
  assert.match(teacherPage, /Progressions/);
  assert.match(teacherPage, /Leçons/);
  assert.match(teacherPage, /Date/);
  assert.match(teacherPage, /Créneau/);
  assert.match(teacherPage, /Contenu réalisé/);
  assert.match(teacherPage, /Travail à faire/);
  assert.match(teacherPage, /Enregistrer la séance/);
  assert.match(teacherPage, /Terminer la leçon/);
  assert.doesNotMatch(teacherPage, /TeacherTab/);
  assert.doesNotMatch(teacherPage, /Saisir la séance/);
  assert.doesNotMatch(teacherPage, /OfflineSyncBar/);
  assert.doesNotMatch(teacherPage, /OfflineReadinessCard/);
  assert.doesNotMatch(teacherPage, /offline-textbook/);
  assert.doesNotMatch(teacherPage, /useOnlineStatus/);
});

test("le contenu réalisé est facultatif et le travail à faire reste visible", () => {
  assert.doesNotMatch(teacherPage, /if \(!form\.content\.trim\(\)\)/);
  assert.match(teacherPage, /Contenu réalisé/);
  assert.match(teacherPage, /Facultatif/);
  assert.match(teacherPage, /Travail à faire/);
  assert.doesNotMatch(teacherPage, /Devoir et observation/);
});

test("terminer une leçon ne dépend plus de l'enregistrement d'une séance", () => {
  assert.doesNotMatch(lessonStatusRoute, /lesson_requires_session/);
  assert.doesNotMatch(lessonStatusRoute, /textbook_lesson_sessions/);
  assert.match(lessonStatusRoute, /textbook_lesson_completions/);
  assert.match(teacherPage, /updateLessonStatus\("completed"\)/);
});

test("le changement d'année resynchronise les progressions correspondantes", () => {
  assert.match(teacherPage, /academic_year/);
  assert.match(teacherPage, /changeAcademicYear/);
  assert.match(teacherPage, /syncAssignments/);
  assert.match(teacherSyncRoute, /body\.academic_year/);
  assert.match(teacherSyncRoute, /academic_years/);
  assert.match(teacherSyncRoute, /syncTextbookAssignmentsFromTeaching/);
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
