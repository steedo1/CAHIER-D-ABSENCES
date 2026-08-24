import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/lib/local-relay.ts", import.meta.url),
  "utf8",
);

test("relay operations reuse the last endpoint proven reachable", () => {
  assert.match(source, /preferRemembered\?: boolean/);
  assert.match(
    source,
    /const rememberedInstitutionId = getRememberedRelayInstitution\(\);[\s\S]*?rememberedRelayBaseUrl\(rememberedInstitutionId\)[\s\S]*?options\.preferRemembered === false[\s\S]*?requestedBaseUrl[\s\S]*?rememberedBaseUrl \|\| requestedBaseUrl/,
  );
});

test("connectivity discovery probes every candidate instead of being pinned to the remembered URL", () => {
  assert.match(
    source,
    /"\/v1\/teacher\/connectivity-check"[\s\S]*?preferRemembered: false/,
  );
});

test("a successful discovery updates both institution scope and last-good endpoint", () => {
  assert.match(
    source,
    /if \(result\.status === "reachable"\) \{[\s\S]*?rememberRelayInstitution\(institutionId\);[\s\S]*?rememberRelayBaseUrl\(institutionId, baseUrl\);/,
  );
});
