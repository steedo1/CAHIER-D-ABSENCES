import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ClassDeviceAccessError,
  enrichClassDeviceAccess,
  type ClassDeviceMetadataReader,
} from "../src/lib/class-device-access-server";
import {
  resolveClassDevicePreparationAccess,
} from "../src/lib/offline-readiness";

const SECRET = "s".repeat(64);

type FakeOptions = {
  institutions?: any[];
  settings?: any[];
  policies?: any[];
  institutionError?: { code?: string; message?: string } | null;
  settingsError?: { code?: string; message?: string } | null;
  policyError?: { code?: string; message?: string } | null;
  throwInstitution?: boolean;
  throwSettings?: boolean;
  throwPolicy?: boolean;
};

function fakeService(options: FakeOptions): ClassDeviceMetadataReader {
  return {
    from(table) {
      return {
        select(columns) {
          return {
            async in() {
              if (table === "institution_attendance_policies") {
                if (options.throwPolicy) throw new Error("policy query failed");
                return {
                  data: options.policies || [],
                  error: options.policyError || null,
                };
              }
              if (columns.includes("settings_json")) {
                if (options.throwSettings) {
                  throw new Error("settings query failed");
                }
                return {
                  data: options.settings || [],
                  error: options.settingsError || null,
                };
              }
              if (options.throwInstitution) {
                throw new Error("institution query failed");
              }
              return {
                data: options.institutions || [],
                error: options.institutionError || null,
              };
            },
          };
        },
      };
    },
  };
}

function classRow(classId: string, institutionId: string) {
  return {
    id: classId,
    label: classId,
    level: "1ère",
    institution_id: institutionId,
    education_type: "technical_secondary",
    formation_code: "formation-a",
    formation_level_code: "level-a",
  };
}

function policy(institutionId: string, overrides: Record<string, unknown> = {}) {
  return {
    institution_id: institutionId,
    enabled: true,
    allow_local_relay: true,
    relay_local_url: `http://relay-${institutionId}.local:4317`,
    relay_presence_secret: SECRET,
    ...overrides,
  };
}

