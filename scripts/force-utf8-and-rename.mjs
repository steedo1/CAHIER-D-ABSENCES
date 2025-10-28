// scripts/force-utf8-and-rename.mjs
import fs from "node:fs";
import path from "node:path";

const EXTS = new Set([".ts",".tsx",".js",".jsx"]);
const IGNORE = /(\\|\/)(node_modules|\.next|dist|build|out|\.git)(\\|\/)/;

function readAuto(pathname) {
  const buf = fs.readFileSync(pathname);
  // UTF-16 LE BOM?
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return Buffer.from(buf.slice(2)).toString("utf16le");
  // UTF-8 BOM?
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return Buffer.from(buf.slice(3)).toString("utf8");
  // sinon essaie UTF-8
  return buf.toString("utf8");
}

function walk(dir, acc=[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!IGNORE.test(p)) walk(p, acc);
    } else if (EXTS.has(path.extname(e.name).toLowerCase())) {
      acc.push(p);
    }
  }
  return acc;
}

const files = walk(process.cwd());
for (const f of files) {
  const txt = readAuto(f);
  const out = txt.replace(/bg-gradient-to-/g, "bg-linear-to-");
  if (out !== txt) {
    fs.writeFileSync(f, out, { encoding: "utf8" }); // toujours UTF-8
    console.log("patched:", f);
  } else {
    // Forcer UTF-8 même si pas de remplacement
    fs.writeFileSync(f, txt, { encoding: "utf8" });
  }
}
console.log("✓ done.");
