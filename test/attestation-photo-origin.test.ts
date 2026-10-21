import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { attestationPhotoUrlForCurrentOrigin } from "../src/lib/attestation-photo-url";

const id = "12345678-1234-4abc-9876-123456789abc";
const route = `/api/media/student-photo/${id}`;

test("a Render-origin photo uses the viewer's official domain for authenticated printing", () => {
  const sourceUrl = `https://mon-cahier-test.onrender.com${route}?v=1761033600000`;
  assert.equal(
    attestationPhotoUrlForCurrentOrigin(sourceUrl, "https://www.mon-cahier.com"),
    `https://www.mon-cahier.com${route}?v=1761033600000`,
  );
});

test("an old domain URL is rebound to the active Render test host", () => {
  assert.equal(
    attestationPhotoUrlForCurrentOrigin(`https://www.mon-cahier.com${route}`, "https://mon-cahier-test.onrender.com"),
    `https://mon-cahier-test.onrender.com${route}`,
  );
});

test("relative private photo routes work inside blob: print documents", () => {
  assert.equal(
    attestationPhotoUrlForCurrentOrigin(route, "https://www.mon-cahier.com"),
    `https://www.mon-cahier.com${route}`,
  );
});

test("non-photo addresses and unsafe schemes cannot be injected into attestations", () => {
  for (const candidate of [
    null,
    "",
    "https://third-party.example/file.png",
    "javascript:alert(1)",
    "data:image/png;base64,abc",
    "https://third-party.example/api/media/student-photo/not-a-uuid",
    "/api/admin/private",
  ]) {
    assert.equal(attestationPhotoUrlForCurrentOrigin(candidate, "https://www.mon-cahier.com"), null);
  }
});

test("HTTP localhost preview remains possible without exposing storage objects", () => {
  assert.equal(
    attestationPhotoUrlForCurrentOrigin(route, "http://localhost:3000"),
    `http://localhost:3000${route}`,
  );
});

test("attestation uses the browser origin and waits for image readiness before printing", () => {
  const ui = readFileSync(new URL("../src/app/admin/parents/page.tsx", import.meta.url), "utf8");
  assert.match(ui, /attestationPhotoUrlForCurrentOrigin\(\s*student\.photo_url \|\| student\.student_photo_url,\s*window\.location\.origin,/);
  assert.match(ui, /document\.querySelectorAll\("\.student-photo-img"\)/);
  assert.match(ui, /await Promise\.all\(photos\.map\(imageReady\)\)/);
  assert.match(ui, /img\.decode\(\)/);
  assert.match(ui, /window\.print\(\)/);
});
