import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync(new URL("../src/app/choose-book/page.tsx", import.meta.url), "utf8");

test("the teacher hub keeps all five existing notebook destinations", () => {
  for (const path of [
    "/redirect?book=attendance",
    "/redirect?book=grades",
    "/enseignant/cahier-de-texte",
    "/enseignant/autorisation-absence",
    "/enseignant/signature",
  ]) {
    assert.ok(ui.includes(path), "Missing notebook route: " + path);
  }
});

test("signature remains gated and offline notebook destinations remain protected", () => {
  assert.match(ui, /sigEligibility === "eligible"/);
  assert.match(ui, /aria-disabled="true"/);
  assert.match(ui, /validateOfflineBookDestination/);
  assert.match(ui, /resolveOfflineDest/);
  assert.match(ui, /handleReturnClick/);
});

test("lightweight mobile grid avoids 3D pointer tracking and new network dependencies", () => {
  assert.match(ui, /grid grid-cols-2 gap-3 sm:grid-cols-3/);
  assert.match(ui, /motion-reduce:transition-none/);
  assert.doesNotMatch(ui, /onMouseMove|ThreeDCard|rotateX|rotateY/);
  assert.match(ui, /fetch\("\/api\/teacher\/signature"/);
  assert.doesNotMatch(ui, /\/api\/(admin|supabase)\//);
});