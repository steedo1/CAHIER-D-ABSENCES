import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("l’invitation PWA ne concerne que l’espace parents et n’altère pas le layout global", async () => {
  const [layout, root, prompt] = await Promise.all([
    read("src/app/parents/layout.tsx"),
    read("src/app/layout.tsx"),
    read("src/components/parent/ParentInstallPrompt.tsx"),
  ]);
  assert.match(layout, /<ParentInstallPrompt\s*\/>/);
  assert.doesNotMatch(root, /ParentInstallPrompt/);
  assert.match(prompt, /beforeinstallprompt/);
  assert.match(prompt, /appinstalled/);
  assert.match(prompt, /display-mode: standalone/);
  assert.match(prompt, /DISMISS_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(prompt, /localStorage\.setItem/);
  assert.match(prompt, /event\.prompt\(\)/);
  assert.match(prompt, /event\.userChoice/);
  assert.match(prompt, /if \(!visible \|\| !installEvent\) return null;/);
  assert.match(prompt, /aria-modal="false"/);
  for (const label of ["Installer Mon Cahier", "Plus tard", "Installer"]) assert.ok(prompt.includes(label));
  assert.doesNotMatch(prompt, /fetch\(/);
});

test("les deux avatars élèves emploient une icône locale sans requête photo ni changement de cartes", async () => {
  const page = await read("src/app/parents/page.tsx");
  assert.match(page, /import \{ UserRound \} from "lucide-react"/);
  assert.equal((page.match(/<UserRound size=\{28\}/g) || []).length, 2);
  assert.doesNotMatch(page, /initials\(kid\.full_name\)/);
  assert.match(page, /h-\[52px\] w-\[52px\].*bg-\[#003766\]/);
  assert.match(page, /h-16 w-16 place-items-center rounded-\[22px\] bg-slate-100/);
  assert.doesNotMatch(page, /photo_url|avatar_url/);
});

test("la carte enfant rend l’action Ouvrir explicite sans ajouter de bouton imbriqué", async () => {
  const page = await read("src/app/parents/page.tsx");
  assert.match(page, /onClick=\{\(\) => openKid\(kid\.id\)\}/);
  assert.match(page, /Ouvrir\s*<Icon name="arrow" size=\{17\}/);
  assert.match(page, /bg-emerald-50 px-3 text-sm font-black text-emerald-800/);
  assert.match(page, /<UserRound size=\{28\} strokeWidth=\{2\.2\} aria-hidden="true" \/>/);
});

test("le guide d’accueil est montré une seule fois, ignoré après ouverture et sans réseau", async () => {
  const page = await read("src/app/parents/page.tsx");
  assert.match(page, /PARENT_FIRST_USE_GUIDE_KEY = "mon-cahier-parent-first-use-guide-v1"/);
  assert.match(page, /localStorage\.getItem\(PARENT_FIRST_USE_GUIDE_KEY\) !== "done"/);
  assert.match(page, /localStorage\.setItem\(PARENT_FIRST_USE_GUIDE_KEY, "done"\)/);
  assert.match(page, /if \(showFirstUseGuide\) completeFirstUseGuide\(\)/);
  assert.match(page, /\{showFirstUseGuide \? \(/);
  assert.match(page, /Guide de première utilisation/);
  assert.match(page, /Mes enfants<\/strong>/);
  assert.match(page, /Ouvrir<\/strong>/);
  assert.match(page, /onClick=\{\(\) => openPrimary\(kids\.length \? "children" : "attach"\)\}/);
  assert.match(page, /onClick=\{completeFirstUseGuide\}/);
  assert.doesNotMatch(page.slice(page.indexOf("function completeFirstUseGuide"), page.indexOf("function openPrimary")), /fetch\(/);
});
