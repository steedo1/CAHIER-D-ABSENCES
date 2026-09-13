import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routePath = "src/app/api/media/student-photo/[studentId]/route.ts";

function readRoute() {
  return readFileSync(routePath, "utf8");
}

test("le correspondant fichier peut charger les photos protegees des eleves", () => {
  const route = readRoute();

  assert.match(
    route,
    /const INSTITUTION_ROLES = new Set\(\[[\s\S]*?["']file_correspondent["'][\s\S]*?\]\)/,
  );
  assert.match(route, /roleMatchesInstitution\([\s\S]*institutionId/);
});

test("la route photo reste privee et refuse les utilisateurs non autorises", () => {
  const route = readRoute();

  assert.match(route, /if \(!user\)[\s\S]*401/);
  assert.match(route, /if \(!institutionalAccess && !guardianAccess\)[\s\S]*403/);
  assert.match(route, /Cache-Control["']?:\s*["']private, no-store, max-age=0["']/);
});
