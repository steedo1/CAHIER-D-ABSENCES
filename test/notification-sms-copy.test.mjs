import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const text = readFileSync(new URL("../src/lib/sms/messages.ts", import.meta.url), "utf8");
const code = ts.transpileModule(text, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const module = { exports: {} };
new Function("require", "module", "exports", code)(require, module, module.exports);
const { buildSmsMessageFromQueue } = module.exports;

function build(payload, body = "") {
  return buildSmsMessageFromQueue({
    title: "Alerte", body, payload, appName: "Mon Cahier", institutionName: "CSCA",
  });
}
function oneSegment(sms) {
  assert.ok(sms.length <= 140, `SMS dépasse 140 caractères: ${sms.length}`);
  assert.match(sms, /^[\x20-\x7E]+$/, "Le SMS doit rester GSM-7 ASCII");
  assert.ok(!/\s{2,}/.test(sms), "Espaces parasites");
}

test("absence: parent, date, école si possible et message compréhensible", () => {
  const sms = build({kind:"attendance", event:"absent",
    student:{name:"KOUADIO ANGE"}, subject:{name:"Mathematiques"},
    session:{started_at:"2026-11-02T08:10:00Z"}});
  oneSegment(sms);
  assert.match(sms,/Absence signalee pour KOUADIO ANGE/);
  assert.match(sms,/02\/11\/2026/);
  assert.match(sms,/Mathematiques/);
});

test("retard: durée réelle et identité visibles", () => {
  const sms = build({kind:"attendance", event:"late",
    student:{name:"TRAORE AMINATA"}, minutes_late:22,
    session:{started_at:"2026-11-02T09:05:00Z"}});
  oneSegment(sms);
  assert.match(sms,/Retard signale pour TRAORE AMINATA \(22 min\)/);
});

test("notes: valeurs complètes, jamais de note tronquée", () => {
  const sms = build({kind:"notes_digest", student:{name:"YAO KOFFI"}, period_label:"Trimestre 1",
    items:[{subject:"Math",score:16,scale:20},{subject:"Francais",score:14,scale:20}]});
  oneSegment(sms);
  assert.match(sms,/Math 16\/20/);
  assert.match(sms,/Francais 14\/20/);
});

test("rappel financier: montant et élève", () => {
  const sms = build({kind:"finance_reminder", student:{name:"KONE IDRISSA"}, balances:{total:25000}});
  oneSegment(sms);
  assert.match(sms,/KONE IDRISSA/);
  assert.match(sms,/25000 F|25 000 F/);
});

test("communication longue: reste dans un seul SMS lisible", () => {
  const sms = build({kind:"communication", title:"Réunion parents",
    body:"Nous vous invitons à la rencontre des parents d'élèves de lundi matin à huit heures. Merci de vous rapprocher de la direction pour les détails."});
  oneSegment(sms);
  assert.match(sms,/Reunion parents/);
  assert.ok(!sms.endsWith("...") || sms.length <= 140);
});
