import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { schoolCardFixture, request, year } from "./helpers/school-card-fixture.mjs";
process.env.SCHOOL_CARDS_ENABLED="true";
process.env.SCHOOL_CARD_QR_SECRET="isolated-test-secret-not-a-real-key-2026";
const path="src/app/api/admin/school-cards/route.ts";
const settings="src/app/api/admin/school-cards/settings/route.ts";
const revoke="src/app/api/admin/school-cards/revoke/route.ts";
const verify="src/app/api/public/school-cards/verify/route.ts";
async function prepare(db,ids=db.tables.class_enrollments.map(row=>row.id)) {
  return db.admin(path).POST(request("/api/admin/school-cards",{year,enrollmentIds:ids}));
}
test("CSCA/Dieudonné/EPC configurations: roster → prepare → reprint preserves distinct homonyms and zero QR writes",async()=>{
  for(const bilingual of [false,true]) {
    const db=schoolCardFixture(12,bilingual), api=db.admin(path);
    const roster=await (await api.GET(request("/api/admin/school-cards"))).json();
    assert.equal(roster.items.length,12); assert.equal(roster.canConfigure,true);
    assert.equal(roster.items.filter(row=>row.name==="Traoré Ousmane").length,2);
    assert.ok(roster.items.every(row=>row.warnings.includes("Photo absente")));
    const first=await (await prepare(db)).json(), second=await (await prepare(db)).json();
    assert.deepEqual(first.items.map(row=>row.token),second.items.map(row=>row.token));
    assert.equal(new Set(first.items.map(row=>row.token)).size,12);
    assert.ok(first.items.every(row=>row.verificationUrl.includes("/verifier-carte#")));
    assert.equal(db.calls.filter(call=>call.op!=="read").length,0);
    assert.equal(db.calls.filter(call=>call.table==="bulletin_qr_codes").length,0);
    if(bilingual) assert.deepEqual([...new Set(roster.items.flatMap(row=>row.tracks))].sort(),["arabic","french"]);
  }
});
test("roles: parent/teacher/other institution forbidden; educator limited to assigned classes and cannot configure/revoke",async()=>{
  const db=schoolCardFixture();
  for(const role of ["parent","teacher","finance_manager"]) assert.equal((await db.load(db.addActor(role))(path).GET(request("/api/admin/school-cards"))).status,403);
  assert.equal((await db.load(randomUUID())(path).GET(request("/api/admin/school-cards"))).status,401);
  const educator=db.addActor("educator");
  db.tables.educator_class_assignments=[{institution_id:db.legacyId,profile_id:educator,class_id:db.tables.classes[0].id,level:null}];
  const loaded=await (await db.load(educator)(path).GET(request("/api/admin/school-cards"))).json();
  assert.equal(loaded.items.length,5); assert.equal(loaded.canConfigure,false);
  assert.equal((await db.load(educator)(settings).PUT(request("/api/admin/school-cards/settings",{revision:0,enabled:true,automaticSignature:true},"PUT"))).status,403);
  const outsider=db.addActor("admin",randomUUID());
  assert.equal((await db.load(outsider)(path).POST(request("/api/admin/school-cards",{year,enrollmentIds:[db.tables.class_enrollments[0].id]}))).status,503);
  const foreign={...db.tables.class_enrollments[0],id:randomUUID(),institution_id:randomUUID()};db.tables.class_enrollments.push(foreign);
  assert.equal((await prepare(db,[foreign.id])).status,403);
  assert.equal((await apiCrossOrigin(db)).status,403);
});
function apiCrossOrigin(db){return db.admin(path).POST(request("/api/admin/school-cards",{year,enrollmentIds:[db.tables.class_enrollments[0].id]},"POST",{origin:"https://attacker.invalid"}));}
test("valid scan checks live enrollment, year, school, module suspension and revocation without exposing a pupil",async()=>{
  const db=schoolCardFixture(1),card=(await(await prepare(db)).json()).items[0];
  const scanner=db.admin(verify);
  const scan=()=>scanner.POST(request("/api/public/school-cards/verify",{token:card.token}));
  const valid=await(await scan()).json();assert.equal(valid.valid,true);assert.equal(valid.school,db.tables.institutions[0].name);
  assert.equal(JSON.stringify(valid).includes("Traoré"),false);
  const enrollment=db.tables.class_enrollments[0];
  enrollment.end_date="2026-10-24"; assert.equal((await(await scan()).json()).valid,false);enrollment.end_date=null;
  db.tables.academic_years[0].end_date="2026-01-01";assert.equal((await(await scan()).json()).valid,false);db.tables.academic_years[0].end_date="2027-07-30";
  await db.admin(revoke).POST(request("/api/admin/school-cards/revoke",{year,enrollmentIds:[enrollment.id],revoked:true}));
  assert.equal((await(await scan()).json()).valid,false);assert.equal((await prepare(db)).status,403);
  await db.admin(revoke).POST(request("/api/admin/school-cards/revoke",{year,enrollmentIds:[enrollment.id],revoked:false}));
  assert.equal((await(await scan()).json()).valid,true);
  const oldCount=db.calls.length;
  assert.equal((await(await scanner.POST(request("/api/public/school-cards/verify",{token:card.token.slice(1)}))).json()).valid,false);
  assert.equal(db.calls.length,oldCount,"forged tokens never query Supabase");
});
test("configuration CAS, independent document policies, bounded batches and stable French/Arabic signatories",async()=>{
  const db=schoolCardFixture(4,true);
  const save=()=>db.admin(settings).PUT(request("/api/admin/school-cards/settings",{revision:0,enabled:true,automaticSignature:true},"PUT"));
  assert.equal((await save()).status,200);assert.equal((await save()).status,409);
  const configuration=db.tables.school_card_settings[0].configuration;
  assert.equal(configuration.documentPolicies.bulletins,false);assert.equal(configuration.documentPolicies.attestations,false);
  configuration.signatures={french:{original:"school-cards/x/original",processed:"school-cards/x/output"},arabic:{original:"school-cards/x/original",processed:"school-cards/x/output"}};
  const ctx=db.admin("src/lib/server/school-cards.ts");
  const scoped=await ctx.cardScope();
  const roster=await ctx.loadCardEnrollments(scoped,year);
  const prepared=ctx.prepareSchoolCards(scoped,roster.items,"https://cards.example.invalid");
  assert.deepEqual(new Set(prepared.map(row=>row.signatoryName)),new Set(["Nimaga Adam Ousmane","Traoré Daouda"]));
  assert.equal((await db.admin(path).POST(request("/api/admin/school-cards",{year,enrollmentIds:Array(101).fill(randomUUID())}))).status,400);
});
