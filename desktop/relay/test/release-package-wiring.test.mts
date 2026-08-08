import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import test from "node:test";

async function read(path: string) {
  return fs.readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

async function readBytes(path: string) {
  return fs.readFile(new URL(`../${path}`, import.meta.url));
}

test("le paquet Windows est fabriqué depuis une liste blanche", async () => {
  const script = await read("windows/New-Relay-Package.ps1");
  assert.match(script, /npm\.cmd|NpmCommand/);
  assert.match(script, /run verify/);
  assert.match(script, /@\("migrations", "protocol", "scripts", "src", "windows"\)/);
  assert.match(script, /release-manifest\.json/);
  assert.match(script, /Assert-SafeZipEntries/);
  assert.doesNotMatch(script, /Copy-Item\s+\$RelayRoot\s+/);
});

test("installation et mise à jour refusent un paquet sans manifeste", async () => {
  const [install, update, validation] = await Promise.all([
    read("windows/install-relay.ps1"),
    read("windows/update-relay.ps1"),
    read("windows/release-package-validation.ps1"),
  ]);
  for (const source of [install, update]) {
    assert.match(source, /release-package-validation\.ps1/);
    assert.match(source, /Assert-MonCahierRelayReleasePackage/);
  }
  assert.match(validation, /release-manifest\.json/);
  assert.match(validation, /assert-release-safe\.mjs/);
  assert.match(validation, /Paquet relais non fiable/);
});

test("les exclusions couvrent données, dépendances et secrets", async () => {
  const ignore = await read(".gitignore");
  for (const expected of [
    "node_modules/",
    "data/",
    "backups/",
    "release/",
    "*.db-wal",
    "*.db-shm",
    ".env.*",
  ]) {
    assert.match(ignore, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("package.json expose la fabrication contrôlée du ZIP", async () => {
  const pkg = JSON.parse(await read("package.json")) as {
    version?: string;
    scripts?: Record<string, string>;
  };
  assert.equal(pkg.version, "0.2.2");
  assert.match(pkg.scripts?.["package:windows"] || "", /New-Relay-Package\.ps1/);
});

test("les scripts PowerShell restent compatibles avec Windows PowerShell 5.1", async () => {
  const scripts = [
    "windows/New-Relay-Package.ps1",
    "windows/release-package-validation.ps1",
    "windows/install-relay.ps1",
    "windows/update-relay.ps1",
  ];
  for (const script of scripts) {
    const bytes = await readBytes(script);
    assert.deepEqual(
      Array.from(bytes.subarray(0, 3)),
      [0xef, 0xbb, 0xbf],
      `${script} doit être encodé en UTF-8 avec BOM`,
    );
  }
});
