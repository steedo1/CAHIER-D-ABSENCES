import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { createReleaseManifest } from "./release-safety.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const root = path.resolve(argument("--root") || ".");
const output = path.resolve(argument("--output") || path.join(root, "release-manifest.json"));
const version = String(argument("--version") || "").trim();
const commit = String(argument("--commit") || "").trim() || null;
const createdAt = String(argument("--created-at") || new Date().toISOString());

const manifest = await createReleaseManifest(root, {
  version,
  git_commit: commit,
  created_at: createdAt,
  build_mode: "source-reproducible",
});
await fs.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`[relay-release] manifeste créé: ${output}`);
