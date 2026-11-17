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


test("the exact same private image is usable on cards and on report cards", async () => {
  const db = schoolCardFixture(1);
  const settings = db.admin(schoolCardSettings);
  assert.equal((await settings.PUT(request("/api/admin/school-cards/settings",
    { revision: 0, enabled: true, automaticSignature: true }, "PUT"))).status, 200);
  const configuration = db.tables.school_card_settings[0].configuration;
  const file = `school-cards/${db.legacyId}/general/stamps/same-image/processed.png`;
  configuration.stamps = { general: { original: file, processed: file, updatedAt: new Date().toISOString() } };
  db.files.set(file, png);
  const schoolCards = db.admin("src/lib/server/school-cards.ts");
  const ctx = await schoolCards.cardScope(false);
  const cardStamp = await schoolCards.cardStampImages(ctx, new Set(["general"]));
  assert.equal(cardStamp.general, `data:image/png;base64,${png.toString("base64")}`);

  const api = db.admin(endpoint);
  assert.equal((await api.POST(request("/api/admin/institution/bulletin-direction-stamp",
    { enabled: true }))).status, 200);
  const bulletinStamp = await (await api.GET()).json();
  assert.equal(bulletinStamp.stamps.general, cardStamp.general);
  assert.equal(db.tables.school_card_settings[0].configuration.automaticSignature, true);
});

test("EPC French and Arabic report cards keep independent private stamps", async () => {
  const db = schoolCardFixture(2, true);
  const setup = await db.admin(schoolCardSettings).PUT(request("/api/admin/school-cards/settings",
    { revision: 0, enabled: true, automaticSignature: true }, "PUT"));
  assert.equal(setup.status, 200);
  const config = db.tables.school_card_settings[0].configuration;
  const frenchPath = `school-cards/${db.legacyId}/french/stamps/only-fr/processed.png`;
  const arabicPath = `school-cards/${db.legacyId}/arabic/stamps/only-ar/processed.png`;
  config.stamps = {
    french: { original: frenchPath, processed: frenchPath, updatedAt: new Date().toISOString() },
    arabic: { original: arabicPath, processed: arabicPath, updatedAt: new Date().toISOString() },
  };
  db.files.set(frenchPath, png);
  db.files.set(arabicPath, Buffer.concat([png.subarray(0, png.length - 1), Buffer.from([1])]));
  const api = db.admin(endpoint);
  assert.equal((await api.POST(request("/api/admin/institution/bulletin-direction-stamp", { enabled: true }))).status, 200);
  const { stamps } = await (await api.GET()).json();
  assert.equal(pickBulletinDirectionStamp(stamps, "french", true), stamps.french);
  assert.equal(pickBulletinDirectionStamp(stamps, "arabic", true), stamps.arabic);
  assert.notEqual(stamps.french, stamps.arabic);
  assert.equal(pickBulletinDirectionStamp(stamps, "general", true), null);
  // Arabic never inherits a French stamp, even when the general stamp is missing.
  assert.equal(pickBulletinDirectionStamp({ french: stamps.french }, "arabic", true), null);
});

test("existing direct Supabase CSCA PNG is accepted only within its own institution and shared by cards/bulletins", async () => {
  const db = schoolCardFixture(1);
  const settings = db.admin(schoolCardSettings);
  const saved = await settings.PUT(request("/api/admin/school-cards/settings",
    { revision: 0, enabled: true, automaticSignature: true }, "PUT"));
  assert.equal(saved.status, 200);

  const direct = `${db.legacyId}/cachet-signature-directeur-csca-2026-11-17.png`;
  const foreign = `00000000-0000-4000-8000-000000000000/cachet-signature-directeur-other.png`;
  const cardServer = db.admin("src/lib/server/school-cards.ts");
  const asset = { original: direct, processed: direct, updatedAt: new Date().toISOString() };
  assert.equal(cardServer.safeCardAsset(db.legacyId, asset), true);
  assert.equal(cardServer.safeCardAsset(db.legacyId, { ...asset, processed: foreign }), false);
  assert.equal(cardServer.safeCardAsset(db.legacyId, { ...asset, original: foreign }), false);
  assert.equal(cardServer.safeCardAsset(db.legacyId, {
    ...asset, processed: `${db.legacyId}/other.png`, original: `${db.legacyId}/other.png`,
  }), false);
  assert.equal(cardServer.safeCardAsset(db.legacyId, {
    ...asset, processed: `${db.legacyId}/cachet-signature-directeur-../other.png`,
    original: `${db.legacyId}/cachet-signature-directeur-../other.png`,
  }), false);

  db.files.set(direct, png);
  db.tables.school_card_settings[0].configuration.stamps = { general: asset };
  const ctx = await cardServer.cardScope(false);
  const stampOnCards = await cardServer.cardStampImages(ctx, new Set(["general"]));
  assert.equal(stampOnCards.general, `data:image/png;base64,${png.toString("base64")}`);

  const api = db.admin(endpoint);
  const initial = await (await api.GET()).json();
  assert.equal(initial.available.general, true);
  assert.equal(initial.enabled, false);
  assert.equal((await api.POST(request("/api/admin/institution/bulletin-direction-stamp",
    { enabled: true }))).status, 200);
  const bulletin = await (await api.GET()).json();
  assert.equal(bulletin.stamps.general, stampOnCards.general);
  assert.equal(JSON.stringify(bulletin).includes(direct), false);
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
  assert.ok(page.includes('className="max-h-[98px] max-w-[96%] object-contain"'),
    "the existing direction stamp grows from 82px to 98px without resizing the visa container");
  const visaStart = page.indexOf('className="bdr visa-card head-visa-card');
  const stamp = page.indexOf('alt="Cachet et signature de la direction"', visaStart);
  const directorName = page.indexOf('institution?.institution_head_name && (', stamp);
  assert.ok(visaStart >= 0 && stamp > visaStart && directorName > stamp,
    "the enlarged stamp stays inside the director visa, above the director name");

  assert.match(panel, /pickBulletinDirectionStamp/);
  assert.ok(page.includes("selectedSecondaryTrack, specializedBulletins?.school?.isFrancoArabic !== false"));
  assert.ok(panel.includes("data.school?.isFrancoArabic !== false"));
  assert.match(document, /!model\.sample && !model\.draft/);
});
