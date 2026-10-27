import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSchoolReportClass, buildStatisticsSections, buildSchoolCsv, selectAffectation, pct,
} from "../src/lib/school-results-reports";
import { buildSchoolReportHtml } from "../src/lib/school-results-print";
import { reportTracksForSelection } from "../src/lib/school-report-tracks";

function schoolFixture() {
  return buildSchoolReportClass({
    id: "c1", label: "6ème 1", level: "6ème", track: "french",
    roster: {
      class: { label: "6ème 1", level: "6ème" },
      institution: { name: "ÉCOLE & FILS", regional_direction: "DRENA TEST" },
      staff: { head_teacher: { display_name: "M. Principal" }, educators: [{ display_name: "Mme Éducatrice" }] },
      students: [
        { id: "a", matricule: "001", full_name: "Aline", gender: "F", is_affecte: true, birthdate: "2014-01-01", nationality: "Ivoirienne" },
        { id: "b", matricule: "002", full_name: "Binta", gender: "F", is_affecte: false },
        { id: "c", matricule: "=3+3", full_name: "=HYPERLINK()", gender: "M", is_affecte: false },
        { id: "d", matricule: "004", full_name: "Diane", gender: "F", is_affecte: null },
        { id: "e", matricule: "005", full_name: "Elsa", gender: "F", is_affecte: true },
      ],
    },
    bulletin: { ok: true, items: [
      { student_id: "a", general_avg: 12, rank: 2 },
      { student_id: "b", general_avg: 9, rank: 3 },
      { student_id: "c", general_avg: 6, rank: 4 },
      { student_id: "d", general_avg: 15, rank: 1 },
      { student_id: "e", general_avg: 17, rank: 5, admin_forced_nc: true },
    ] },
  });
}

test("affectation is independent of NC and unknown does not become non-affecte", () => {
  const cls = schoolFixture();
  assert.equal(selectAffectation(cls.students, "affected").length, 2);
  assert.equal(selectAffectation(cls.students, "unaffected").length, 2);
  assert.equal(cls.students.find(s => s.id === "e")?.average, null);
  assert.equal(cls.students.find(s => s.id === "e")?.rank, null);
  assert.equal(cls.students.find(s => s.id === "d")?.isAffected, null);
  assert.equal(cls.students.find(s => s.id === "a")?.rank, 2);
});

test("statistical thresholds, gender and classed denominators are consistent", () => {
  const section = buildStatisticsSections([schoolFixture()], "all").at(-1)!;
  const total = section.schoolRows.find(r => r.gender === "T")!.total;
  assert.deepEqual([total.effectif, total.classed, total.unclassed], [5, 4, 1]);
  assert.deepEqual([total.above10, total.between850, total.below850], [2, 1, 1]);
  assert.equal(pct(total.above10, total.classed), "50 %");
  assert.equal(section.schoolRows.find(r => r.gender === "F")!.total.effectif, 4);
  assert.equal(section.schoolRows.find(r => r.gender === "G")!.total.effectif, 1);
  assert.equal(buildStatisticsSections([schoolFixture()], "affected")[0].schoolRows[2].total.effectif, 2);
});

test("specialized /10 scores retain their native value and use normalized threshold", () => {
  const cls = buildSchoolReportClass({
    id: "epc", label: "CP1 arabe", level: "CP1", track: "arabic",
    roster: { students: [{ id: "s1", full_name: "Élève", gender: "F", is_affecte: false }] },
    bulletin: { ok: true, specialized: { engine: "specialized", programs: ["arabic"], documents: [
      { studentId: "s1", programReadiness: { arabic: true },
        document: { arabic: { generalAverage: 6, denominator: 10, rank: 1 } } },
    ] } },
  });
  assert.equal(cls.students[0].average, 6);
  assert.equal(cls.students[0].denominator, 10);
  assert.equal(cls.students[0].rank, 1);
  assert.equal(buildStatisticsSections([cls], "all").at(-1)!.schoolRows[2].total.above10, 1);
});

test("CSV remains UTF-8, escaped, without spreadsheet formula execution", () => {
  const csv = buildSchoolCsv([schoolFixture()], "nominal", "all");
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"'=HYPERLINK\(\)"/);
  assert.match(csv, /"'=3\+3"/);
  assert.match(csv, /;"/);
  assert.doesNotMatch(csv, /undefined/);
});

test("PDF HTML escapes school and student names and has repeating table headings", () => {
  const cls = schoolFixture();
  cls.students[0].name = "<script>alert(1)</script>";
  const html = buildSchoolReportHtml({
    classes: [cls], kind: "nominal", filter: "all", academicYear: "2026-2027",
    periodLabel: "1er trimestre", track: "french",
  });
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("ÉCOLE &amp; FILS"));
  assert.ok(html.includes("thead{display:table-header-group}"));
  assert.ok(html.includes("N° DEC AFF"));
  assert.ok(html.includes("Document édité avec <strong>Mon Cahier</strong> &bull; www.mon-cahier.com"));
  assert.ok(html.includes("@page{size:A4 portrait"));
  assert.ok(html.includes("bottom:-15mm"));
  assert.ok(html.includes("NOM ET PRENOMS"));
  assert.ok(html.includes("RAPPORT 2 (PAR TRIMESTRE)"));
});


