import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfflineCredentialVerifier,
  isIsoDateInFuture,
  remainingLockSeconds,
  verifyOfflineCredentialSecret,
} from "../src/lib/offline-auth-core.ts";

const salt = new Uint8Array([
  1, 2, 3, 4, 5, 6, 7, 8,
  9, 10, 11, 12, 13, 14, 15, 16,
]);

test("le vérificateur hors ligne confirme le bon secret sans stocker le mot de passe", async () => {
  const verifier = await createOfflineCredentialVerifier({
    identifier: "+2250713023762",
    password: "MotDePasseSolide",
    iterations: 100_000,
    salt,
  });

  assert.equal(verifier.algorithm, "PBKDF2-SHA-256");
  assert.equal(verifier.iterations, 100_000);
  assert.ok(verifier.salt_b64);
  assert.ok(verifier.verifier_b64);
  assert.equal(
    await verifyOfflineCredentialSecret(verifier, {
      identifier: "+2250713023762",
      password: "MotDePasseSolide",
    }),
    true,
  );
  assert.equal(
    await verifyOfflineCredentialSecret(verifier, {
      identifier: "+2250713023762",
      password: "MauvaisMotDePasse",
    }),
    false,
  );
});

test("le vérificateur est lié à l'identifiant du compte", async () => {
  const verifier = await createOfflineCredentialVerifier({
    identifier: "professeur@ecole.ci",
    password: "Secret-123",
    iterations: 100_000,
    salt,
  });

  assert.equal(
    await verifyOfflineCredentialSecret(verifier, {
      identifier: "autre@ecole.ci",
      password: "Secret-123",
    }),
    false,
  );
});

test("une configuration PBKDF2 trop faible est refusée", async () => {
  await assert.rejects(
    createOfflineCredentialVerifier({
      identifier: "professeur@ecole.ci",
      password: "Secret-123",
      iterations: 10,
      salt,
    }),
    /OFFLINE_LOGIN_CREDENTIAL_INVALID/,
  );
});

test("les dates d'expiration et de verrouillage sont évaluées sans ambiguïté", () => {
  const now = Date.parse("2026-08-08T06:00:00.000Z");
  assert.equal(isIsoDateInFuture("2026-08-08T06:01:00.000Z", now), true);
  assert.equal(isIsoDateInFuture("2026-08-08T05:59:59.000Z", now), false);
  assert.equal(
    remainingLockSeconds("2026-08-08T06:02:01.000Z", now),
    121,
  );
  assert.equal(
    remainingLockSeconds("2026-08-08T05:59:59.000Z", now),
    0,
  );
});
