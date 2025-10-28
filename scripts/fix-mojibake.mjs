// scripts/fix-mojibake.mjs
// Corrige les séquences d’encodage foireuses (Ã, â€¦, ðŸ…) en re-décodant latin1 -> utf8.
// S’applique aux fichiers texte usuels. Exclut node_modules, .next, etc.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DRY = process.env.DRY === "1";

const EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx",
  ".json", ".md", ".mdx",
  ".css", ".scss", ".html",
  ".txt", ".yml", ".yaml"
]);

const IGNORE_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "out"]);

// motifs typiques du mojibake UTF-8 mal décodé
const BAD_PATTERN = /Ã.|â€|â€¢|â€“|â€”|Â |Â$|ðŸ/;

function decodeLatin1ToUtf8(s) {
  return Buffer.from(s, "latin1").toString("utf8");
}

function maybeFix(content) {
  if (!BAD_PATTERN.test(content)) return null;

  // jusqu’à 3 passes pour rattraper les doubles/triples décodages
  let prev = content;
  for (let i = 0; i < 3; i++) {
    const next = decodeLatin1ToUtf8(prev);
    if (next === prev) break;
    prev = next;
  }

  // si après correction on a toujours des marqueurs, on garde quand même la dernière version
  return prev;
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name));
    } else {
      const ext = path.extname(e.name).toLowerCase();
      if (!EXTS.has(ext)) continue;

      const file = path.join(dir, e.name);
      const raw = fs.readFileSync(file, "utf8");
      const fixed = maybeFix(raw);
      if (fixed && fixed !== raw) {
        const rel = path.relative(ROOT, file);
        if (DRY) {
          console.log(`[DRY] would fix: ${rel}`);
        } else {
          fs.writeFileSync(file, fixed, "utf8");
          console.log(`fixed: ${rel}`);
        }
      }
    }
  }
}

try {
  walk(ROOT);
  console.log("✓ mojibake scan done.");
} catch (err) {
  console.error("fix-mojibake error:", err);
  process.exitCode = 1;
}