function tokenPayload(token: string) {
  const [encoded] = token.split(".");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

test("politique valide retourne URL et jeton class_device v2 borné", async () => {
  const result = await enrichClassDeviceAccess({
    items: [classRow("class-a", "school-a")],
    actorProfileId: "device-profile-a",
    service: fakeService({
      institutions: [
        { id: "school-a", name: "COLLEGE NOTRE-DAME" },
      ],
      settings: [{ id: "school-a", settings_json: null }],
      policies: [policy("school-a")],
    }),
  });
  const item: any = result.items[0];
  assert.equal(item.attendance_presence.enabled, true);
  assert.equal(item.attendance_presence.allow_local_relay, true);
  assert.equal(
    item.attendance_presence.relay_local_url,
    "http://relay-school-a.local:4317",
  );
  assert.ok(item.attendance_presence.relay_access_token);
  const payload = tokenPayload(
    item.attendance_presence.relay_access_token,
  );
  assert.equal(payload.v, 2);
  assert.equal(payload.actor_kind, "class_device");
  assert.equal(payload.institution_id, "school-a");
  assert.equal(payload.class_id, "class-a");
  assert.equal(payload.actor_profile_id, "device-profile-a");
});

test("deux écoles et deux classes ne mélangent jamais leurs jetons", async () => {
  const result = await enrichClassDeviceAccess({
    items: [
      classRow("class-a", "school-a"),
      classRow("class-a-2", "school-a"),
      classRow("class-b", "school-b"),
    ],
    actorProfileId: "device-profile",
    service: fakeService({
      institutions: [
        { id: "school-a", name: "School A" },
        { id: "school-b", name: "School B" },
      ],
      settings: [],
      policies: [policy("school-a"), policy("school-b")],
    }),
  });
  for (const item of result.items as any[]) {
    const payload = tokenPayload(
      item.attendance_presence.relay_access_token,
    );
    assert.equal(payload.institution_id, item.institution_id);
    assert.equal(payload.class_id, item.id);
    assert.equal(payload.actor_profile_id, "device-profile");
  }
  assert.notEqual(
    (result.items[0] as any).attendance_presence.relay_access_token,
    (result.items[1] as any).attendance_presence.relay_access_token,
  );
  assert.notEqual(
    (result.items[1] as any).attendance_presence.relay_access_token,
    (result.items[2] as any).attendance_presence.relay_access_token,
  );
});

test("settings_json absent ou indisponible conserve l’accès relais valide", async () => {
  for (const service of [
    fakeService({
      institutions: [{ id: "school-a", name: "School A" }],
      settings: [{ id: "school-a", settings_json: null }],
      policies: [policy("school-a")],
    }),
    fakeService({
      institutions: [{ id: "school-a", name: "School A" }],
      throwSettings: true,
      policies: [policy("school-a")],
    }),
  ]) {
    const result = await enrichClassDeviceAccess({
      items: [classRow("class-a", "school-a")],
      actorProfileId: "device-profile",
      service,
    });
    const item: any = result.items[0];
    assert.equal(item.attendance_presence.enabled, true);
    assert.ok(item.attendance_presence.relay_access_token);
    assert.equal(item.education_type, "technical_secondary");
    assert.ok(item.education_context_label);
    assert.ok(
      item.metadata_diagnostics.includes("education_settings_missing") ||
        item.metadata_diagnostics.includes(
          "education_settings_unavailable",
        ),
    );
  }
});

test("erreur de lecture établissement est diagnostiquée sans perdre l’accès relais", async () => {
  const result = await enrichClassDeviceAccess({
    items: [classRow("class-a", "school-a")],
    actorProfileId: "device-profile",
    service: fakeService({
      throwInstitution: true,
      policies: [policy("school-a")],
    }),
  });
  const item: any = result.items[0];
  assert.equal(item.institution_name, null);
  assert.equal(item.attendance_presence.enabled, true);
  assert.ok(item.attendance_presence.relay_access_token);
  assert.ok(
    item.metadata_diagnostics.includes(
      "institution_metadata_unavailable",
    ),
  );
});

test("erreur de lecture de politique devient une erreur explicite", async () => {
  await assert.rejects(
    enrichClassDeviceAccess({
      items: [classRow("class-a", "school-a")],
      actorProfileId: "device-profile",
      service: fakeService({
        throwPolicy: true,
      }),
    }),
    (error: unknown) =>
      error instanceof ClassDeviceAccessError &&
      error.status === 503 &&
      error.code === "class_relay_policy_unavailable",
  );
});

test("secret ou URL incomplet retourne un diagnostic non sensible", async () => {
  const cases = [
    {
      override: { relay_presence_secret: null },
      diagnostic: "relay_secret_missing",
    },
    {
      override: { relay_presence_secret: "short" },
      diagnostic: "relay_secret_too_short",
    },
    {
      override: { relay_local_url: null },
      diagnostic: "relay_url_missing",
    },
  ];
  for (const entry of cases) {
    const result = await enrichClassDeviceAccess({
      items: [classRow("class-a", "school-a")],
      actorProfileId: "device-profile",
      service: fakeService({
        institutions: [{ id: "school-a", name: "School A" }],
        policies: [policy("school-a", entry.override)],
      }),
    });
    const presence: any = (result.items[0] as any).attendance_presence;
    assert.equal(presence.enabled, false);
    assert.equal(presence.relay_access_token, null);
    assert.equal(presence.diagnostic, entry.diagnostic);
    assert.doesNotMatch(JSON.stringify(presence), /s{32,}/);
  }
});

test("échec de création du jeton est explicite sans secret ni signature", async () => {
  await assert.rejects(
    enrichClassDeviceAccess({
      items: [classRow("class-a", "school-a")],
      actorProfileId: "device-profile",
      service: fakeService({
        policies: [policy("school-a")],
      }),
      createAccessToken: () => {
        throw new Error(`do-not-expose-${SECRET}`);
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof ClassDeviceAccessError);
      assert.equal(error.code, "class_relay_token_creation_failed");
      assert.doesNotMatch(error.message, /do-not-expose|s{32,}/);
      return true;
    },
  );
});

test("aucun secret ou jeton n’est envoyé aux journaux", async () => {
  const source = await readFile(
    new URL("../src/lib/class-device-access-server.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)/);
  const calls: unknown[][] = [];
  const consoleRef = globalThis["console"];
  const originalMethods = {
    log: consoleRef.log,
    info: consoleRef.info,
    warn: consoleRef.warn,
    error: consoleRef.error,
  };
  consoleRef.log = (...args) => calls.push(args);
  consoleRef.info = (...args) => calls.push(args);
  consoleRef.warn = (...args) => calls.push(args);
  consoleRef.error = (...args) => calls.push(args);
  try {
    await enrichClassDeviceAccess({
      items: [classRow("class-a", "school-a")],
      actorProfileId: "device-profile",
      service: fakeService({
        institutions: [{ id: "school-a", name: "School A" }],
        policies: [policy("school-a")],
      }),
    });
  } finally {
    consoleRef.log = originalMethods.log;
    consoleRef.info = originalMethods.info;
    consoleRef.warn = originalMethods.warn;
    consoleRef.error = originalMethods.error;
  }
  assert.deepEqual(calls, []);
});

test("la préparation v5 accepte la réponse corrigée et conserve les accès signés", async () => {
  const access = resolveClassDevicePreparationAccess({
    items: [
      {
        ...classRow("class-a", "school-a"),
        actor_profile_id: "device-profile",
        attendance_presence: {
          enabled: true,
          allow_local_relay: true,
          relay_local_url: "http://relay-school-a.local:4317",
          relay_access_token: "payload.signature",
        },
      },
    ],
  });
  assert.equal(access.classId, "class-a");
  assert.equal(access.institutionId, "school-a");
  assert.equal(
    access.relayPolicy.relayLocalUrl,
    "http://relay-school-a.local:4317",
  );
  assert.equal(
    access.relayPolicy.relayAccessToken,
    "payload.signature",
  );
});

test("la préparation actualise selectedClass avec la réponse fraîche", async () => {
  const [card, page, readiness] = await Promise.all([
    readFile(
      new URL("../src/components/OfflineReadinessCard.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/app/class/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/lib/offline-readiness.ts", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(card, /await onPrepared\?\./);
  assert.match(page, /onPrepared=\{refreshClassContextAfterPreparation\}/);
  assert.match(
    page,
    /cacheGet<\{ items\?: any\[\] \}>\(\s*"classDevice:my-classes"/,
  );
  assert.match(page, /setClasses\(fresh\.classes\)/);
  assert.match(readiness, /relayPolicy\.relay_access_token/);
  assert.match(readiness, /version:\s*5/);
});
