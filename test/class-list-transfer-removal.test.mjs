import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  safeEnrollmentEndDate,
  studentMatchesIdentity,
} from "../src/lib/student-class-membership.ts";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("la recherche d'identité exige le nom et au moins un prénom", () => {
  const student = {
    last_name: "N'GUESSAN",
    first_name: "Élodie Ange-Marie",
  };

  assert.equal(
    studentMatchesIdentity(student, {
      lastName: "n guessan",
      firstName: "Elodie",
    }),
    true,
  );
  assert.equal(
    studentMatchesIdentity(student, {
      lastName: "N'GUESSAN",
      firstName: "Ange Marie",
    }),
    true,
  );
  assert.equal(
    studentMatchesIdentity(student, {
      lastName: "GUESSAN",
      firstName: "Élodie",
    }),
    false,
  );
  assert.equal(
    studentMatchesIdentity(student, {
      lastName: "N'GUESSAN",
      firstName: "",
    }),
    false,
  );
});

test("le transfert par identité reste une sélection explicite par identifiant", async () => {
  const route = await source("src/app/api/admin/students/search/route.ts");
  const page = await source("src/app/admin/parents/page.tsx");

  assert.match(route, /searchParams\.get\("last_name"\)/);
  assert.match(route, /searchParams\.get\("first_name"\)/);
  assert.match(route, /studentMatchesIdentity/);
  assert.match(route, /ambiguous: identitySearch \? items\.length > 1/);
  assert.match(page, /Plusieurs élèves portent cette identité/);
  assert.match(page, /if \(selectedStu\?\.id\) \{[\s\S]{0,180}?student_id: selectedStu\.id/);
});

test("le retrait ne ferme jamais une inscription avant son début", () => {
  assert.equal(safeEnrollmentEndDate("2026-09-09", "2026-08-31"), "2026-09-09");
  assert.equal(safeEnrollmentEndDate("2026-08-01", "2026-08-31"), "2026-08-31");
  assert.equal(safeEnrollmentEndDate(null, "2026-08-31"), "2026-08-31");
});

test("retirer ferme uniquement l'inscription et préserve l'élève et sa finance", async () => {
  const route = await source("src/app/api/admin/enrollments/remove/route.ts");

  assert.match(route, /safeEnrollmentEndDate\(activeEnrollment\.start_date, today\)/);
  assert.match(route, /\.eq\("id", activeEnrollment\.id\)/);
  assert.doesNotMatch(route, /\.from\("students"\)/);
  assert.doesNotMatch(route, /\.from\("student_charges"\)/);
  assert.doesNotMatch(route, /\.from\("receipts"\)/);
  assert.doesNotMatch(route, /\.delete\(\)/);
});
