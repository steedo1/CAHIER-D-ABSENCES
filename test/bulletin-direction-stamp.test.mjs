import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { schoolCardFixture, request } from "./helpers/school-card-fixture.mjs";
import { pickBulletinDirectionStamp } from "../src/lib/bulletin-direction-stamp.ts";

process.env.SCHOOL_CARDS_ENABLED = "true";
const endpoint = "src/app/api/admin/institution/bulletin-direction-stamp/route.ts";
const schoolCardSettings = "src/app/api/admin/school-cards/settings/route.ts";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/k98AAAAASUVORK5CYII=", "base64");

test("direction seal requires a pre-registered private school image and explicit opt-in", async () => {
  const db = schoolCardFixture(1);
  const api = db.admin(endpoint);
  const initially = await (await api.GET()).json();
  assert.equal(initially.enabled, false);
  assert.deepEqual(initially.stamps, {});
  assert.equal((await api.POST(request("/api/admin/institution/bulletin-direction-stamp", { enabled: true }))).status, 409);

  const save = await db.admin(schoolCardSettings).PUT(request("/api/admin/school-cards/settings",
    { revision: 0, enabled: true, automaticSignature: false }, "PUT"));
  assert.equal(save.status, 200);
  const config = db.tables.school_card_settings[0].configuration;
  const path = `school-cards/${db.legacyId}/general/stamps/test/processed.png`;
  config.stamps = { general: { original: path, processed: path, updatedAt: new Date().toISOString() } };
  db.files.set(path, png);

  const activate = await api.POST(request("/api/admin/institution/bulletin-direction-stamp", { enabled: true }));
  assert.equal(activate.status, 200);
  const active = await (await api.GET()).json();
  assert.equal(active.enabled, true);
  assert.equal(active.available.general, true);
  assert.match(active.stamps.general, /^data:image\/png;base64,/);
  assert.equal(JSON.stringify(active).includes(path), false, "private storage path never reaches the client");

  const last = db.tables.school_card_settings[0].revision;
  const keep = await db.admin(schoolCardSettings).PUT(request("/api/admin/school-cards/settings",
    { revision: last, enabled: true, automaticSignature: true }, "PUT"));
  assert.equal(keep.status, 200);
  assert.equal(db.tables.school_card_settings[0].configuration.documentPolicies.bulletins, true,
    "saving card options must never disable the bulletin seal");

  const educator = db.addActor("educator");
  assert.equal((await db.load(educator)(endpoint).POST(
    request("/api/admin/institution/bulletin-direction-stamp", { enabled: false }))).status, 403);
  assert.equal((await api.POST(request("/api/admin/institution/bulletin-direction-stamp", { enabled: false },
    "POST", { origin: "https://attacker.invalid" }))).status, 403);

  assert.equal((await api.POST(request("/api/admin/institution/bulletin-direction-stamp", { enabled: false }))).status, 200);
  const disabled = await (await api.GET()).json();
  assert.equal(disabled.enabled, false);
  assert.deepEqual(disabled.stamps, {});
});

test("stamp selection never crosses bilingual French/Arabic teaching tracks", () => {
  const stamps = { general: "data:image/png;base64,g", french: "data:image/png;base64,f", arabic: "data:image/png;base64,a" };
  assert.equal(pickBulletinDirectionStamp(stamps, "general", true), stamps.general);
  assert.equal(pickBulletinDirectionStamp(stamps, "french", true), stamps.french);
  assert.equal(pickBulletinDirectionStamp(stamps, "arabic", true), stamps.arabic);
  assert.equal(pickBulletinDirectionStamp({ general: stamps.general }, "arabic", true), null);
  assert.equal(pickBulletinDirectionStamp({ french: stamps.french }, "arabic", true), null);
  assert.equal(pickBulletinDirectionStamp({ general: stamps.general }, "arabic", false), stamps.general);
});

test("both print workflows use the direction stamp but not the teacher-signature toggle", () => {
  const root = new URL("../", import.meta.url);
  const page = readFileSync(new URL("src/app/admin/bulletins/page.tsx", root), "utf8");
  const panel = readFileSync(new URL("src/components/bulletins/SpecializedBulletinPanel.tsx", root), "utf8");
  const document = readFileSync(new URL("src/components/bulletins/FrancoArabicBulletin.tsx", root), "utf8");
  assert.match(page, /directionStampPng=\{directionStamps\.general \|\| null\}/);
  assert.match(page, /directionStamps=\{directionStamps\}/);
  assert.match(page, /Cachet de direction sur les bulletins/);
  assert.match(panel, /pickBulletinDirectionStamp/);
  assert.match(document, /!model\.sample && !model\.draft/);
});
