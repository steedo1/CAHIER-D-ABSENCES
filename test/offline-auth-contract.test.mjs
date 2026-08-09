import assert from "node:assert/strict";
import test from "node:test";

const auth = await import("../src/lib/offline-auth-contract.ts");
const preparation = await import(
  "../src/lib/background-attendance-preparation-policy.ts"
);

const secret = "offline-auth-test-secret-".padEnd(64, "s");
const now = 1_800_000_000_000;
const deviceId = "device_11111111-2222-4333-8444-555555555555";

async function teacherGrant() {
  return await auth.issueOfflineAccessGrant({
    secret,
    userId: "11111111-2222-4333-8444-555555555555",
    institutionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    deviceId,
    role: "teacher",
    nowMs: now,
    ttlMs: 60_000,
    grantId: "grant_11111111-2222-4333-8444-555555555555",
  });
}

test("un appareil autorisé ouvre uniquement la destination exacte de son rôle", async () => {
  const grant = await teacherGrant();
  const verified = await auth.verifyOfflineAccessGrant({
    token: grant.token,
    secret,
    pathname: "/attendance",
    deviceId,
    nowMs: now + 1,
  });
  assert.equal(verified?.role, "teacher");
  assert.equal(verified?.destination, "/attendance");

  assert.equal(
    await auth.verifyOfflineAccessGrant({
      token: grant.token,
      secret,
      pathname: "/attendance/",
      deviceId,
      nowMs: now + 1,
    }),
    null,
  );
  assert.equal(
    await auth.verifyOfflineAccessGrant({
      token: grant.token,
      secret,
      pathname: "/grades",
      deviceId,
      nowMs: now + 1,
    }),
    null,
  );
});

test("un appareil inconnu, un grant altéré ou expiré est refusé", async () => {
  const grant = await teacherGrant();
  assert.equal(
    await auth.verifyOfflineAccessGrant({
      token: grant.token,
      secret,
      pathname: "/attendance",
      deviceId: "device_99999999-2222-4333-8444-555555555555",
      nowMs: now + 1,
    }),
    null,
  );
  const tampered = `${grant.token.slice(0, -1)}${grant.token.endsWith("a") ? "b" : "a"}`;
  assert.equal(
    await auth.verifyOfflineAccessGrant({
      token: tampered,
      secret,
      pathname: "/attendance",
      deviceId,
      nowMs: now + 1,
    }),
    null,
  );
  assert.equal(
    await auth.verifyOfflineAccessGrant({
      token: grant.token,
      secret,
      pathname: "/attendance",
      deviceId,
      nowMs: now + 60_000,
    }),
    null,
  );
});

test("les trois rôles ont une destination fermée et aucune autre", () => {
  assert.equal(auth.offlineDestinationForRole("teacher"), "/attendance");
  assert.equal(auth.offlineDestinationForRole("class_device"), "/class");
  assert.equal(
    auth.offlineDestinationForRole("admin"),
    "/admin/absences/appels-matrice",
  );
  assert.equal(auth.offlineDestinationForRole("parent"), null);
  assert.equal(auth.offlineDestinationForRole("super_admin"), null);
});

test("le téléphone de classe exige une classe signée dans son grant", async () => {
  await assert.rejects(
    auth.issueOfflineAccessGrant({
      secret,
      userId: "11111111-2222-4333-8444-555555555555",
      institutionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      deviceId,
      role: "class_device",
      nowMs: now,
      ttlMs: 60_000,
    }),
    /offline_class_device_scope_invalid/,
  );
  const grant = await auth.issueOfflineAccessGrant({
    secret,
    userId: "11111111-2222-4333-8444-555555555555",
    institutionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    classId: "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    deviceId,
    role: "class_device",
    nowMs: now,
    ttlMs: 60_000,
  });
  assert.equal(grant.payload.class_id, "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  assert.equal(grant.payload.destination, "/class");
});

test("la persistance simulée conserve seulement le vérificateur PBKDF2 salé", async () => {
  const grant = await teacherGrant();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const verifier = await auth.deriveOfflinePasswordVerifier(
    "mot-de-passe-test",
    salt,
  );
  const simulatedIndexedDb = new Map();
  simulatedIndexedDb.set(
    "credential",
    JSON.stringify({
      grant_token: grant.token,
      salt: auth.encodeBase64Url(salt),
      verifier: auth.encodeBase64Url(verifier),
      iterations: auth.OFFLINE_PBKDF2_ITERATIONS,
    }),
  );

  const persisted = JSON.parse(simulatedIndexedDb.get("credential"));
  assert.equal("password" in persisted, false);
  const restoredSalt = auth.decodeBase64Url(persisted.salt);
  const correct = await auth.deriveOfflinePasswordVerifier(
    "mot-de-passe-test",
    restoredSalt,
    persisted.iterations,
  );
  const incorrect = await auth.deriveOfflinePasswordVerifier(
    "mauvais-mot-de-passe",
    restoredSalt,
    persisted.iterations,
  );
  assert.equal(
    auth.equalOfflineSecret(correct, auth.decodeBase64Url(persisted.verifier)),
    true,
  );
  assert.equal(
    auth.equalOfflineSecret(incorrect, auth.decodeBase64Url(persisted.verifier)),
    false,
  );
});

test("la préparation de fond est throttlée et le retour réseau ne crée pas de boucle", () => {
  const policy = preparation.shouldRunAttendancePreparation;
  const successTtl = preparation.ATTENDANCE_PREPARATION_SUCCESS_TTL_MS;
  const attemptTtl = preparation.ATTENDANCE_PREPARATION_ATTEMPT_TTL_MS;
  assert.equal(
    policy({ now, lastSuccess: now - 1_000, lastAttempt: 0, force: false }),
    false,
  );
  assert.equal(
    policy({
      now,
      lastSuccess: now - successTtl - 1,
      lastAttempt: 0,
      force: false,
    }),
    true,
  );
  assert.equal(
    policy({
      now,
      lastSuccess: now - successTtl - 1,
      lastAttempt: now - attemptTtl + 1,
      force: true,
    }),
    false,
  );
  assert.equal(
    policy({
      now,
      lastSuccess: now - 1_000,
      lastAttempt: now - attemptTtl - 1,
      force: true,
    }),
    true,
  );
});
