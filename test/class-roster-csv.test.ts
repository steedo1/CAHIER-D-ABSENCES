import assert from "node:assert/strict";
import test from "node:test";
import { buildOrdinaryClassRosterCsv, ordinaryClassRosterCsvFilename } from "../src/lib/class-roster-csv";
import { parseSchoolCyclesSettings } from "../src/lib/school-cycles";
import { isBilingualSchool } from "../src/lib/school-student-programs";

test("CSV exports the entire selected class, independently of pagination", () => {
  const students = Array.from({ length: 160 }, (_, i) => ({
    id: "student-" + i,
    class_id: i < 150 ? "6eme-A" : "5eme-A",
    last_name: "KOUASSI",
    first_name: "Élève " + String(i).padStart(3, "0"),
    matricule: "CSCA" + String(i).padStart(4, "0"),
    gender: "F",
    birthdate: "2011-09-03",
  }));
  const result = buildOrdinaryClassRosterCsv({
    classId: "6eme-A", classLabel: "6e A",
    academicYear: "2026-2027", students,
  });
  assert.equal(result.count, 150);
  assert.equal(result.csv.charCodeAt(0), 0xfeff);
  assert.equal(result.csv.trimEnd().split("\r\n").length, 151);
  assert.ok(result.csv.includes('"150";"CSCA0149"'));
  assert.ok(!result.csv.includes("CSCA0150"));
  assert.ok(result.csv.includes('"03/09/2011";"6e A";"2026-2027"'));
  assert.ok(result.csv.includes('"N°";"Matricule";"Nom";"Prénoms"'));
});

test("CSV protects spreadsheet cells and preserves accents, semicolons and quotes", () => {
  const { csv, count } = buildOrdinaryClassRosterCsv({
    classId: "classe", classLabel: "2nde C",
    academicYear: "2026-2027",
    students: [
      { id: "a", class_id: "other", last_name: "OUTSIDE", matricule: "EXCLUDE" },
      { id: "b", class_id: "classe", last_name: '=HYPERLINK("bad")',
        first_name: 'Élodie; "Test"', matricule: "+1234", birthdate: "2010-04-11" },
    ],
  });
  assert.equal(count, 1);
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('"Élodie; ""Test"""'));
  assert.ok(csv.includes('"\'+1234"'));
  assert.ok(!csv.includes("EXCLUDE"));
});

test("CSV filenames contain no unsafe paths or personal identifiers", () => {
  assert.equal(ordinaryClassRosterCsvFilename({
    institutionName: "Collège Privé Dieudonné",
    classLabel: "5e/1", academicYear: "2026-2027",
  }), "liste_classe_college_prive_dieudonne_5e_1_2026_2027.csv");
  assert.throws(() => buildOrdinaryClassRosterCsv({
    classId: "", classLabel: "5e1", academicYear: "2026-2027", students: [],
  }));
});

test("ordinary schools are eligible while bilingual schools are excluded", () => {
  assert.equal(isBilingualSchool(parseSchoolCyclesSettings({})), false);
  assert.equal(isBilingualSchool(parseSchoolCyclesSettings({
    school_cycles_v1: {
      version: 1, enabled: true, enabledCycles: ["primary"],
      teachingTracksByCycle: { primary: ["french"] },
    },
  })), false);
  assert.equal(isBilingualSchool(parseSchoolCyclesSettings({
    school_cycles_v1: {
      version: 1, enabled: true, enabledCycles: ["primary"],
      teachingTracksByCycle: { primary: ["french", "arabic"] },
    },
  })), true);
});