test("historical period uses bulletin enrolments, not only the current roster", () => {
  const cls = buildSchoolReportClass({
    id: "c2", label: "5ème 1", level: "5ème", track: "french",
    roster: { students: [{ id: "new", full_name: "Nouvel élève", is_affecte: true }] },
    bulletin: { ok: true, items: [{
      student_id: "retired", full_name: "Ancien élève", matricule: "HIS1",
      gender: "F", birth_date: "2011-01-01", nationality: "Ivoirienne",
      is_affecte: false, general_avg: 10.5, rank: 2,
    }] },
  });
  assert.deepEqual(cls.students.map(s => s.name), ["Ancien élève"]);
  assert.equal(cls.students[0].isAffected, false);
  assert.equal(cls.students[0].rank, 2);
});
test("reject Arabic report for an ordinary French class", () => {
  assert.throws(() => buildSchoolReportClass({
    id: "c1", label: "6ème", level: "6ème", track: "arabic",
    roster: { students: [] },
    bulletin: { ok: true, items: [] },
  }), /arabe indisponible/i);
});

test("RAPPORT 1 print retains 12-column multirow headings and recap wording", () => {
  const cls = schoolFixture();
  const html = buildSchoolReportHtml({
    classes: [cls], kind: "statistics", filter: "all",
    academicYear: "2026-2027", periodLabel: "1er trimestre", track: "french",
  });
  assert.ok(html.includes("Tableau des résultats <span class=\"accent\">des élèves affectés</span> par classe et par niveau"));
  assert.ok(html.includes("Récapitulatif des résultats <span class=\"accent\">des élèves affectés et non affectés</span> par niveau"));
  assert.ok(html.includes("Moy. entre 8,5 et 9,99"));
  assert.ok(html.includes("Moy. inf. à 08,50"));
  assert.ok(html.includes('rowspan="2"'));
  assert.ok(html.includes('colspan="2"'));
  assert.ok(html.includes("Document édité avec"));
  assert.ok(html.includes("total-row"));
});

test("RAPPORT 2 does not print unknown-status section when it is empty", () => {
  const cls = schoolFixture();
  cls.students = cls.students.filter(s => s.isAffected !== null);
  const html = buildSchoolReportHtml({
    classes: [cls], kind: "nominal", filter: "all",
    academicYear: "2026-2027", periodLabel: "2e trimestre", track: "french",
  });
  assert.ok(html.includes("MOY T2"));
  assert.ok(html.includes('des élèves non affectés</span> par classe'));
  assert.ok(!html.includes("à affectation non renseignée"));
});


test("ordinary secondary school never shows foreign teaching tracks", () => {
  const classes = [{ id: "6eA", level: "6ème" }];
  assert.deepEqual(reportTracksForSelection(null, classes, ""), ["french"]);
  assert.deepEqual(reportTracksForSelection({}, classes, "6eA"), ["french"]);
  assert.deepEqual(reportTracksForSelection({ school_cycles_v1: { version: 1, enabled: false } }, classes, ""), ["french"]);
});

test("franco-arabic school exposes only the tracks configured for the selected class scope", () => {
  const config = {
    school_cycles_v1: {
      version: 1, enabled: true,
      enabledCycles: ["primary", "secondary"],
      classCycleById: {},
      teachingTracksByCycle: { primary: ["french", "arabic"], secondary: ["french"] },
    },
  };
  const classes = [{ id: "cp1", level: "CP1" }, { id: "6eA", level: "6ème" }];
  assert.deepEqual(reportTracksForSelection(config, classes, "cp1"), ["french", "arabic"]);
  assert.deepEqual(reportTracksForSelection(config, classes, "6eA"), ["french"]);
  // Ne pas proposer un rapport arabe pour une sélection globale incluant le secondaire général.
  assert.deepEqual(reportTracksForSelection(config, classes, ""), ["french"]);
});

test("Arabic-only school uses Arabic without a French dropdown", () => {
  const config = {
    school_cycles_v1: {
      version: 1, enabled: true, enabledCycles: ["primary"],
      teachingTracksByCycle: { primary: ["arabic"] },
    },
  };
  assert.deepEqual(reportTracksForSelection(config, [{ id: "cp1", level: "CP1" }], "cp1"), ["arabic"]);
  assert.deepEqual(reportTracksForSelection(config, [{ id: "cp1", level: "CP1" }], ""), ["arabic"]);
});
