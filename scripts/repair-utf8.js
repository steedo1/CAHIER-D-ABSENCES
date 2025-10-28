// scripts/repair-utf8.js
/* Fixe les textes "�", """, "�x&" etc. en re-d�codant latin1 -> utf8.
   S'applique aux extensions texte usuelles, ignore node_modules/.next. */

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DRY = !!process.env.DRY;

const EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".mdx",
  ".css", ".scss", ".html", ".txt", ".yml", ".yaml"
]);
const IGNORE_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "out"]);

const BAD_PATTERN = /�.|�|"|�|�|� |�$|�x/;

function fixOnce(s) { return Buffer.from(s, "latin1").toString("utf8"); }

function maybeFix(content) {
  if (!BAD_PATTERN.test(content)) return null;         // rien � faire
  let prev = content;
  for (let i = 0; i < 3; i++) {                        // jusqu'� 3 passes si double-encodage
    const next = fixOnce(prev);
    if (next === prev) break;
    prev = next;
  }
  // Si apr�s correction il reste des s�quences "bizarres", on laisse tel quel
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
        console.log(`${DRY ? "[DRY] " : ""}fixed: ${path.relative(ROOT, file)}`);
        if (!DRY) fs.writeFileSync(file, fixed, "utf8");
      }
    }
  }
}

walk(ROOT);
console.log(" Encodage: scan termin�.");
