import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classDeviceTechnicalEmail,
  classLoginIdentifierKey,
  cleanClassLoginIdentifier,
  legacyClassPhoneCandidates,
  resolveClassDeviceClassIds,
  resolveClassDeviceLogin,
  sameClassLoginIdentifier,
} from "../src/lib/class-device-identity";

const read = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

type Row = Record<string, any>;

function fakeService(input: {
  classes?: Row[];
  institutions?: Row[];
  profiles?: Row[];
  userRoles?: Row[];
  authUsers?: Row[];
}) {
  const tables: Record<string, Row[]> = {
    classes: input.classes || [],
    institutions: input.institutions || [],
    profiles: input.profiles || [],
    user_roles: input.userRoles || [],
  };

  function query(table: string) {
    let rows = [...(tables[table] || [])];
    let max = Number.POSITIVE_INFINITY;
    const builder: any = {
      select() {
        return builder;
      },
      eq(column: string, value: unknown) {
        rows = rows.filter((row) => row[column] === value);
        return builder;
      },
      in(column: string, values: unknown[]) {
        rows = rows.filter((row) => values.includes(row[column]));
        return builder;
      },
      limit(value: number) {
        max = value;
        return builder;
      },
      maybeSingle() {
        const limited = rows.slice(0, max);
        return Promise.resolve({
          data: limited.length === 1 ? limited[0] : null,
          error: null,
        });
      },
      then(resolve: (value: unknown) => unknown, reject: (cause: unknown) => unknown) {
        return Promise.resolve({ data: rows.slice(0, max), error: null }).then(
          resolve,
          reject,
        );
      },
    };
    return builder;
  }

  return {
    from(table: string) {
      return query(table);
    },
    auth: {
      admin: {
        async getUserById(userId: string) {
          const user = (input.authUsers || []).find((row) => row.id === userId) || null;
          return { data: { user }, error: user ? null : { message: "not_found" } };
        },
      },
    },
  };
}

test("l'identifiant de classe conserve exactement les zéros et accepte une valeur non téléphonique", () => {
  assert.equal(cleanClassLoginIdentifier("+2250202020200"), "+2250202020200");
  assert.equal(classLoginIdentifierKey("+2250202020200"), "+2250202020200");
  assert.equal(cleanClassLoginIdentifier("0657 1"), "0657 1");
  assert.equal(cleanClassLoginIdentifier("+2250701020304"), "+2250701020304");
  assert.equal(classLoginIdentifierKey("  0657   1  "), "0657 1");
  assert.equal(sameClassLoginIdentifier("0657  1", "0657 1"), true);
  assert.ok(
    legacyClassPhoneCandidates("+225202020200").includes("+2250202020200"),
  );
});

test("deux établissements peuvent utiliser le même identifiant sans partager leur compte Auth", async () => {
  const service = fakeService({
    institutions: [
      { id: "inst-a", code: "SCHOOL-A", code_unique: "A" },
      { id: "inst-b", code: "SCHOOL-B", code_unique: "B" },
    ],
    classes: [
      {
        id: "class-a",
        institution_id: "inst-a",
        class_login_identifier_key: "0657 1",
        class_device_auth_user_id: "user-a",
      },
      {
        id: "class-b",
        institution_id: "inst-b",
        class_login_identifier_key: "0657 1",
        class_device_auth_user_id: "user-b",
      },
    ],
    userRoles: [
      { profile_id: "user-a", institution_id: "inst-a", role: "class_device" },
      { profile_id: "user-b", institution_id: "inst-b", role: "class_device" },
    ],
    authUsers: [
      { id: "user-a", email: "a@auth.mon-cahier.com", phone: null },
      { id: "user-b", email: "b@auth.mon-cahier.com", phone: null },
    ],
  });

  assert.deepEqual(
    await resolveClassDeviceLogin({ service, identifier: "0657 1" }),
    { status: "ambiguous" },
  );
  const scoped = await resolveClassDeviceLogin({
    service,
    identifier: "0657 1",
    institutionCode: "SCHOOL-A",
  });
  assert.equal(scoped.status, "resolved");
  assert.equal(scoped.status === "resolved" ? scoped.auth_user_id : null, "user-a");
  assert.notEqual(
    classDeviceTechnicalEmail("inst-a", "class-a"),
    classDeviceTechnicalEmail("inst-b", "class-b"),
  );
});

