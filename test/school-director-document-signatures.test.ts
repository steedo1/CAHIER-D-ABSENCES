import assert from "node:assert/strict";
import test from "node:test";
import { schoolTeachingSignatories } from "../src/lib/server/school-director-signatories";
import { createMulticycleFixture } from "./helpers/multicycle-fixture.mjs";

test("franco-arabic official documents use names of nominated directors, independently by track", async () => {
  const db = createMulticycleFixture();
  const arabicId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11";
  const frenchId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22";
  db.tables.profiles.push(
    { id: arabicId, institution_id: db.legacyId, display_name: "Traoré Daouda" },
    { id: frenchId, institution_id: db.legacyId, display_name: "Nimaga Adam Ousmane" },
  );
  db.tables.school_teaching_directors = [
    { institution_id: db.legacyId, profile_id: arabicId, teaching_track: "arabic", is_active: true },
    { institution_id: db.legacyId, profile_id: frenchId, teaching_track: "french", is_active: true },
    { institution_id: "other-school", profile_id: "ignored", teaching_track: "french", is_active: true },
  ];
  const names = await schoolTeachingSignatories(db.service, db.legacyId);
  assert.equal(names.arabic?.name, "Traoré Daouda");
  assert.equal(names.french?.name, "Nimaga Adam Ousmane");
  assert.match(names.arabic?.title || "", /arabe/);
  assert.match(names.french?.title || "", /français/);
});

test("inactive, unnamed or non-existent directors are never presented as signing authorities", async () => {
  const db = createMulticycleFixture();
  assert.deepEqual(await schoolTeachingSignatories(db.service, db.legacyId), {});
  db.tables.school_teaching_directors = [
    { institution_id: db.legacyId, profile_id: db.legacyAdminId, teaching_track: "arabic", is_active: false },
  ];
  assert.deepEqual(await schoolTeachingSignatories(db.service, db.legacyId), {});
});
