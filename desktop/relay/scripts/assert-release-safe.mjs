import path from "node:path";
import process from "node:process";
import { scanReleaseTree, verifyReleaseManifest } from "./release-safety.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function printFailure(error) {
  const violations = Array.isArray(error?.violations) ? error.violations : [];
  console.error(`[relay-release] ${error?.message || "release_safety_check_failed"}`);
  for (const item of violations) {
    console.error(`- ${item.path || "<unknown>"}: ${item.violation || "unsafe"}`);
  }
}

const root = path.resolve(argument("--root") || process.argv[2] || ".");
const manifestPath = argument("--manifest");

try {
  if (manifestPath) {
    const result = await verifyReleaseManifest(root, path.resolve(manifestPath));
    console.log(`[relay-release] manifeste valide: ${result.verified_files} fichier(s) vérifié(s).`);
  } else {
    const scan = await scanReleaseTree(root);
    if (scan.violations.length) {
      const error = new Error("release_tree_contains_sensitive_files");
      error.violations = scan.violations;
      throw error;
    }
    console.log(`[relay-release] arbre sûr: ${scan.files.length} fichier(s), aucun contenu sensible.`);
  }
} catch (error) {
  printFailure(error);
  process.exitCode = 1;
}
