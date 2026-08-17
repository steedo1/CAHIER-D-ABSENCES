import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const supervisionPath = new URL("../src/lib/relay-supervision.ts", import.meta.url);
const pagePath = new URL("../src/app/admin/relais/page.tsx", import.meta.url);
const badgePath = new URL("../src/components/admin/RelaySupervisionBadge.tsx", import.meta.url);
const layoutPath = new URL("../src/app/admin/layout.tsx", import.meta.url);

async function read(path) {
  return await readFile(path, "utf8");
}

test("la supervision lit uniquement les endpoints locaux nécessaires", async () => {
  const code = await read(supervisionPath);

  assert.match(code, /"\/health"/);
  assert.match(code, /\/v1\/admin\/dashboard/);
  assert.match(code, /resolveRelayInstitutionId/);
  assert.match(code, /getRelayConfig/);
  assert.match(code, /targetAddressSpace/);
  assert.doesNotMatch(code, /method:\s*"POST"/);
  assert.doesNotMatch(code, /method:\s*"PUT"/);
  assert.doesNotMatch(code, /method:\s*"DELETE"/);
});

test("le diagnostic support est une liste blanche sans secret ni donnees metier", async () => {
  const code = await read(supervisionPath);
  const diagnostic = code.slice(code.indexOf("export function sanitizedRelayDiagnostic"));

  assert.match(diagnostic, /configured: snapshot\.configured/);
  assert.match(diagnostic, /base_url: snapshot\.base_url/);
  assert.match(diagnostic, /health: snapshot\.health/);
  assert.match(diagnostic, /source: dashboard\.source/);
  assert.match(diagnostic, /counts: dashboard\.counts/);
  assert.match(diagnostic, /sync: dashboard\.sync/);
  assert.doesNotMatch(diagnostic, /dashboard: snapshot\.dashboard/);
  assert.doesNotMatch(diagnostic, /roster/);
  assert.doesNotMatch(diagnostic, /attendance_rows/);
  assert.doesNotMatch(diagnostic, /session_reviews/);
  assert.doesNotMatch(diagnostic, /admin_token/);
  assert.doesNotMatch(diagnostic, /token:/);
});

test("l'écran Admin propose test, synchronisation et diagnostic humain", async () => {
  const code = await read(pagePath);

  assert.match(code, /Mon Cahier Relais/);
  assert.match(code, /Tester le relais/);
  assert.match(code, /Synchroniser maintenant/);
  assert.match(code, /syncRelayBootstrap\(\{ force: true \}\)/);
  assert.match(code, /Diagnostic technique/);
  assert.match(code, /Données disponibles localement/);
  assert.match(code, /Synchronisation & intégrité/);
  assert.match(code, /syncAvailable/);
  assert.match(code, /Indisponible/);
  assert.match(code, /Diagnostic administrateur non disponible/);
  assert.doesNotMatch(code, /admin_token/);
  assert.doesNotMatch(code, /\.token\b/);
});

test("le voyant global reste léger et le relais demeure strictement optionnel", async () => {
  const badge = await read(badgePath);
  const layout = await read(layoutPath);

  assert.match(badge, /getRelayConfig\(\)\.token/);
  assert.match(badge, /if \(!getRelayConfig\(\)\.token\) return/);
  assert.match(badge, /probeRelayHealth/);
  assert.doesNotMatch(badge, /readRelaySupervision/);
  assert.match(badge, /if \(!enabled\) return null/);
  assert.match(badge, /href="\/admin\/relais"/);
  assert.match(layout, /RelaySupervisionBadge/);
  assert.match(layout, /<RelaySupervisionBadge \/>/);
});
