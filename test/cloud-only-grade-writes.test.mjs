import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function source(path) {
  return await readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("rentrée: les notes utilisent directement le Cloud sans relais obligatoire", async () => {
  const [grades, capability] = await Promise.all([
    source("src/lib/offline-grades.ts"),
    source("src/lib/grade-write-capabilities.ts"),
  ]);

  assert.match(grades, /fetch\(endpoint,[\s\S]+credentials:\s*"include"/);
  assert.match(grades, /\/api\/teacher\/grades\/scores\/bulk/);
  assert.match(grades, /\/api\/grades\/scores\/bulk/);
  assert.doesNotMatch(grades, /\/v1\/grades\/score-operations/);
  assert.match(
    capability,
    /NEXT_PUBLIC_MONCAHIER_OFFLINE_GRADE_WRITES_ENABLED\s*===\s*"true"/,
  );
});

test("rentrée: un échec réseau n'écrit ni dans l'outbox ni dans le cache", async () => {
  const grades = await source("src/lib/offline-grades.ts");
  const cloudOnlyBranch = grades.slice(
    grades.indexOf("} else {", grades.indexOf("OFFLINE_GRADE_WRITES_ENABLED")),
  );

  assert.match(cloudOnlyBranch, /queued:\s*false/);
  assert.match(cloudOnlyBranch, /CLOUD_ONLY_GRADE_WRITE_MESSAGE/);
  assert.match(
    grades,
    /if \(result\.ok \|\| \(OFFLINE_GRADE_WRITES_ENABLED && result\.queued\)\)/,
  );
  assert.match(grades, /if \(OFFLINE_GRADE_WRITES_ENABLED\)[\s\S]+offlineMutateJson/);
});

test("rentrée: les anciennes mutations LOT3/LOT4 sont conservées mais non rejouées", async () => {
  const [offline, engine, gradeSyncV4] = await Promise.all([
    source("src/lib/offline.ts"),
    source("desktop/relay/src/grade-write.mts"),
    source("desktop/relay/src/cloud-sync-grade-v4.mts"),
  ]);

  assert.match(offline, /isOfflineGradeMutation/);
  assert.match(offline, /state:\s*"blocked"/);
  assert.match(offline, /OFFLINE_GRADE_WRITES_DISABLED_ERROR/);
  assert.match(offline, /OFFLINE_GRADE_WRITES_ENABLED/);
  assert.match(engine, /secureGradeScoreOperation/);
  assert.match(engine, /server_version/);
  assert.match(gradeSyncV4, /base_server_version/);
  assert.match(gradeSyncV4, /conflict/i);
});

test("rentrée: l'interface n'affiche pas de saisie trompeuse hors connexion", async () => {
  const [teacherPage, classDevicePage, voiceEntry, capability] = await Promise.all([
    source("src/app/grades/page.tsx"),
    source("src/app/grades/class-device/page.tsx"),
    source("src/components/VoiceGradeEntry.tsx"),
    source("src/lib/grade-write-capabilities.ts"),
  ]);
  const pages = [teacherPage, classDevicePage];
  const forbiddenUx =
    /OfflineReadinessCard|OfflineSyncBar|préparation hors ligne|prêt hors ligne|notes? hors ligne|enregistrées? sur cet appareil|en attente de synchronisation|saisissables sans Internet/i;

  for (const page of pages) {
    assert.match(page, /CLOUD_ONLY_GRADE_WRITE_MESSAGE/);
    assert.match(page, /if \(gradeWritesBlocked\)[\s\S]+setMsg\(CLOUD_ONLY_GRADE_WRITE_MESSAGE\)/);
    assert.match(page, /\{isOnline && \([\s\S]+Création NOTE|Création NOTE[\s\S]+\{isOnline && \(/);
    assert.match(page, /totalChanges === 0[\s\S]+gradeWritesBlocked/);
    assert.match(page, /<VoiceGradeEntry[\s\S]+isOnline=\{isOnline\}/);
    assert.ok(
      [...page.matchAll(/if \(!isOnline\)\s*\{[\s\S]{0,180}?CLOUD_ONLY_GRADE_WRITE_MESSAGE/g)]
        .length >= 4,
      "création, suppression, publication et verrouillage doivent refuser le mode hors ligne",
    );
    assert.doesNotMatch(page, forbiddenUx);
    assert.doesNotMatch(page, /result\.queued|queuedCount|queuedEvalIds/);
  }

  assert.match(teacherPage, /saveGradesScores\("teacher"/);
  assert.match(classDevicePage, /saveGradesScores\("class-device"/);

  assert.match(
    capability,
    /Connexion Internet requise pour saisir ou modifier les notes\./,
  );
  assert.match(voiceEntry, /CLOUD_ONLY_GRADE_WRITE_MESSAGE/);
  assert.doesNotMatch(voiceEntry, forbiddenUx);
});
