import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const removal = read("src/app/api/admin/enrollments/remove/route.ts");
const studentApi = read("src/app/api/admin/students/[id]/route.ts");
const adminUi = read("src/app/admin/parents/ParentsClient.tsx");
const rosterApi = read("src/app/api/admin/classes/[id]/roster/route.ts");
const rosterUi = read("src/app/admin/classes/liste/[id]/page.tsx");

test("class withdrawal cannot hard-delete an EPC pupil or financial records", () => {
  assert.doesNotMatch(removal, /delete_student_completely_v1/);
  assert.match(removal, /update\(\{ end_date: today \}\)/);
  assert.match(removal, /deleted: false/);
  assert.match(adminUi, /Retirer de la classe/);
});

test("Arabic student fields are persisted and list order is Arabic", () => {
  for (const field of ["full_name_ar", "birthdate", "birth_place", "nationality"]) {
    assert.ok(studentApi.includes(field), field);
  }
  assert.match(adminUi, /isArabicClass \? "ar" : "fr"/);
  assert.match(rosterApi, /isArabicClass \? "ar" : "fr"/);
  assert.match(rosterUi, /isArabicClass \? "ar" : "fr"/);
});

test("Arabic collation distinguishes Arabic script independently of French", () => {
  const list = ["يوسف", "أحمد", "سعيد"];
  const expected = ["أحمد", "سعيد", "يوسف"];
  assert.deepEqual([...list].sort(new Intl.Collator("ar").compare), expected);
});
