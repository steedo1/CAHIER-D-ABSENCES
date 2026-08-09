import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("le manifeste installe Mon Cahier avec des icônes 192 et 512", async () => {
  const [manifest, layout] = await Promise.all([
    read("src/app/manifest.ts"),
    read("src/app/layout.tsx"),
  ]);

  assert.match(manifest, /name:\s*"Mon Cahier"/);
  assert.match(manifest, /short_name:\s*"Mon Cahier"/);
  assert.match(manifest, /display:\s*"standalone"/);
  assert.match(manifest, /\/icons\/icon-192\.png/);
  assert.match(manifest, /\/icons\/icon-512\.png/);
  assert.match(manifest, /purpose:\s*"maskable"/);
  assert.match(layout, /manifest:\s*"\/manifest\.webmanifest"/);
});

test("l'inscription du service worker utilise une URL stable sans version de commit", async () => {
  const [offline, registrar] = await Promise.all([
    read("src/lib/offline.ts"),
    read("src/components/ServiceWorkerRegistrar.tsx"),
  ]);

  assert.match(offline, /MON_CAHIER_SW_URL = "\/moncahier-sw\.js"/);
  assert.doesNotMatch(offline, /moncahier-sw\.js\?v=/);
  assert.match(offline, /updateViaCache:\s*"none"/);
  assert.match(offline, /SERVICE_WORKER_READY_TIMEOUT_MS = 12_000/);
  assert.match(offline, /Promise\.race/);
  assert.match(registrar, /registration\?\.update/);
  assert.doesNotMatch(registrar, /location\.reload/);
});

test("les releases Web et worker ne décident plus de la compatibilité métier", async () => {
  const [coherence, readiness, card] = await Promise.all([
    read("src/lib/offlineClassDevice.ts"),
    read("src/lib/offline-readiness.ts"),
    read("src/components/OfflineReadinessCard.tsx"),
  ]);

  assert.match(coherence, /offline_schema_stale/);
  assert.match(coherence, /readiness\.version === 5\s*\? 1/);
  assert.doesNotMatch(
    coherence,
    /readiness\.web_release !== input\.expected_web_release[\s\S]{0,100}return "web_release_stale"/,
  );
  assert.match(readiness, /migrateOfflineReadinessSchema/);
  assert.match(card, /Appels hors ligne prêts/);
  assert.doesNotMatch(card, /La version Web de cet appareil est ancienne/);
  assert.doesNotMatch(card, /mise à jour disponible/);
});

test("le service worker migre les anciens caches avant leur suppression", async () => {
  const worker = await read("public/moncahier-sw.js");

  assert.match(worker, /const CACHE_VERSION = "v2"/);
  assert.match(worker, /migrateLegacyCaches/);
  assert.match(worker, /name\.startsWith\("moncahier:"\)/);
  assert.match(worker, /await migrateLegacyCaches\(\)/);
  assert.match(worker, /\/icons\/icon-192\.png/);
  assert.match(worker, /\/icons\/badge-72\.png/);
  assert.doesNotMatch(worker, /shell-\$\{VERSION\}/);
  assert.doesNotMatch(worker, /assets-\$\{VERSION\}/);
});

test("la génération des icônes utilise l'image de marque déjà présente", async () => {
  const script = await read("scripts/generate-pwa-icons.ps1");

  assert.match(script, /public\/favicon\.png/);
  assert.match(script, /icon-192\.png/);
  assert.match(script, /icon-512\.png/);
  assert.match(script, /HighQualityBicubic/);
});


test("l'ancien service worker générique est retiré du projet", async () => {
  await assert.rejects(access(new URL("../public/sw.js", import.meta.url)));

  const applyScript = await read("scripts/apply-lot4-pwa.ps1");
  assert.match(applyScript, /public\/sw\.js/);
  assert.match(applyScript, /generate-pwa-icons\.ps1/);
});
