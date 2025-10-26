// scripts/fix-mojibake.mjs
import fs from "node:fs/promises";
import path from "node:path";

/** Dossiers à scanner (on tolère qu'ils n'existent pas). */
const CANDIDATE_DIRS = [
  "src/app",
  "src",
  "app",
  "components",
  "public",
  "scripts",
];

/** Extensions ciblées (texte). */
const FILE_RE = /\.(tsx?|jsx?|mjs|cjs|json|md|css|scss|html?|sql|ya?ml)$/i;

/** Remplacements simples des séquences mojibake courantes. */
function fixText(s) {
  return s
    .replaceAll("é", "é")
    .replaceAll("è", "è")
    .replaceAll("ê", "ê")
    .replaceAll("ë", "ë")
    .replaceAll("â", "â")
    .replaceAll("î", "î")
    .replaceAll("ô", "ô")
    .replaceAll("ï", "ï")
    .replaceAll("ü", "ü")
    .replaceAll("à", "à")
    .replaceAll("ç", "ç")
    .replaceAll("’", "’")
    .replaceAll("“", "“")
    .replaceAll("”", "”")
    .replaceAll("–", "–")
    .replaceAll("—", "—")
    .replaceAll("…", "…");
}

/** Utilitaires sûrs (ne jettent pas en cas d’absence). */
async function safeReaddir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
async function walk(dir, out = []) {
  for (const e of await safeReaddir(dir)) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (FILE_RE.test(e.name)) out.push(p);
  }
  return out;
}

async function main() {
  const roots = [];
  for (const r of CANDIDATE_DIRS) {
    const abs = path.resolve(process.cwd(), r);
    try {
      await fs.access(abs);
      roots.push(abs);
    } catch {
      // ignore
    }
  }

  if (roots.length === 0) {
    console.log("[fix-mojibake] Aucun dossier source trouvé (src/app, src, app…). Skip.");
    process.exit(0); // NE FAIT PAS ÉCHEC
  }

  let files = [];
  for (const r of roots) files = files.concat(await walk(r));

  let changed = 0;
  for (const f of files) {
    try {
      const buf = await fs.readFile(f);
      const txt = buf.toString("utf8");
      const fixed = fixText(txt);
      if (fixed !== txt) {
        await fs.writeFile(f, fixed, "utf8");
        changed++;
      }
    } catch {
      // ignore file errors
    }
  }

  console.log(`[fix-mojibake] Terminé. Fichiers modifiés: ${changed}/${files.length}`);
  process.exit(0); // toujours succès (cross-platform)
}

main();
