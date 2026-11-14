import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { PDFParse } from "pdf-parse";

const origin = process.env.CARD_QA_ORIGIN || "http://localhost:4397";
const browser = await chromium.launch({ executablePath: process.env.CARD_CHROME || undefined, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const errors = [];
let fontRequests = 0;
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => {
  if (new URL(request.url()).pathname === "/card-fonts/DejaVuSans.ttf") fontRequests += 1;
});
await mkdir("tmp/school-cards", { recursive: true });
try {
  await page.goto(origin);
  await page.getByLabel("Scénario de recette").selectOption("epc");
  await page.getByRole("button", { name: "Tout l’établissement (12)", exact: true }).waitFor();
  await page.getByRole("checkbox", { name: /^Sélectionner Traoré/ }).first().check();
  const [previewResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/admin/school-cards") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Aperçu recto verso" }).click(),
  ]);
  assert.equal(previewResponse.status(), 200, (await previewResponse.text()).slice(0, 200));
  await page.getByAltText("Aperçu recto filigrané").waitFor();
  await page.getByAltText("Aperçu verso filigrané").waitFor();
  assert.equal(await page.getByRole("button", { name: /Générer.*PDF|Imprimer/ }).count(), 0);
  await page.screenshot({ path: "tmp/school-cards/workspace-desktop.png", fullPage: true });

  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Commander les cartes" }).click();
  await page.getByText("Commande transmise · 1 carte(s).").waitFor();
  await page.getByText("En attente", { exact: true }).waitFor();
  const rejected = await page.request.post(`${origin}/api/admin/school-cards`, { data: { year: "2026-2027", enrollmentIds: [] } });
  assert.equal(rejected.status(), 403);
  assert.equal((await page.request.get(`${origin}/api/production-nexa`)).status(), 403);

  // Test-only role switch in the isolated transport. Production has no such header.
  await page.setExtraHTTPHeaders({ "X-QA-Production": "true" });
  await page.goto(`${origin}/production-nexa`);
  await page.getByLabel("Établissement").selectOption({ label: "EPC Dimbokro — DONNÉES FICTIVES · E020684" });
  await page.getByRole("button", { name: "Commandes", exact: true }).click();
  await page.getByRole("button", { name: "Voir les cartes" }).click();
  await page.getByPlaceholder("Nom, matricule ou classe").fill("EPC260001");
  await page.getByRole("button", { name: "Sélectionner les résultats" }).click();
  await page.getByText("1 sélectionnée(s)", { exact: true }).waitFor();
  await page.getByLabel("Autoriser les informations manquantes", { exact: true }).check();
  await page.getByRole("button", { name: "Générer et archiver les PDF" }).click();
  await page.getByText("Version 1", { exact: true }).waitFor({ timeout: 30_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"), page.getByRole("button", { name: "Télécharger le PDF" }).click(),
  ]);
  await download.saveAs("tmp/school-cards/production-epc.pdf");
  const pdfBytes = await readFile("tmp/school-cards/production-epc.pdf");
  const productionBytes = pdfBytes.length;
  const pdf = new PDFParse({ data: new Uint8Array(pdfBytes) });
  try {
    const parsed = await pdf.getText();
    assert.equal(parsed.total, 2);
    assert.match(parsed.text, /CP1 FR/);
    assert.match(parsed.text, /CP1 AR/);
  } finally { await pdf.destroy(); }
  await page.getByRole("button", { name: "Historique", exact: true }).click();
  await page.getByText(/Téléchargement du PDF ·/).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Cartes", exact: true }).click();
  await page.getByPlaceholder("Nom, matricule ou classe").fill("EPC260002");
  const unprepared = page.getByRole("row").filter({ hasText: "EPC260002" });
  await unprepared.getByRole("cell", { name: /^À préparer/ }).waitFor();
  const checkbox = unprepared.getByRole("checkbox");
  assert.equal(await checkbox.isEnabled(), true);
  await checkbox.check();
  await page.getByText("1 sélectionnée(s)", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.getByRole("button", { name: "Préparer, générer et archiver les PDF" }).click();
  await page.getByText("1 carte(s) dans 1 fichier(s) PDF.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Cartes", exact: true }).click();
  await page.getByPlaceholder("Nom, matricule ou classe").fill("EPC260002");
  await unprepared.getByRole("cell", { name: /^Préparée/ }).waitFor();
  await page.screenshot({ path: "tmp/school-cards/workspace-mobile.png", fullPage: true });
  assert.equal(fontRequests, 1);
  assert.ok(productionBytes > 0);
  assert.deepEqual(errors, []);
  await writeFile("tmp/school-cards/browser-metrics.json", JSON.stringify({ productionBytes, fontRequests, errors }, null, 2));
  console.log({ productionBytes, fontRequests, errors });
} finally { await browser.close(); }
