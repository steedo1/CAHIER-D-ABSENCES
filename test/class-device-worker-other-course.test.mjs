import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { execFileSync } from "node:child_process";

const worker = process.env.MON_CAHIER_AUDIT_BASELINE === "1"
  ? execFileSync("git", ["show", "c68bae86:public/moncahier-sw.js"], { encoding: "utf8" })
  : fs.readFileSync(new URL("../public/moncahier-sw.js", import.meta.url), "utf8");

function setup(fetcher) {
  const handlers = {};
  const context = vm.createContext({
    self: { location: { origin: "https://fixture.invalid" }, addEventListener(type, handler) { handlers[type] = handler; } },
    fetch: fetcher, URL, Response, Request, Headers, AbortController, setTimeout, clearTimeout,
    console, caches: {},
  });
  vm.runInContext(worker, context);
  const request = (query) => new Request(`https://fixture.invalid/api/class/subjects?class_id=3e1${query}`, {
    referrer: "https://fixture.invalid/class",
  });
  return { context, handlers, request };
}

test("le vrai worker transmet Autre cours au Cloud depuis /class, avec ou sans créneau", async () => {
  let calls = 0;
  const f = setup(async () => { calls++; return Response.json({ items: [{ id: "info", label: "Informatique" }] }); });
  for (const query of ["&manual_course=1", "&manual_course=1&slot=1|09:00|10:00"]) {
    const request = f.request(query);
    const response = await f.context.classDeviceSubjectsResponse(request, new URL(request.url));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).items[0].id, "info");
  }
  assert.equal(calls, 2);
});

test("le mode automatique sans créneau reste fermé et ne lance aucune requête", async () => {
  const f = setup(async () => { throw new Error("ne doit pas être appelé"); });
  const request = f.request("");
  const response = await f.context.classDeviceSubjectsResponse(request, new URL(request.url));
  assert.deepEqual((await response.json()).items, []);
});

test("hors connexion, le worker ne remplace pas le cache manuel authentifié par une liste vide", async () => {
  const f = setup(async () => { throw new TypeError("Failed to fetch"); });
  const request = f.request("&manual_course=1");
  const response = await f.context.classDeviceSubjectsResponse(request, new URL(request.url));
  assert.equal(response.status, 503);
  assert.ok((await response.json()).error);
});

test("un refus d'autorisation Cloud reste autoritaire en mode exceptionnel", async () => {
  const f = setup(async () => Response.json({ error: "forbidden_not_class_device" }, { status: 403 }));
  const request = f.request("&manual_course=1");
  const response = await f.context.classDeviceSubjectsResponse(request, new URL(request.url));
  assert.equal(response.status, 403);
});
