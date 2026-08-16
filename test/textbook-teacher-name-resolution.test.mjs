import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const monitorRoute = fs.readFileSync(
  new URL("../src/app/api/admin/textbook/monitor/route.ts", import.meta.url),
  "utf8",
);

const bootstrapRoute = fs.readFileSync(
  new URL("../src/app/api/teacher/textbook/bootstrap/route.ts", import.meta.url),
  "utf8",
);

for (const [label, source] of [
  ["monitoring admin", monitorRoute],
  ["bootstrap enseignant", bootstrapRoute],
]) {
  test(`${label} résout les noms comme les bulletins`, () => {
    assert.match(source, /\.from\("profiles"\)\.select\("id,display_name"\)/);
    assert.match(source, /\.from\("teachers"\)\.select\("id,full_name"\)/);
    assert.doesNotMatch(
      source,
      /select\("id,display_name,full_name,first_name,last_name"\)/,
    );
    assert.match(source, /teacherNames\.has\(id\)/);
  });
}
