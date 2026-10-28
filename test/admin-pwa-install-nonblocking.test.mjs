import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const code = readFileSync("src/components/admin/AdminPwaInstallPrompt.tsx", "utf8");

test("l'invitation PWA ne bloque jamais le défilement du tableau de bord", () => {
  assert.doesNotMatch(code, /document\.body\.style\.overflow\s*=/);
  assert.match(code, /pointer-events-none fixed inset-0/);
  assert.match(code, /pointer-events-none absolute inset-0/);
  assert.match(code, /pointer-events-auto relative/);
  assert.doesNotMatch(code, /aria-modal="true"/);
});

test("l'aide d'installation manuelle remplace la carte centrale et n'empêche pas le menu du navigateur", () => {
  assert.match(code, /if \(showHelp\)\s*\{\s*return/);
  assert.match(code, /pointer-events-none fixed inset-x-3 top-3/);
  assert.match(code, /pointer-events-auto w-full max-w-sm/);
  assert.match(code, /Dans Chrome : touchez/);
  assert.match(code, /Dans Safari : touchez/);
  assert.match(code, /Compris, continuer/);
});

test("l'installation reste facultative et ne crée aucun trafic supplémentaire", () => {
  assert.match(code, /Plus tard/);
  assert.match(code, /onClick=\{dismiss\}/);
  assert.match(code, /REMIND_AFTER_MS = 14/);
  assert.match(code, /if \(isStandalone\(\)\)/);
  assert.doesNotMatch(code, /\bfetch\s*\(|\bsupabase\./);
  assert.doesNotMatch(code, /<img\b|next\/image/);
});
