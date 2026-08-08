import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createReleaseManifest,
  releasePathViolation,
  scanReleaseTree,
  verifyReleaseManifest,
} from "../scripts/release-safety.mjs";

async function temporaryRelease() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moncahier-release-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), '{"name":"relay"}\n');
  await fs.writeFile(path.join(root, "src", "cli.mts"), 'export const ok = true;\n');
  return root;
}

test("le contrôle refuse les bases, WAL, SHM, secrets et dépendances embarquées", () => {
  assert.equal(releasePathViolation("data/ecole.db"), "forbidden_segment:data");
  assert.equal(releasePathViolation("ecole.db-wal"), "forbidden_sensitive_extension:.db-wal");
  assert.equal(releasePathViolation("ecole.db-shm"), "forbidden_sensitive_extension:.db-shm");
  assert.equal(releasePathViolation("node_modules/better-sqlite3/index.js"), "forbidden_segment:node_modules");
  assert.equal(releasePathViolation("config.json"), "forbidden_file:config.json");
  assert.equal(releasePathViolation(".env.production"), "forbidden_secret_environment_file");
  assert.equal(releasePathViolation(".env.example"), null);
});

test("un arbre de distribution minimal et propre est accepté", async (t) => {
  const root = await temporaryRelease();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const scan = await scanReleaseTree(root);
  assert.deepEqual(scan.violations, []);
  assert.equal(scan.files.length, 2);
});

test("la présence d'une base réelle bloque la fabrication du paquet", async (t) => {
  const root = await temporaryRelease();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "data"), { recursive: true });
  await fs.writeFile(path.join(root, "data", "college.db"), "sensitive");
  const scan = await scanReleaseTree(root);
  assert.ok(scan.violations.some((item: { path: string }) => item.path === "data"));
  await assert.rejects(() => createReleaseManifest(root), /release_tree_contains_sensitive_files/);
});

test("le manifeste vérifie chaque taille et empreinte puis détecte une altération", async (t) => {
  const root = await temporaryRelease();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = await createReleaseManifest(root, {
    version: "0.2.2",
    created_at: "2026-08-08T00:00:00.000Z",
  });
  const manifestPath = path.join(root, "release-manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const verified = await verifyReleaseManifest(root, manifestPath);
  assert.equal(verified.verified_files, 2);

  await fs.appendFile(path.join(root, "src", "cli.mts"), "// altered\n");
  await assert.rejects(
    () => verifyReleaseManifest(root, manifestPath),
    /release_manifest_verification_failed/,
  );
});

test("le manifeste refuse aussi un fichier sensible ajouté après fabrication", async (t) => {
  const root = await temporaryRelease();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manifest = await createReleaseManifest(root, { version: "0.2.2" });
  const manifestPath = path.join(root, "release-manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.mkdir(path.join(root, "data"), { recursive: true });
  await fs.writeFile(path.join(root, "data", "ecole.db"), "sensitive");

  await assert.rejects(
    () => verifyReleaseManifest(root, manifestPath),
    /release_manifest_verification_failed/,
  );
});
