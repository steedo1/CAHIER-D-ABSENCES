import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/app/admin/absences/appels-matrice/page.tsx", import.meta.url),
  "utf8",
);

test("la vue par créneau retire le statut visuel Démarré", () => {
  assert.equal(source.includes("PlayCircle"), false);
  assert.equal(source.includes("Démarrés"), false);
  assert.equal(source.includes('>DÉMARRÉ<'), false);
  assert.equal(source.includes("bg-violet-600"), false);
});

test("un appel started est compté comme conforme", () => {
  assert.match(
    source,
    /c\.status === "ok" \|\| c\.status === "started"/,
  );
  assert.match(source, /Appels commencés dans le délai prévu\./);
  assert.match(source, /Appel commencé dans le délai prévu\./);
});

test("les six cartes de pilotage sont explicites", () => {
  assert.match(source, /lg:grid-cols-6/);
  assert.match(source, /Créneaux qui n’ont pas encore commencé\./);
  assert.match(source, /Délai dépassé, aucun appel commencé\./);
  assert.match(source, /Appels commencés après le délai prévu\./);
  assert.match(source, /Justifications reçues à examiner\./);
});
