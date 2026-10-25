import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { schoolCardFixture, request, year } from "./helpers/school-card-fixture.mjs";
process.env.SCHOOL_CARDS_ENABLED="true";
process.env.SCHOOL_CARD_QR_SECRET="isolated-test-secret-not-a-real-key-2026";
const path="src/app/api/admin/school-cards/route.ts";
const settings="src/app/api/admin/school-cards/settings/route.ts";
const revoke="src/app/api/admin/school-cards/revoke/route.ts";
const verify="src/app/api/public/school-cards/verify/route.ts";
test("public chunked requests are size-bounded before JSON or database work",async()=>{
  const db=schoolCardFixture(1),scanner=db.admin(verify),before=db.calls.length;
  const req=request("/api/public/school-cards/verify",{token:"x".repeat(1001)});
  assert.equal(req.headers.has("content-length"),false);
  assert.equal((await scanner.POST(req)).status,413);
  assert.equal(db.calls.length,before);
});
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
test("Render TLS proxy: official public origin is accepted, internal/forged browser origins remain forbidden",()=>{
  const db=schoolCardFixture(1),api=db.admin("src/lib/server/school-cards.ts"),previous=process.env.NODE_ENV;
  try {
    process.env.NODE_ENV="production";
    const req=origin=>({headers:new Headers({origin}),nextUrl:{origin:"http://localhost:10000"}});
    assert.equal(api.requireCardOrigin(req("https://www.mon-cahier.com")),true);
    assert.equal(api.requireCardOrigin(req("http://localhost:10000")),false);
    assert.equal(api.requireCardOrigin(req("https://attacker.invalid")),false);
  }finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous}
});
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
test("private composite signature: preview before save, retained original, stale edit rejected and Service cannot download",async()=>{
  const db=schoolCardFixture(1),api=db.admin("src/app/api/admin/school-cards/signature/route.ts");
  const bytes=await sharp({create:{width:100,height:50,channels:4,background:{r:20,g:40,b:180,alpha:1}}}).png().toBuffer();
  const req=(action,revision=0)=>{
    const url=new URL("https://cards.example.invalid/api/admin/school-cards/signature"),form=new FormData();
    form.set("file",new File([bytes],"test.png",{type:"image/png"}));form.set("slot","general");form.set("action",action);form.set("revision",String(revision));form.set("authorized","true");form.set("removeBackground","false");form.set("crop","false");
    return Object.assign(new Request(url,{method:"POST",headers:{origin:url.origin},body:form}),{nextUrl:url});
  };
  assert.ok((await(await api.POST(req("preview"))).json()).preview.startsWith("data:image/png;base64,"));assert.equal(db.files.size,0);
  assert.equal((await api.POST(req("save"))).status,200);assert.equal(db.files.size,2);
  const config=db.tables.school_card_settings[0].configuration,asset=config.signatures.general;
  assert.deepEqual(db.files.get(asset.original),bytes);assert.ok(asset.original.startsWith(`school-cards/${db.legacyId}/`));
  const original=await api.GET(request("/api/admin/school-cards/signature?slot=general"));assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
  assert.equal((await api.POST(req("save"))).status,409);assert.equal(db.files.size,2);
  const educator=db.addActor("educator");assert.equal((await db.load(educator)("src/app/api/admin/school-cards/signature/route.ts").GET(request("/api/admin/school-cards/signature?slot=general"))).status,403);
  const loaded=await(await db.admin(path).GET(request("/api/admin/school-cards"))).json();
  assert.equal(loaded.configuration.signatures.general.original,"");assert.equal(JSON.stringify(loaded).includes(asset.original),false);
});
