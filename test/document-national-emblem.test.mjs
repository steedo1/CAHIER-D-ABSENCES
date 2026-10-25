import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import PDFDocument from "pdfkit";
import { IVORIAN_DOCUMENT_EMBLEM, IVORIAN_DOCUMENT_EMBLEM_BYTES, documentNationalEmblem } from "../src/lib/document-national-emblem.ts";
import { renderCardPages } from "../src/lib/school-card-pdf.ts";
import { generateActualAttestationHtml } from "./helpers/attestation-fixture.mjs";

test("document emblem is a bounded inline asset, restricted to Ivorian headers", () => {
  const bytes = Buffer.from(IVORIAN_DOCUMENT_EMBLEM.split(",")[1], "base64");
  assert.equal(bytes.length, IVORIAN_DOCUMENT_EMBLEM_BYTES);
  assert.ok(bytes.length < 20_000);
  assert.equal(bytes.subarray(0, 2).toString("hex"), "ffd8");
  for (const country of [undefined, "", "République de Côte d’Ivoire", "COTE D'IVOIRE", "CI", "CIV"])
    assert.equal(documentNationalEmblem(country), IVORIAN_DOCUMENT_EMBLEM);
  for (const country of ["Sénégal", "Burkina Faso", "France"])
    assert.equal(documentNationalEmblem(country), undefined);
});

test("100 certificates include one source, retaining school logo, identity and signatories", () => {
  const args = { cfg: { institution_name: "École fictive", institution_head_name: "Responsable fictif", institution_logo_url: "data:image/png;base64,TEST", country_name: "Côte d’Ivoire" }, academicYear: "2026-2027", rows: Array.from({length:100}, (_, i) => ({id:`fake-${i}`,last_name:"FICTIF",first_name:`${i}`,matricule:`TEST-${i}`,class_label:"CP1"})), classEducationTypes:new Map(), selectedEducationType:"general_secondary" };
  const html = generateActualAttestationHtml(args);
  assert.equal(html.split(IVORIAN_DOCUMENT_EMBLEM).length - 1, 1, "one inline source per whole print batch");
  assert.equal((html.match(/class="national-emblem"/g) || []).length, 100);
  assert.equal((html.match(/alt="Logo etablissement"/g) || []).length, 100);
  assert.equal((html.match(/Responsable fictif/g) || []).length, 200);
  const foreign = generateActualAttestationHtml({...args,cfg:{...args.cfg,country_name:"Sénégal"}});
  assert.ok(!foreign.includes(IVORIAN_DOCUMENT_EMBLEM));
  assert.ok(!foreign.includes('class="national-emblem"'));
});

test("PDF embeds the emblem once for 100 cards, with no image request or per-card duplication", async () => {
  const font = new Uint8Array(await readFile("public/card-fonts/DejaVuSans.ttf"));
  const doc = new PDFDocument({autoFirstPage:false}), chunks = [];
  const done = new Promise((resolve,reject) => {doc.on("data", chunk=>chunks.push(chunk));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject);});
  const cards = Array.from({length:100}, (_, i) => ({studentId:`fake-${i}`,name:`Élève fictif ${i}`,matricule:`TEST-${i}`,birthdate:"2016-05-12",birthPlace:"Aboisso",gender:"F",classLabel:"CP1",year:"2026-2027",verificationUrl:`https://www.mon-cahier.com/verifier-carte#fictif-${i}`,fingerprint:`TEST${i}`,signatureSlot:null}));
  renderCardPages(doc,cards,{name:"École fictive",country_name:"Côte d’Ivoire"},{font,photos:new Map(),signatures:{}});doc.end();
  const pdf = (await done).toString("latin1");
  assert.equal((pdf.match(/\/Subtype \/Image\b/g)||[]).length,1);
  assert.equal((pdf.match(/\/Type \/Page\b/g)||[]).length,20);
});
