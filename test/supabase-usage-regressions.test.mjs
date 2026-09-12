import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("la surveillance admin ne possède plus de second minuteur caché", () => {
  const duplicateLayout = new URL(
    "../src/app/admin/absences/appels/layout.tsx",
    import.meta.url,
  );
  const monitor = read("src/lib/admin-attendance-monitor.ts");

  assert.equal(existsSync(duplicateLayout), false);
  assert.match(monitor, /cloud:\s*20_000/);
  assert.match(monitor, /cache:\s*60_000/);
  assert.match(monitor, /error:\s*60_000/);
});

test("la sonde EDT est mutualisée et limitée à une fois par minute", () => {
  const card = read("src/components/OfflineReadinessCard.tsx");
  const cloud = read("src/lib/cloud-availability.ts");

  assert.match(card, /const AUTOMATIC_REFRESH_MS = 60_000/);
  assert.match(cloud, /CLOUD_PROBE_SUCCESS_TTL_MS = 45_000/);
  assert.match(cloud, /cloudProbeInFlight/);
  assert.match(cloud, /lastCloudProbe/);
});

test("un QR bulletin inchangé ne recharge ni ne réécrit son payload", () => {
  const qrStore = read("src/lib/bulletin-qr-store.ts");
  const metadataSelect = qrStore.match(
    /\.select\("id, code, expires_at, revoked, payload_hash, official_issue_id"\)/,
  );

  assert.ok(metadataSelect);
  assert.match(
    qrStore,
    /String\(editableDraft\.payload_hash \|\| ""\) === payloadHash[\s\S]*?return editableDraft\.code/,
  );
});

test("les badges admin demandent des comptages sans hydrater les listes", () => {
  const sidebar = read("src/app/admin/ui/sidebar-nav.tsx");
  const absences = read("src/app/api/admin/absence-requests/route.ts");
  const publications = read(
    "src/app/api/admin/grades/publication-requests/route.ts",
  );

  assert.match(sidebar, /absence-requests\?status=pending&count_only=1/);
  assert.match(sidebar, /publication-requests\?status=submitted&count_only=1/);
  assert.match(absences, /select\("id", \{ count: "exact", head: true \}\)/);
  assert.match(publications, /select\("id", \{ count: "exact", head: true \}\)/);
});
