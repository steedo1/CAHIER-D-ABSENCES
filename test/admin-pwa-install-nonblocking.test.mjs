import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const adminLayout = read("src/app/admin/layout.tsx");
const adminShell = read("src/app/admin/ui/shell.tsx");
const registrar = read("src/components/ServiceWorkerRegistrar.tsx");
const classLayout = read("src/app/class/layout.tsx");
const classInstall = read("src/components/ClassDeviceInstallButton.tsx");
const manifest = read("src/app/manifest.ts");
const worker = read("public/moncahier-sw.js");

test("aucune invitation PWA n'est montée dans l'administration", () => {
  assert.doesNotMatch(adminLayout, /AdminPwaInstallPrompt/);
  assert.doesNotMatch(adminShell, /AdminPwaInstallShortcut/);
  assert.match(adminLayout, /<AdminShell/);
  assert.match(adminLayout, /<FileCorrespondentShell/);
});

test("aucune interception PWA globale ne concurrence les comptes classe et professeur", () => {
  assert.doesNotMatch(registrar, /pwa-install-prompt|beginPwaInstallCapture/);
  assert.match(registrar, /registerServiceWorker/);
  assert.match(registrar, /registration\?\.update\(\)/);
});

test("le parcours d'installation existant pour téléphone de classe est préservé", () => {
  assert.match(classLayout, /<ClassDeviceInstallButton/);
  assert.match(classInstall, /beforeinstallprompt/);
  assert.match(classInstall, /await promptEvent\.prompt\(\)/);
  assert.match(classInstall, /Installer l.application/);
  assert.match(classInstall, /Sur Android/);
});

test("la PWA partagée et les données hors ligne ne sont pas désactivées", () => {
  assert.match(manifest, /display: "standalone"/);
  assert.match(manifest, /start_url: "\/"/);
  assert.match(manifest, /scope: "\/"/);
  assert.match(worker, /self\.addEventListener\("install"/);
  assert.match(worker, /self\.addEventListener\("activate"/);
  assert.match(worker, /self\.addEventListener\("fetch"/);
});

test("le retrait ne modifie pas la navigation et les données scolaires de l'administration", () => {
  assert.match(adminLayout, /getPrimaryRole/);
  assert.match(adminLayout, /<OfflineScheduleSyncBridge/);
  assert.match(adminLayout, /<RelaySupervisionBadge/);
  assert.match(adminShell, /<ContactUsButton/);
  assert.match(adminShell, /<MonCahierAiChatBubble/);
});
