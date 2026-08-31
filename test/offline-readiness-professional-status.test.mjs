import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/components/OfflineReadinessCard.tsx", import.meta.url),
  "utf8",
);

const automaticStart = source.indexOf("if (isAutomaticAttendance) {");
const automaticEnd = source.indexOf("const preparedSummary", automaticStart);
const automaticUi = source.slice(automaticStart, automaticEnd);

test("la préparation téléphone masque les messages techniques derrière un spinner stable", () => {
  assert.ok(automaticStart >= 0 && automaticEnd > automaticStart);
  assert.match(automaticUi, /Préparation du \{phoneLabel\}/);
  assert.match(automaticUi, /animate-spin/);
  assert.match(automaticUi, /aria-busy="true"/);
  assert.doesNotMatch(automaticUi, /compactMessage/);
  assert.doesNotMatch(automaticUi, /\bprogress\b/);
  assert.doesNotMatch(automaticUi, /\{error\}/);
});

test("les téléphones classe et professeur confirment clairement la disponibilité hors Internet", () => {
  assert.match(automaticUi, /Téléphone de classe prêt/);
  assert.match(automaticUi, /Téléphone professeur prêt/);
  assert.match(
    automaticUi,
    /Les appels peuvent fonctionner même\s+sans Internet\./,
  );
  assert.match(automaticUi, /Préparation réussie/);
});

test("un échec reste compréhensible et permet de relancer sans exposer le détail technique", () => {
  assert.match(automaticUi, /pas encore prêt/);
  assert.match(automaticUi, /Vérifiez la connexion, puis réessayez/);
  assert.match(automaticUi, /Réessayer/);
  assert.match(source, /prepareOffline\(role/);
});
