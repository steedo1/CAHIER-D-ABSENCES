import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveTeachingDirectorGrant } from "../src/lib/school-director-scope";

const institutionId = "2b897cd4-e1c3-40c3-9569-03e01e1877b4";
const a = { institution_id: institutionId, teaching_track: "arabic", is_active: true };
const f = { institution_id: institutionId, teaching_track: "french", is_active: true };
const role = { role: "teaching_director", institution_id: institutionId };

test("directors' French and Arabic roles are separate appointments across the entire school", () => {
  assert.equal(resolveTeachingDirectorGrant({ institutionId, roles: [role], appointments: [a] }), "arabic");
  assert.equal(resolveTeachingDirectorGrant({ institutionId, roles: [role], appointments: [f] }), "french");
  // A client cannot select between two responsibilities implicitly.
  assert.equal(resolveTeachingDirectorGrant({ institutionId, roles: [role], appointments: [a, f] }), null);
});

test("mixed admin/teacher rights cannot be misrepresented as a scoped direction", () => {
  for (const other of ["admin", "teacher", "finance_manager", "founder", "educator"]) {
    assert.equal(resolveTeachingDirectorGrant({
      institutionId,
      roles: [role, { ...role, role: other }],
      appointments: [a],
    }), null);
  }
  assert.equal(resolveTeachingDirectorGrant({ institutionId, roles: [{ ...role, role: "admin" }], appointments: [a] }), null);
});

test("revocation, foreign school and unauthorized teaching deny by default", () => {
  assert.equal(resolveTeachingDirectorGrant({ institutionId, roles: [role], appointments: [{ ...a, is_active: false }] }), null);
  assert.equal(resolveTeachingDirectorGrant({
    institutionId, roles: [role], appointments: [{ ...a, institution_id: "another-school" }],
  }), null);
  assert.equal(resolveTeachingDirectorGrant({
    institutionId, roles: [role], appointments: [{ ...a, teaching_track: "spanish" }],
  }), null);
  assert.equal(resolveTeachingDirectorGrant({
    institutionId, roles: [{ ...role, institution_id: "another-school" }], appointments: [a],
  }), null);
});

test("classic school UI unchanged; new nomination is strictly opt-in", () => {
  const read = path => readFileSync(path, "utf8");
  const users = read("src/app/admin/users/page.tsx");
  const api = read("src/app/api/admin/school-directors/route.ts");
  const sql = read("supabase/migrations/20261018014000_school_teaching_directors_role.sql");
  const restricted = read("src/app/direction-enseignement/page.tsx");
  assert.match(users, /navigation\.settings\.enabledCycles\.some\(cycle/);
  assert.match(users, /SchoolTeachingDirectorsManager/);
  assert.match(api, /not_franco_arabic_school/);
  assert.match(api, /requireInstitutionRole\(client, service, \["admin"\]\)/);
  assert.match(restricted, /requireTeachingDirector\(client, service\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON public\.school_teaching_directors/);
  assert.doesNotMatch(read("src/app/admin/ui/sidebar-nav.tsx"), /direction-enseignement/);
});
