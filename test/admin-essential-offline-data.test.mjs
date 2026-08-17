import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("les listes admin passent par une couche de lecture hors ligne dédiée", async () => {
  const page = await read("src/app/admin/parents/page.tsx");
  assert.match(page, /fetchAdminEssentialRoster/);
  assert.doesNotMatch(page, /fetch\("\/api\/admin\/classes\?limit=999"/);
  assert.doesNotMatch(page, /fetch\("\/api\/admin\/students"/);
});

test("la couche essentielle respecte Cloud puis relais puis cache", async () => {
  const source = await read("src/lib/admin-essential-offline.ts");
  assert.match(source, /source: "cloud"/);
  assert.match(source, /source: "relay"/);
  assert.match(source, /source: "cache"/);
  assert.match(source, /\/v1\/admin\/academic\/roster/);
});

test("le relais expose un roster admin institution-scopé", async () => {
  const server = await read("desktop/relay/src/server.mts");
  const roster = await read("desktop/relay/src/admin-academic-roster.mts");
  assert.match(server, /\/v1\/admin\/academic\/roster/);
  assert.match(server, /adminAcademicRoster/);
  assert.match(roster, /class_enrollments/);
  assert.match(roster, /students/);
  assert.match(roster, /classes/);
});

test("le conseil de classe réutilise la couche bulletin hors ligne pour ses lectures cœur", async () => {
  const council = await read("src/app/admin/notes/conseil-classe/page.tsx");
  assert.match(council, /getAdminBulletinClasses/);
  assert.match(council, /getAdminBulletinSettings/);
  assert.match(council, /getAdminBulletinPeriods/);
  assert.match(council, /getAdminBulletin/);
  assert.match(council, /getAdminBulletinConduct/);
});

test("le service worker versionne le cache admin essentiel pour éviter les vieux shells", async () => {
  const worker = await read("public/moncahier-sw.js");
  assert.match(worker, /admin-essential/);
  assert.match(worker, /isStaleAdminEssentialDocument/);
});