test("la liaison Auth canonique autorise un class_device sans téléphone", async () => {
  const service = fakeService({
    classes: [
      {
        id: "class-1",
        institution_id: "inst-1",
        class_device_auth_user_id: "user-1",
        class_phone_e164: null,
      },
    ],
    userRoles: [
      { profile_id: "user-1", institution_id: "inst-1", role: "class_device" },
    ],
    authUsers: [{ id: "user-1", email: "device@auth.mon-cahier.com", phone: null }],
  });
  assert.deepEqual(
    await resolveClassDeviceClassIds({ service, userId: "user-1" }),
    ["class-1"],
  );
});

test("le fallback legacy par téléphone reste cloisonné par établissement", async () => {
  const service = fakeService({
    classes: [
      {
        id: "class-a",
        institution_id: "inst-a",
        class_device_auth_user_id: null,
        class_phone_e164: "+2250202020200",
      },
      {
        id: "class-b",
        institution_id: "inst-b",
        class_device_auth_user_id: null,
        class_phone_e164: "+2250202020200",
      },
    ],
    profiles: [{ id: "user-a", phone: "+2250202020200" }],
    userRoles: [
      { profile_id: "user-a", institution_id: "inst-a", role: "class_device" },
    ],
    authUsers: [
      { id: "user-a", email: null, phone: "+2250202020200" },
    ],
  });

  assert.deepEqual(
    await resolveClassDeviceClassIds({
      service,
      userId: "user-a",
      userPhone: "+2250202020200",
    }),
    ["class-a"],
  );
});

test("édition générale: l'UI omet l'identifiant inchangé et la route ne reprovisionne pas Auth", async () => {
  const page = await read("src/app/admin/classes/page.tsx");
  const route = await read("src/app/api/admin/classes/[id]/route.ts");

  assert.match(page, /if \(ePhone\.trim\(\) !== currentIdentifier\)/);
  assert.match(page, /body\.class_identifier = ePhone\.trim\(\) \|\| null/);
  assert.doesNotMatch(page, /class_phone:\s*ePhone\.trim\(\)/);
  assert.match(route, /if \(identifierChanged && requestedClassIdentifier\)/);
  assert.match(route, /if \(Object\.keys\(row\)\.length === 0\)[\s\S]*return NextResponse\.json\(\{ item: current \}\)/);
  assert.doesNotMatch(route, /ensureAuthUserWithPasswordFlexible/);
  assert.match(route, /\.from\("user_roles"\)/);
  assert.match(route, /\.eq\("institution_id", input\.institutionId\)/);
  assert.match(route, /\.eq\("role", "class_device"\)/);
  assert.doesNotMatch(route, /row\.class_phone_e164\s*=\s*phoneUsed/);
});

test("migration: identité dédiée, unicité institutionnelle et backfill sans réécriture", async () => {
  const sql = await read(
    "supabase/migrations/20260815003231_durable_class_device_identifiers.sql",
  );
  assert.match(sql, /^begin;/i);
  assert.match(sql, /class_login_identifier text/);
  assert.match(sql, /class_device_auth_user_id uuid/);
  assert.match(sql, /on public\.classes \(institution_id, class_login_identifier_key\)/);
  assert.match(sql, /set class_login_identifier = class_phone_e164/);
  assert.match(sql, /u\.phone = c\.class_phone_e164/);
  assert.match(sql, /join public\.user_roles as ur/);
  assert.match(sql, /ur\.role = 'class_device'/);
  assert.match(sql, /ur\.institution_id = c\.institution_id/);
  assert.match(
    sql,
    /unique index if not exists classes_class_device_auth_user_id_uq/,
  );
  assert.doesNotMatch(sql, /replace\([^;]*class_phone_e164/i);
  assert.doesNotMatch(sql, /\bclasses\s*\.\s*code\b/i);
  assert.match(sql, /device_phone_e164[\s\S]*(?:Telephone|Téléphone) ou SIM facultatif/);
  assert.match(sql, /commit;\s*$/i);
});

test("connexion en ligne et préparation hors ligne utilisent l'identifiant opaque", async () => {
  const loginRoute = await read("src/app/api/auth/login/route.ts");
  const loginCard = await read("src/components/auth/LoginCard.tsx");
  const roleRoute = await read("src/app/api/auth/role/route.ts");

  assert.match(loginRoute, /resolveClassDeviceLogin/);
  assert.match(loginRoute, /resolution\.email[\s\S]*signInWithPassword/);
  assert.match(loginRoute, /CLASS_IDENTIFIER_INSTITUTION_REQUIRED/);
  assert.match(loginCard, /offlineIdentifier/);
  assert.match(loginCard, /institutionCode\.trim\(\)\.toUpperCase\(\)/);
  assert.match(loginCard, /Téléphone ou identifiant de classe/);
  assert.match(roleRoute, /resolveClassDeviceClassIds/);
});
