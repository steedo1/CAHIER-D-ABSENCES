import assert from "node:assert/strict";
import test from "node:test";
import { createMulticycleFixture, createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";
import { parseSchoolCyclesSettings } from "../src/lib/school-cycles";
import { isBilingualGeneralDirectorFinanceEligible } from "../src/lib/bilingual-general-director-finance";

const bilingual = { school_cycles_v1: {
  version: 1, enabled: true, enabledCycles: ["primary", "secondary"],
  teachingTracksByCycle: { primary: ["french", "arabic"], secondary: ["french"] },
} };
const ordinary = { school_cycles_v1: {
  version: 1, enabled: true, enabledCycles: ["primary", "secondary"],
  teachingTracksByCycle: { primary: ["french"], secondary: ["french"] },
} };

function fixture(settings = bilingual, financeEnabled = true, expires = "2027-07-11") {
  const db = createMulticycleFixture();
  db.tables.institutions[0].settings_json = structuredClone(settings);
  db.tables.institutions[0].subscription_expires_at = expires;
  db.tables.institution_finance_module_settings = [{
    institution_id: db.legacyId, finance_premium_enabled: financeEnabled,
  }];
  return db;
}

test("seul le DG administrateur d'une école franco-arabe est éligible ; ni enseignant ni directeur signataire", () => {
  const school = parseSchoolCyclesSettings(bilingual);
  assert.equal(isBilingualGeneralDirectorFinanceEligible("admin", school), true);
  for (const role of ["teacher", "educator", "file_correspondent", "parent", "finance_manager"]) {
    assert.equal(isBilingualGeneralDirectorFinanceEligible(role, school), false, role);
  }
  assert.equal(isBilingualGeneralDirectorFinanceEligible("admin", parseSchoolCyclesSettings(ordinary)), false);
  assert.equal(isBilingualGeneralDirectorFinanceEligible("admin", parseSchoolCyclesSettings({})), false);
});

test("DG franco-arabe : Finance entière + paie ; contrôle de l'établissement et de l'abonnement côté serveur", async () => {
  const db = fixture(), access = createFixtureRouteLoader(db, db.legacyAdminId)("src/lib/finance-access.ts");
  for (const scope of ["full", "payroll", "any"]) {
    const value = await access.getFinanceAccessForCurrentUser(scope);
    assert.deepEqual({ ok: value.ok, scope: value.scope, institutionId: value.institutionId },
      { ok: true, scope: "full", institutionId: db.legacyId });
  }
  assert.equal(db.calls.some(row => row.op !== "read"), false);
});

test("administrateur d'un établissement ordinaire : paie uniquement, sans accès Finance entier", async () => {
  const db = fixture(ordinary), access = createFixtureRouteLoader(db, db.legacyAdminId)("src/lib/finance-access.ts");
  const full = await access.getFinanceAccessForCurrentUser("full");
  assert.equal(full.ok, false);
  assert.equal(full.reason, "role_not_allowed");
  const payroll = await access.getFinanceAccessForCurrentUser("payroll");
  assert.equal(payroll.ok, true);
  assert.equal(payroll.scope, "payroll");
  const any = await access.getFinanceAccessForCurrentUser("any");
  assert.equal(any.ok, true);
  assert.equal(any.scope, "payroll");
});

test("un directeur signataire avec rôle enseignant n'obtient jamais Finance, même dans une école bilingue", async () => {
  const db = fixture();
  const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  db.users.set(id, { user: db.user(id, "directeur-francais@example.invalid") });
  db.tables.profiles.push({ id, institution_id: db.legacyId });
  db.tables.user_roles.push({ profile_id: id, institution_id: db.legacyId, role: "teacher" });
  const access = createFixtureRouteLoader(db, id)("src/lib/finance-access.ts");
  const result = await access.getFinanceAccessForCurrentUser("full");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "role_not_allowed");
});

test("une attribution admin d'une autre école ne donne pas accès aux finances de l'école courante", async () => {
  const db = fixture();
  db.tables.user_roles = db.tables.user_roles.filter(row => row.profile_id !== db.legacyAdminId);
  db.tables.user_roles.push({ profile_id: db.legacyAdminId, institution_id: "other-school", role: "admin" });
  const access = createFixtureRouteLoader(db, db.legacyAdminId)("src/lib/finance-access.ts");
  const result = await access.getFinanceAccessForCurrentUser("full");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "role_not_allowed");
});

test("DG franco-arabe : Finance disponible avec l'abonnement valide même si l'ancien drapeau Premium est désactivé", async () => {
  const db = fixture(bilingual, false, "2027-10-17");
  const access = createFixtureRouteLoader(db, db.legacyAdminId)("src/lib/finance-access.ts");
  const full = await access.getFinanceAccessForCurrentUser("full");
  assert.equal(full.ok, true);
  assert.equal(full.scope, "full");
  assert.equal(full.premiumEnabled, true, "Finance effective enabled for DG despite legacy flag");
});

test("DG franco-arabe : abonnement expiré interdit Finance même lorsque le Premium est désactivé", async () => {
  for (const enabled of [true, false]) {
    const db = fixture(bilingual, enabled, "2025-01-01");
    const access = createFixtureRouteLoader(db, db.legacyAdminId)("src/lib/finance-access.ts");
    const result = await access.getFinanceAccessForCurrentUser("full");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "subscription_expired");
  }
});

test("les autres écoles ne contournent jamais Finance Premium ; droit historique finance_manager préservé", async () => {
  const db = fixture(ordinary, false, "2027-07-11");
  db.tables.user_roles = db.tables.user_roles.filter(row => row.profile_id !== db.legacyAdminId);
  db.tables.user_roles.push({ profile_id: db.legacyAdminId, institution_id: db.legacyId, role: "finance_manager" });
  const access = createFixtureRouteLoader(db, db.legacyAdminId)("src/lib/finance-access.ts");
  const result = await access.getFinanceAccessForCurrentUser("full");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "finance_not_enabled");
});

test("le finance_manager historique garde ses droits inchangés dans un établissement ordinaire", async () => {
  const db = fixture(ordinary);
  db.tables.user_roles = db.tables.user_roles.filter(row => row.profile_id !== db.legacyAdminId);
  db.tables.user_roles.push({ profile_id: db.legacyAdminId, institution_id: db.legacyId, role: "finance_manager" });
  const access = createFixtureRouteLoader(db, db.legacyAdminId)("src/lib/finance-access.ts");
  const result = await access.getFinanceAccessForCurrentUser("full");
  assert.equal(result.ok, true);
  assert.equal(result.scope, "full");
});
