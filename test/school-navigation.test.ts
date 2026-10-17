import assert from "node:assert/strict";
import test from "node:test";
import { parseSchoolCyclesSettings } from "../src/lib/school-cycles";
import { readSchoolNavigation, resolveSchoolNavigation, withSchoolNavigation } from "../src/lib/school-navigation";

const settings = parseSchoolCyclesSettings({ school_cycles_v1: { version: 1, enabled: true,
  enabledCycles: ["primary", "secondary"], teachingTracksByCycle: { primary: ["french", "arabic"], secondary: ["french"] } } });
const classes = [{ id: "p1", label: "CP1 A", level: "CP1", cycle: "primary" as const },
  { id: "p2", label: "CM2 A", level: "CM2", cycle: "primary" as const },
  { id: "s1", label: "6e A", level: "6e", cycle: "secondary" as const }];

test("cycle, teaching, level and class survive module navigation and browser URLs", () => {
  const selection = resolveSchoolNavigation(settings, { cycle: "primary", track: "arabic", level: "CM2", classId: "p2" }, classes);
  const href = withSchoolNavigation("/admin/notes?tab=matrix#results", selection);
  const url = new URL(href, "https://example.invalid");
  assert.equal(url.searchParams.get("tab"), "matrix");
  assert.equal(url.hash, "#results");
  assert.deepEqual(resolveSchoolNavigation(settings, readSchoolNavigation(url.searchParams), classes), selection);
  assert.equal(url.searchParams.get("education_type"), null);
});

test("disabled programs, unknown levels, other-cycle classes and invalid cycles are discarded", () => {
  assert.deepEqual(resolveSchoolNavigation(settings, { cycle: "secondary", track: "arabic", level: "CM2", classId: "p2" }, classes),
    { cycle: "secondary", track: "french", level: "", classId: "" });
  assert.equal(resolveSchoolNavigation(settings, { cycle: "preschool" }, classes).cycle, "all");
  assert.equal(resolveSchoolNavigation(settings, { cycle: "primary", classId: "foreign-school" }, classes).classId, "");
});

test("a single cycle opens directly and only displays its configured teaching program", () => {
  const single = { ...settings, enabledCycles: ["primary" as const], teachingTracksByCycle: { primary: ["arabic" as const] } };
  assert.deepEqual(resolveSchoolNavigation(single, {}, classes), { cycle: "primary", track: "arabic", level: "", classId: "" });
});

test("explicit cycle destinations clear incompatible level/class; unrelated paths stay unchanged", () => {
  const context = resolveSchoolNavigation(settings, { cycle: "primary", track: "arabic", level: "CM2", classId: "p2" }, classes);
  const url = new URL(withSchoolNavigation("/admin/cycles?cycle=secondary", context), "https://example.invalid");
  assert.equal(url.searchParams.get("school_cycle"), "secondary");
  assert.equal(url.searchParams.has("school_level"), false);
  assert.equal(url.searchParams.has("school_class_id"), false);
  for (const href of ["https://example.invalid", "/super/dashboard", "/admin/../super/dashboard", "/parent"]) {
    assert.equal(withSchoolNavigation(href, context), href);
  }
});
