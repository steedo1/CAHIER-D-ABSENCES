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
  assert.match(page, /Plusieurs résultats correspondent au nom et au prénom saisis/);
  assert.match(page, /if \(selectedStu\?\.id\) \{[\s\S]{0,180}?student_id: selectedStu\.id/);
});

test("la date de fin d'un transfert ne précède jamais le début de l'inscription", () => {
  assert.equal(safeEnrollmentEndDate("2026-09-09", "2026-08-31"), "2026-09-09");
  assert.equal(safeEnrollmentEndDate("2026-08-01", "2026-08-31"), "2026-08-31");
  assert.equal(safeEnrollmentEndDate(null, "2026-08-31"), "2026-08-31");
});
