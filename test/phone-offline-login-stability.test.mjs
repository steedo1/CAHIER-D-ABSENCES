import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la connexion hors ligne ne charge aucun chunk de vérification à la soumission", async () => {
  const client = await read("src/lib/offline-auth-client.ts");

  assert.match(
    client,
    /import \{ assertOfflineFunctionPrepared \} from "@\/lib\/offline-auth-readiness";/,
  );
  assert.doesNotMatch(
    client,
    /await import\(\s*["']@\/lib\/offline-auth-readiness["']\s*\)/,
  );
  assert.match(client, /await assertOfflineFunctionPrepared\(payload\)/);
});

test("le worker refuse d'activer une préparation incomplète de la page de connexion", async () => {
  const worker = await read("public/moncahier-sw.js");

  assert.match(worker, /2026-08-09-phone-offline-login-v5-6/);
  assert.match(worker, /await warmDocument\("\/login"\);/);
  assert.doesNotMatch(
    worker,
    /warmDocument\("\/login"\)\.catch\(\(\) => undefined\)/,
  );
  assert.match(worker, /const downloadedAssets = await Promise\.all/);
  assert.match(worker, /await shell\.put\(request, responseForCache\)/);
  const downloadIndex = worker.indexOf("const downloadedAssets = await Promise.all");
  const publishIndex = worker.indexOf(
    "await shell.put(request, responseForCache)",
    downloadIndex,
  );
  assert.ok(
    downloadIndex >= 0 && publishIndex > downloadIndex,
    "le HTML ne doit être publié qu'après le téléchargement complet des assets",
  );
});

test("le formulaire bascule toujours vers l'autorisation locale si le réseau échoue", async () => {
  const login = await read("src/components/auth/LoginCard.tsx");

  assert.match(login, /catch \{\s*await openOfflineSession\(\);\s*return;\s*\}/);
  assert.match(login, /window\.location\.assign\(authorized\.payload\.destination\)/);
});
