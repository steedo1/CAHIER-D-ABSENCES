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
test("School roster excludes signed photos and the old PDF preparation endpoint rejects direct calls", async () => {
  for (const bilingual of [false, true]) {
    const db = schoolCardFixture(12, bilingual), api = db.admin(path);
    const student = db.tables.students[0];
    student.photo_path = `${db.legacyId}/${student.id}/photo.png`;
    const roster = await (await api.GET(request("/api/admin/school-cards"))).json();
    assert.equal(roster.items.length, 12);
    assert.equal(roster.items.filter(row => row.name === "Traoré Ousmane").length, 2);
    assert.ok(roster.items.every(row => row.photoUrl === null));
    assert.equal(roster.items.find(row => row.studentId === student.id).warnings.includes("Photo absente"), false);
    assert.equal(db.calls.some(call => call.op === "sign-batch"), false);
    assert.equal((await prepare(db)).status, 403);
    assert.equal(db.calls.filter(call => call.table === "bulletin_qr_codes").length, 0);
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
  const db=schoolCardFixture(1);
  const legacy = db.admin("src/lib/server/school-cards.ts"), scope = await legacy.cardScope();
  const [card] = legacy.prepareSchoolCards(scope, (await legacy.loadCardEnrollments(scope, year)).items, "https://cards.example.invalid");
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
  assert.equal((await db.admin(path).POST(request("/api/admin/school-cards",{year,enrollmentIds:Array(101).fill(randomUUID())}))).status,403);
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
  assert.equal((await api.GET(request("/api/admin/school-cards/signature?slot=general"))).status,403);
  const superAssets=db.load(db.superId)("src/app/api/admin/school-cards/signature/route.ts");
  const original=await superAssets.GET(request(`/api/admin/school-cards/signature?slot=general&school=${db.legacyId}`));
  assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);
  assert.equal((await api.POST(req("save"))).status,409);assert.equal(db.files.size,2);
  const educator=db.addActor("educator");assert.equal((await db.load(educator)("src/app/api/admin/school-cards/signature/route.ts").GET(request("/api/admin/school-cards/signature?slot=general"))).status,403);
  const loaded=await(await db.admin(path).GET(request("/api/admin/school-cards"))).json();
  assert.equal(loaded.configuration.signatures.general.original,"");assert.equal(JSON.stringify(loaded).includes(asset.original),false);
});

test("EPC cards load only the selected section's private signature and seal", async () => {
  const db = schoolCardFixture(2, true);
  const assets = db.admin("src/app/api/admin/school-cards/signature/route.ts");
  const bytes = await sharp({ create: { width: 80, height: 40, channels: 3, background: "#163096" } }).png().toBuffer();
  const config = await db.admin(settings).PUT(request("/api/admin/school-cards/settings", {
    revision: 0, enabled: true, automaticSignature: true,
  }, "PUT"));
  assert.equal(config.status, 200);
  let revision = 1;
  for (const slot of ["french", "arabic"]) for (const kind of ["signature", "stamp"]) {
    const url = new URL("https://cards.example.invalid/api/admin/school-cards/signature");
    const form = new FormData();
    form.set("file", new File([bytes], "test.png", { type: "image/png" }));
    for (const [key, value] of Object.entries({ slot, kind, action: "save", revision: String(revision), authorized: "true" })) {
      form.set(key, value);
    }
    const req = Object.assign(new Request(url, { method: "POST", headers: { origin: url.origin }, body: form }), { nextUrl: url });
    const response = await assets.POST(req);
    assert.equal(response.status, 200);
    revision = (await response.json()).revision;
  }
  assert.equal(db.files.size, 8);
  const roster = await (await db.admin(path).GET(request("/api/admin/school-cards"))).json();
  assert.equal(roster.signatureImages, undefined);
  assert.equal(roster.stampImages, undefined);
  assert.equal(roster.configuration.stamps.french.original, "");

  const server = db.admin("src/lib/server/school-cards.ts");
  const scope = await server.cardScope();
  const cards = server.productionCardVisuals(scope, (await server.loadCardEnrollments(scope, year)).items);
  for (const slot of ["french", "arabic"]) {
    assert.equal(cards.filter(card => card.signatureSlot === slot).length, 1);
    assert.deepEqual(Object.keys(await server.cardSignatureImages(scope, new Set([slot]))), [slot]);
    assert.deepEqual(Object.keys(await server.cardStampImages(scope, new Set([slot]))), [slot]);
  }
  const original = await assets.GET(request("/api/admin/school-cards/signature?slot=arabic&kind=stamp"));
  assert.equal(original.status, 403);
});

