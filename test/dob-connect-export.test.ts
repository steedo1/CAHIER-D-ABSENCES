import assert from "node:assert/strict";
import test from "node:test";
import { buildDobConnectExport, DOB_CONNECT_HEADERS, dobConnectClassNumber, dobConnectDate } from "../src/lib/dob-connect-export";

test("DOB CONNECT conserve exactement les 14 colonnes et les codes du modèle", () => {
  const exportFile = buildDobConnectExport({
    institutionCode: "49611",
    classes: [
      { id: "c1", level: "6ème", label: "6ème 1", education_type: "general_secondary" },
      { id: "c2", level: "5ème", label: "5ème 2", education_type: "general_secondary" },
    ],
    students: [
      {
        id: "s1", class_id: "c1", matricule: "00123456A",
        last_name: "ADOU", first_name: "KOUAKOU AURITH CHRIST",
        gender: "M", birthdate: "2009-03-04", birth_place: "AGBOVILLE",
        nationality: "Ivoirien", is_affecte: true, is_repeater: false,
      },
      {
        id: "s2", class_id: "c2", matricule: "26155229R",
        last_name: "ABOA", first_name: "MARIE ANGE",
        gender: "F", birthdate: "2014-11-16", birth_place: "COCODY",
        nationality: "ETRANGERE", is_affecte: false, is_repeater: true,
      },
    ],
  });
  assert.deepEqual(exportFile.rows[0], [...DOB_CONNECT_HEADERS]);
  assert.equal(exportFile.rows[0].length, 14);
  assert.equal(exportFile.count, 2);
  assert.equal(exportFile.rows[1][0], 49611);
  assert.equal(exportFile.rows[1][1], "5ème"); // Tri niveaux, sans classe fictive
  assert.equal(exportFile.rows[1][2], 2);
  assert.equal(exportFile.rows[1][3], "26155229R");
  assert.equal(exportFile.rows[1][6], "F");
  assert.equal(exportFile.rows[1][10], "auto");
  assert.equal(exportFile.rows[1][11], "auto");
  assert.equal(exportFile.rows[1][12], "NAFF");
  assert.equal(exportFile.rows[1][13], 1);
  assert.equal(exportFile.rows[2][3], "00123456A"); // Matricule comme texte
  assert.equal(exportFile.rows[2][12], "AFF");
  assert.equal(exportFile.rows[2][13], 0);
  assert.ok(exportFile.rows[2][7] instanceof Date);
  assert.deepEqual(exportFile.missingClassNumbers, []);
});

test("Une classe sans numero ne reçoit jamais un NUM_CLASSE inventé", () => {
  assert.equal(dobConnectClassNumber({ id: "a", label: "6ème", level: "6ème" }), null);
  assert.equal(dobConnectClassNumber({ id: "b", label: "2nde C2", level: "2ndeC" }), 2);
  assert.equal(dobConnectClassNumber({ id: "c", label: "CP1", level: "CP1" }), null);
});

test("Les dates invalides sont vides et les codes sans valeur sont bloqués", () => {
  assert.equal(dobConnectDate("31/02/2021"), null);
  assert.equal(dobConnectDate(""), null);
  assert.throws(() => buildDobConnectExport({ institutionCode: "", classes: [], students: [] }), /code officiel/);
});

test("Les états d'affectation et de redoublement absents ne sont pas inventés", () => {
  const result = buildDobConnectExport({
    institutionCode: "00041",
    classes: [{ id: "c", label: "3ème", level: "3ème" }],
    students: [{ id: "x", class_id: "c", last_name: "K", first_name: "A" }],
  });
  assert.equal(result.rows[1][0], "00041");
  assert.equal(result.rows[1][2], null);
  assert.equal(result.rows[1][12], "none");
  assert.equal(result.rows[1][13], null);
  assert.deepEqual(result.missingClassNumbers, ["3ème"]);
});
