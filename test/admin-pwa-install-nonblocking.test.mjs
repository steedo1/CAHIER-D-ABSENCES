import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const modal = read("src/components/admin/AdminPwaInstallPrompt.tsx");
const capture = read("src/lib/pwa-install-prompt.ts");
const registrar = read("src/components/ServiceWorkerRegistrar.tsx");
const shell = read("src/app/admin/ui/shell.tsx");
const shortcut = read("src/components/admin/AdminPwaInstallShortcut.tsx");

test("la PWA ne verrouille pas le tableau de bord", () => {
  assert.doesNotMatch(modal, /document\.body\.style\.overflow\s*=/);
  assert.match(modal, /pointer-events-none fixed inset-0/);
  assert.match(modal, /pointer-events-none absolute inset-0/);
  assert.match(modal, /pointer-events-auto relative/);
  assert.doesNotMatch(modal, /aria-modal="true"/);
});

test("l'interface n'annonce Installer maintenant que si le prompt natif existe", () => {
  assert.match(modal, /hasNativePrompt \? "Installer maintenant" : "Voir comment installer"/);
  assert.match(modal, /const event = consumePwaInstallPrompt\(\)/);
  assert.match(modal, /await event\.prompt\(\)/);
  assert.match(modal, /event\.userChoice/);
  assert.match(modal, /setShowHelp\(true\)/);
});

test("l'événement avant connexion est capturé et proposé ensuite à l'Admin", () => {
  assert.match(capture, /window\.addEventListener\("beforeinstallprompt"/);
  assert.match(capture, /event\.preventDefault\(\)/);
  assert.match(capture, /deferredPrompt = event/);
  assert.match(capture, /return prompt/);
  assert.match(registrar, /beginPwaInstallCapture\(\)/);
  assert.match(modal, /getPwaInstallPrompt\(\)/);
});

test("l'aide remplace la fenêtre centrale sans masquer le menu navigateur", () => {
  assert.match(modal, /if \(showHelp\)\s*\{\s*return/);
  assert.match(modal, /pointer-events-none fixed inset-x-3 top-16/);
  assert.match(modal, /Ouvrez Mon Cahier directement dans Chrome/);
  assert.match(modal, /Safari/);
  assert.match(modal, /Compris, accéder à Mon Cahier/);
});

test("Plus tard reste facultatif et l'installation peut être relancée", () => {
  assert.match(modal, /REMIND_AFTER_MS = 14/);
  assert.match(modal, /PWA_INSTALL_OPEN_EVENT/);
  assert.match(modal, /window\.addEventListener\(PWA_INSTALL_OPEN_EVENT, onShortcutClick\)/);
  assert.match(shell, /<AdminPwaInstallShortcut \/>/);
  assert.match(shortcut, /window\.dispatchEvent\(new Event\(PWA_INSTALL_OPEN_EVENT\)\)/);
  assert.match(shortcut, /isPwaStandalone\(\)/);
});

test("l'invitation n'ajoute aucune requête ni image", () => {
  assert.doesNotMatch(modal, /\bfetch\s*\(|\bsupabase\./);
  assert.doesNotMatch(modal, /<img\b|next\/image/);
  assert.doesNotMatch(capture + shortcut, /\bfetch\s*\(|\bsupabase\./);
});
