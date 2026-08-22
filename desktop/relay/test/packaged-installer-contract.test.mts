import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const relayRoot = process.cwd();
const installRelay = readFileSync(resolve(relayRoot, "windows/install-relay.ps1"), "utf8");
const packagedWrapper = readFileSync(
  resolve(relayRoot, "windows/install-packaged-relay.ps1"),
  "utf8",
);
const innoSetup = readFileSync(
  resolve(relayRoot, "windows/MonCahier-Relay-Setup.iss"),
  "utf8",
);

test("le paquet active explicitement le mode précompilé", () => {
  assert.match(packagedWrapper, /MONCAHIER_RELAY_PACKAGED\s*=\s*"1"/);
  assert.match(installRelay, /\$PackagedMode\s*=\s*\$env:MONCAHIER_RELAY_PACKAGED\s+-eq\s+"1"/);
});

test("le mode paquet utilise dist sans relancer npm run build", () => {
  assert.match(
    installRelay,
    /if \(\$PackagedMode\) \{[\s\S]*RequiredPackagedPaths[\s\S]*\} else \{[\s\S]*npmCommand\.Source run build/i,
  );

  const packagedBlock = installRelay.slice(
    installRelay.indexOf("if ($PackagedMode) {"),
    installRelay.indexOf("} else {", installRelay.indexOf("if ($PackagedMode) {")),
  );
  assert.doesNotMatch(packagedBlock, /run build/i);
  assert.match(packagedBlock, /dist\\protocol/);
  assert.match(packagedBlock, /dist\\migrations/);
});

test("le Setup refuse de déclarer succès si la configuration PowerShell échoue", () => {
  assert.doesNotMatch(innoSetup, /\[Run\][\s\S]*install-packaged-relay\.ps1/i);
  assert.match(innoSetup, /ssPostInstall/);
  assert.match(innoSetup, /ResultCode\s*<>\s*0/);
  assert.match(innoSetup, /RaiseException/);
});