test("EPC produces one card with both teaching classes with configured teaching signatories", async () => {
  const db = schoolCardFixture(3, true);
  const school = db.tables.institutions[0];
  school.code = "E020684";
  const [french, arabic] = db.tables.classes;
  const [home, arabicOnly, frenchOnly] = db.tables.class_enrollments;
  const policy = school.settings_json.school_student_programs_v1.years[year].classes;
  policy[arabic.id].linkedStudentIds = [home.student_id];
  db.tables.students[1].full_name_ar = "عبد الرحمن محمد أمين";
  const api = db.admin(path);
  const enabled = await db.admin(settings).PUT(request("/api/admin/school-cards/settings", {
    revision: 0, enabled: true, automaticSignature: true,
  }, "PUT"));
  assert.equal(enabled.status, 200);
  const configuration = db.tables.school_card_settings[0].configuration;
  configuration.signatures = {};
  configuration.stamps = {};
  for (const track of ["french", "arabic"]) {
    const file = `school-cards/${db.legacyId}/${track}/processed.png`;
    configuration.signatures[track] = { original: file, processed: file };
    configuration.stamps[track] = { original: file, processed: file };
    db.files.set(file, Buffer.from(track));
  }

  const roster = await (await api.GET(request("/api/admin/school-cards"))).json();
  assert.equal(roster.items.length, 3);
  const bilingual = roster.items.find(row => row.enrollmentId === home.id);
  assert.deepEqual(bilingual.classes.map(row => row.id), [french.id, arabic.id]);
  const arabicCard = roster.items.find(row => row.enrollmentId === arabicOnly.id);
  assert.equal(arabicCard.name, "عبد الرحمن محمد أمين");
  assert.deepEqual(arabicCard.classes.map(row => row.id), [arabic.id]);
  assert.deepEqual(roster.items.find(row => row.enrollmentId === frenchOnly.id).classes.map(row => row.id), [french.id]);

  const server = db.admin("src/lib/server/school-cards.ts");
  const scope = await server.cardScope();
  const batch = server.productionCardVisuals(scope, (await server.loadCardEnrollments(scope, year)).items);
  assert.equal(new Set(batch.map(card => card.studentId)).size, 3);
  assert.equal(batch.find(card => card.studentId === home.student_id).signatureSlot, "arabic");
  assert.equal(batch.find(card => card.studentId === arabicOnly.student_id).signatureSlot, "arabic");
  assert.equal(batch.find(card => card.studentId === frenchOnly.student_id).signatureSlot, "french");
  assert.ok(batch.every(card => !card.token));
  delete scope.configuration.signatures.french;
  delete scope.configuration.stamps.french;
  assert.equal(server.productionCardVisuals(scope, batch).find(card => card.studentId === frenchOnly.student_id).signatureSlot, null);

  const educator = db.addActor("educator");
  db.tables.educator_class_assignments = [
    { institution_id: db.legacyId, profile_id: educator, class_id: arabic.id, level: null },
  ];
  const scopedApi = db.load(educator)(path);
  const scoped = await (await scopedApi.GET(request("/api/admin/school-cards"))).json();
  assert.deepEqual(new Set(scoped.items.map(row => row.enrollmentId)), new Set([home.id, arabicOnly.id]));
  assert.deepEqual(scoped.items.find(row => row.enrollmentId === home.id).classes.map(row => row.id), [french.id, arabic.id]);
  assert.equal((await scopedApi.POST(request("/api/admin/school-cards", {
    year, enrollmentIds: [frenchOnly.id],
  }))).status, 403);
});

test("Other schools also combine linked classes and use the configured school director", async () => {
  const db = schoolCardFixture(1, true);
  const school = db.tables.institutions[0];
  const [home] = db.tables.class_enrollments;
  const [french, arabic] = db.tables.classes;
  school.settings_json.school_student_programs_v1.years[year].classes[arabic.id].linkedStudentIds = [home.student_id];
  const save = await db.admin(settings).PUT(request("/api/admin/school-cards/settings", {
    revision: 0, enabled: true, automaticSignature: true,
  }, "PUT"));
  assert.equal(save.status, 200);
  const file = `school-cards/${db.legacyId}/general/processed.png`;
  db.tables.school_card_settings[0].configuration.signatures = { general: { original: file, processed: file } };
  db.files.set(file, Buffer.from("general"));

  const server = db.admin("src/lib/server/school-cards.ts"), scope = await server.cardScope();
  const result = server.productionCardVisuals(scope, (await server.loadCardEnrollments(scope, year)).items);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].classes.map(row => row.id), [french.id, arabic.id]);
  assert.equal(result[0].signatureSlot, "general");
  assert.equal(result[0].signatoryName, school.head_name);
});

test("chunked signature upload rejects more than 6 MiB before multipart parsing or storage writes", async () => {
  const db = schoolCardFixture(1);
  const url = new URL("https://cards.example.invalid/api/admin/school-cards/signature");
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(6 * 1024 * 1024 + 1024)); },
  });
  const req = Object.assign(new Request(url, { method: "POST", headers: {
    origin: url.origin, "Content-Type": "multipart/form-data; boundary=fixture",
  }, body, duplex: "half" }), { nextUrl: url });
  assert.equal(req.headers.has("content-length"), false);
  const response = await db.admin("src/app/api/admin/school-cards/signature/route.ts").POST(req);
  assert.equal(response.status, 413);
  assert.equal(db.files.size, 0);
});

test("chunked preparation rejects over 24 KB without Supabase queries", async () => {
  const db = schoolCardFixture(1), api = db.admin(path), before = db.calls.length;
  const req = request("/api/admin/school-cards", { year, enrollmentIds: Array(700).fill(randomUUID()) });
  assert.equal(req.headers.has("content-length"), false);
  assert.equal((await api.POST(req)).status, 413);
  assert.equal(db.calls.filter(call => call.table === "class_enrollments").length,
    0, "oversized requests must be rejected before roster loading");
});
