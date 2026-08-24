import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeRelayEndpointList,
  parseReportedRelayEndpoints,
  relayEndpointCandidates,
} from "../src/lib/relay-endpoints";

test("les endpoints observés privilégient le .local puis l'IPv4 actuelle", () => {
  assert.deepEqual(
    relayEndpointCandidates({
      configuredUrl: "http://192.168.206.246:4317",
      observedUrls: [
        "http://192.168.209.246:4317/health",
        "http://LAPTOP-2SRLI1BS.local:4317",
      ],
    }),
    [
      "http://laptop-2srli1bs.local:4317",
      "http://192.168.209.246:4317",
      "http://192.168.206.246:4317",
    ],
  );
});

test("un relais authentifié ne peut publier que des destinations LAN", () => {
  assert.deepEqual(
    normalizeRelayEndpointList([
      "https://example.com:4317",
      "http://127.0.0.1:4317",
      "http://10.0.0.12:4317/path",
      "http://relay-school.local:4317",
    ], { requireLocal: true }),
    [
      "http://10.0.0.12:4317",
      "http://relay-school.local:4317",
    ],
  );
});

test("le header Cloud malformé ou trop grand est ignoré", () => {
  assert.deepEqual(parseReportedRelayEndpoints("not-json"), []);
  assert.deepEqual(parseReportedRelayEndpoints("x".repeat(2_049)), []);
});
