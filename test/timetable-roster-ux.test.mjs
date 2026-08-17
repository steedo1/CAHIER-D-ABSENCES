import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("sidebar exposes Emploi du temps without legacy import wording", () => {
  const source = read("src/app/admin/ui/sidebar-nav.tsx");
  assert.match(source, /label: "Emploi du temps"/);
  assert.doesNotMatch(source, /label: "Import emplois du temps"/);
});

test("class timetable occupancy is returned and teacher conflicts remain warnings", () => {
  const meta = read("src/app/api/admin/timetables/meta/route.ts");
  const manual = read("src/app/api/admin/timetables/manual/route.ts");
  const page = read("src/app/admin/import-emplois-du-temps/page.tsx");

  assert.match(meta, /occupancy,/);
  assert.match(meta, /teacher_timetables/);
  assert.match(manual, /teacherOccupancy/);
  assert.match(manual, /teacher_occupancy_failed/);
  assert.match(
    manual,
    /\.match\(\{\s*institution_id,\s*subject_id,\s*teacher_id,\s*class_id,\s*period_id,/s,
  );
  assert.match(page, /visibleOccupancyForCell/);
  assert.match(page, /conflictMessagesForClass/);
  assert.match(page, /Conflit signalé — enregistrement autorisé/);
  assert.match(page, /créneaux déjà occupés de cette classe/);
});

test("printed roster uses four blank note columns instead of unused columns", () => {
  const roster = (read("src/app/admin/classes/liste/[id]/page.tsx").split('<table className="roster-table">')[1] || "").split("</table>")[0];
  for (const label of ["Note1", "Note2", "Note3", "Note4"]) {
    assert.match(roster, new RegExp(`>${label}<`));
  }
  for (const label of ["Série", "Ext\\.", "LV2", "Nat"]) {
    assert.doesNotMatch(roster, new RegExp(`>${label}<`));
  }
  assert.match(roster, /<td className="col-series"><\/td>/);
  assert.match(roster, /<td className="col-board"><\/td>/);
  assert.match(roster, /<td className="col-lv2"><\/td>/);
  assert.match(roster, /<td className="col-nat"><\/td>/);
});
