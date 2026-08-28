import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const helper = source("src/lib/general-secondary-class-equivalence.ts");
const classesRoute = source("src/app/api/admin/classes/route.ts");
const studentsRoute = source("src/app/api/admin/students/route.ts");

test("1D1 et 1eD1 partagent une identité de classe de Première D", () => {
  assert.match(helper, /PREMIERE\|1ERE\|1RE\|1E\|1/);
  assert.match(helper, /GENERAL:PREMIERE/);
  assert.match(helper, /choosePreferredEquivalentClass/);
  assert.match(helper, /dedupeEquivalentGeneralSecondaryClasses/);
});

test("la liste des classes masque les alias de Première sans toucher aux autres filières", () => {
  assert.match(classesRoute, /isGeneralSecondaryClassRow/);
  assert.match(classesRoute, /dedupeGeneralSecondaryAliasesByAcademicYear/);
  assert.match(classesRoute, /dedupeEquivalentGeneralSecondaryClasses/);
  assert.match(classesRoute, /classIdParam\s*\?\s*sourceRows/);
});

test("la liste des élèves rattache les inscriptions alias à la classe canonique", () => {
  assert.match(studentsRoute, /buildCanonicalGeneralSecondaryClassMaps/);
  assert.match(studentsRoute, /generalSecondaryClassSemanticKey/);
  assert.match(studentsRoute, /canonicalIdById\.get\(rawClassId\)/);
  assert.match(studentsRoute, /class_id:\s*canonicalClassId/);
  assert.match(studentsRoute, /class_label:\s*\(canonicalClass\?\.label/);
});

test("la canonicalisation reste bornée par année scolaire", () => {
  assert.match(classesRoute, /byAcademicYear/);
  assert.match(studentsRoute, /\$\{academicYear\}::\$\{generalSecondaryClassSemanticKey\(row\)\}/);
});
