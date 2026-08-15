import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function serviceWorkerContext(source) {
  const context = {
    AbortController,
    Headers,
    Request,
    Response,
    URL,
    clearTimeout,
    console,
    setTimeout,
    caches: {
      keys: async () => [],
      open: async () => ({}),
    },
    self: {
      addEventListener() {},
      clients: {},
      location: { origin: "https://www.mon-cahier.com" },
      registration: {},
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

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

test("le worker publie /login uniquement après une préparation atomique complète", async () => {
  const worker = await read("public/moncahier-sw.js");

  assert.match(worker, /2026-08-10-pwa-login-repeat-v5-7/);
  assert.match(worker, /await warmDocument\("\/login"\);/);
  assert.doesNotMatch(
    worker,
    /warmDocument\("\/login"\)\.catch\(\(\) => undefined\)/,
  );
  assert.match(worker, /const downloadedAssets = await Promise\.all/);
  assert.match(worker, /await shell\.put\(request, responseForCache\)/);

  const precacheStart = worker.indexOf("const PRECACHE_URLS = [");
  const precacheEnd = worker.indexOf("];", precacheStart);
  const precache = worker.slice(precacheStart, precacheEnd);
  assert.doesNotMatch(
    precache,
    /["']\/login["']/,
    "/login ne doit pas être publié par le précache générique avant ses chunks",
  );

  const navigationStart = worker.indexOf("async function navigationResponse");
  const navigationEnd = worker.indexOf("async function assetResponse", navigationStart);
  const navigation = worker.slice(navigationStart, navigationEnd);
  assert.doesNotMatch(
    navigation,
    /cache\.put\(request, response\.clone\(\)\)/,
    "une navigation en ligne ne doit pas écraser le dernier shell atomique",
  );

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

test("les chunks Next annoncés dans Flight/RSC sont préparés pour les connexions PWA répétées", async () => {
  const worker = await read("public/moncahier-sw.js");
  const context = serviceWorkerContext(worker);

  context.fixture = String.raw`
    <html>
      <head>
        <script src="/_next/static/chunks/main.abc.js"></script>
        <script>
          self.__next_f.push([1,"I[1,[\\"1753\\",\\"static/chunks/1753.3e0c736ff0780623.js\\",\\"22\\",\\"static/css/22.ab.css\\"]]"])
        </script>
      </head>
    </html>`;

  const assets = vm.runInContext(
    `Array.from(extractDocumentAssetUrls(fixture, new URL('/login', self.location.origin)))`,
    context,
  );

  assert.ok(
    assets.includes(
      "https://www.mon-cahier.com/_next/static/chunks/1753.3e0c736ff0780623.js",
    ),
    "le chunk 1753 déclaré dans les données Flight doit être détecté même sans src/href",
  );
  assert.ok(
    assets.includes("https://www.mon-cahier.com/_next/static/css/22.ab.css"),
  );
});

test("la release diagnostique Web annonce le même worker PWA v5-7", async () => {
  const release = await read("src/lib/offline-release.ts");
  assert.match(release, /2026-08-10-pwa-login-repeat-v5-7/);
});

test("un échec réseau retente le Cloud avant le secours hors ligne", async () => {
  const login = await read("src/components/auth/LoginCard.tsx");

  assert.match(login, /const AUTH_RETRY_TIMEOUT_MS = 15_000;/);

  const flowStart = login.indexOf("const loginRequest: RequestInit");
  const flowEnd = login.indexOf("const json =", flowStart);
  const onlineFlow = login.slice(flowStart, flowEnd);

  assert.ok(flowStart >= 0 && flowEnd > flowStart);
  assert.match(onlineFlow, /Connexion réseau instable, nouvelle tentative/);
  assert.match(onlineFlow, /AUTH_RETRY_TIMEOUT_MS/);
  assert.match(
    onlineFlow,
    /catch \{\s*await openOfflineSession\(\);\s*return;\s*\}/,
    "le hors ligne doit rester le secours après l'échec de la seconde tentative Cloud",
  );
  assert.match(login, /if \(onAuthenticated\) \{\s*await onAuthenticated\(authorized\.payload\.destination\);\s*return;\s*\}/);
  assert.match(login, /window\.location\.assign\(authorized\.payload\.destination\)/);
});

test("un 5xx Cloud garde le secours local sans masquer une préparation incomplète", async () => {
  const login = await read("src/components/auth/LoginCard.tsx");

  const errorStart = login.indexOf("if (!res.ok || !json.ok)");
  const serverEnd = login.indexOf("// Un 401/403 explicite", errorStart);
  const serverFailure = login.slice(errorStart, serverEnd);

  assert.ok(errorStart >= 0 && serverEnd > errorStart);
  assert.match(serverFailure, /if \(res\.status >= 500\)/);
  assert.match(
    serverFailure,
    /try \{\s*await openOfflineSession\(\);\s*return;\s*\} catch \{\s*throw new Error\("ONLINE_SERVICE_UNAVAILABLE"\);\s*\}/,
  );
  assert.match(
    login,
    /if \(value === "ONLINE_SERVICE_UNAVAILABLE"\)/,
  );
});

test("la réauthentification embarquée peut garder le runtime PWA chargé", async () => {
  const login = await read("src/components/auth/LoginCard.tsx");

  assert.match(
    login,
    /onAuthenticated\?: \(destination: string\) => void \| Promise<void>/,
  );
  assert.match(
    login,
    /if \(onAuthenticated\) \{\s*await onAuthenticated\(destination\);\s*return;/,
  );
});
