/** A deliberately isolated QA harness. Never use as the production start
 * command. It runs real module handlers with synthetic transport only. */
import {createServer} from "node:http";
import {randomUUID,randomBytes} from "node:crypto";
import {readFile} from "node:fs/promises";
import sharp from "sharp";
import {schoolCardFixture} from "../test/helpers/school-card-fixture.mjs";
process.env.SCHOOL_CARDS_ENABLED="true";
process.env.SCHOOL_CARD_QR_SECRET=randomBytes(48).toString("base64url");
if(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) throw Error("QA must never receive production Supabase credentials");
process.env.SUPABASE_SERVICE_ROLE_KEY=randomBytes(32).toString("hex");
const routes=new Map([
  ["/api/admin/school-cards","src/app/api/admin/school-cards/route.ts"],
  ["/api/admin/school-cards/orders","src/app/api/admin/school-cards/orders/route.ts"],
  ["/api/production-nexa","src/app/api/production-nexa/route.ts"],
  ["/api/production-nexa/preview","src/app/api/production-nexa/preview/route.ts"],
  ["/api/production-nexa/archive","src/app/api/production-nexa/archive/route.ts"],
  ["/api/admin/school-cards/settings","src/app/api/admin/school-cards/settings/route.ts"],
  ["/api/admin/school-cards/revoke","src/app/api/admin/school-cards/revoke/route.ts"],
  ["/api/admin/school-cards/signature","src/app/api/admin/school-cards/signature/route.ts"],
  ["/api/public/school-cards/verify","src/app/api/public/school-cards/verify/route.ts"],
]);
function prepareFixture(db) {
  const actor = randomUUID();
  const start = new Date().getUTCFullYear() - 1, end = start + 2;
  db.tables.academic_years[0].start_date = `${start}-01-01`;
  db.tables.academic_years[0].end_date = `${end}-12-31`;
  db.tables.class_enrollments.forEach(row => { row.start_date = `${start}-01-01`; });
  db.users.set(actor, { user: { ...db.user(actor, "production@example.invalid"), role: "nexa_production" } });
  db.tables.nexa_production_accounts = [{ user_id: actor, email: "production@example.invalid", status: "active", all_schools: true,
    permissions: ["cards.read", "cards.orders", "cards.generate", "cards.download"] }];
  db.tables.nexa_card_preparations = [];
  db.tables.nexa_card_orders = [];
  db.tables.nexa_card_archives = [];
  db.service.rpc = async (name, { p_school, p_year, p_actor, p_students, p_order }) => {
    if (name !== "nexa_prepare_cards") return { error: { message: "unknown RPC" } };
    for (const student_id of p_students) {
      if (!db.tables.nexa_card_preparations.some(item => item.student_id === student_id)) {
        db.tables.nexa_card_preparations.push({ institution_id: p_school, academic_year: p_year, student_id });
      }
    }
    if (!p_order) return { data: null, error: null };
    const existing = db.tables.nexa_card_orders.find(row => JSON.stringify(row.student_ids) === JSON.stringify(p_students));
    if (existing) return { data: existing.id, error: null };
    const id = randomUUID();
    db.tables.nexa_card_orders.push({ id, institution_id: p_school, academic_year: p_year, submitted_by: p_actor,
      student_ids: p_students, status: "pending", revision: 1, created_at: new Date().toISOString() });
    return { data: id, error: null };
  };
  const from = db.service.storage.from;
  db.service.storage.from = bucket => {
    const storage = from(bucket);
    return { ...storage, download: key => {
      const task = storage.download(key);
      return Object.assign(task, { asStream: async () => {
        const result = await task;
        return { data: result.data?.stream(), error: result.error };
      } });
    } };
  };
  return { db, actor: null, production: actor };
}
const sessions=new Map();
const server=createServer(async(req,res)=>{
  try {
    const origin=process.env.SCHOOL_CARD_PUBLIC_ORIGIN || `http://${req.headers.host || "localhost:" + server.address().port}`;
    process.env.SCHOOL_CARD_PUBLIC_ORIGIN=origin;
    const url=new URL(req.url,origin);
    res.setHeader("Cache-Control","no-store");res.setHeader("Referrer-Policy","no-referrer");res.setHeader("X-Robots-Tag","noindex, nofollow");
    const send=(data,status=200)=>{res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(data))};
    if(url.pathname==="/healthz") return send({ok:true,environment:"synthetic-qa",productionDatabase:false});
    if(url.pathname==="/qa/app.js"||url.pathname==="/qa/app.css") {res.setHeader("Content-Type",url.pathname.endsWith("js")?"application/javascript":"text/css");return res.end(await readFile(`tmp/school-cards-qa/${url.pathname.split("/").at(-1)}`));}
    if(url.pathname==="/card-fonts/DejaVuSans.ttf") {res.setHeader("Content-Type","font/ttf");return res.end(await readFile("public/card-fonts/DejaVuSans.ttf"));}
    if(url.pathname==="/qa/photo.jpg") {
      const id=(url.searchParams.get("id")||"").replace(/[^a-f0-9]/g,"").slice(0,32);
      // Unique, synthetic photographic-size noise textures. No real pupil image.
      const pixels=Buffer.alloc(240*320*3);let state=parseInt(id.slice(0,8)||"12345678",16);
      for(let p=0;p<pixels.length;p++){state=(Math.imul(state,1664525)+1013904223)|0;pixels[p]=state>>>24;}
      const jpg=await sharp(pixels,{raw:{width:240,height:320,channels:3}}).jpeg({quality:65}).toBuffer();
      res.setHeader("Content-Type","image/jpeg");return res.end(jpg);
    }
    let id=String(req.headers.cookie||"").split(";").map(s=>s.trim()).find(s=>s.startsWith("cardqa="))?.slice(7);
    if(!id||!sessions.has(id)){id=randomUUID();if(sessions.size>=20)sessions.delete(sessions.keys().next().value);sessions.set(id,prepareFixture(schoolCardFixture(12)));res.setHeader("Set-Cookie",`cardqa=${id}; Path=/; HttpOnly; SameSite=Lax${origin.startsWith("https")?"; Secure":""}`);}
    const session=sessions.get(id);
    if(!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/qa/")) {res.setHeader("Content-Type","text/html;charset=utf-8");return res.end(await readFile("tmp/school-cards-qa/index.html"));}
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)return send({error:"body_too_large"},413);chunks.push(chunk)}
    const raw=Buffer.concat(chunks);
    if(url.pathname==="/qa/setup"&&req.method==="POST"){
      const body=JSON.parse(raw);const n=body.scenario==="1000"?1000:body.scenario==="500"?500:12;
      const db=schoolCardFixture(n,body.scenario==="epc");
      Object.assign(session,prepareFixture(db));
      if (body.scenario === "epc") {
        const school = db.tables.institutions[0];
        school.code = "E020684";
        school.settings_json.school_student_programs_v1.years["2026-2027"].classes[db.tables.classes[1].id]
          .linkedStudentIds = [db.tables.students[0].id];
      }
      if(n>=500) db.tables.students.forEach(student=>{student.photo_path=`${db.legacyId}/${student.id}/photo.jpg`});
      if(body.scenario==="dieudonne")db.tables.institutions[0].name="COLLÈGE DIEUDONNÉ — DONNÉES FICTIVES";
      if(body.scenario==="educator") {session.actor=db.addActor("educator");db.tables.educator_class_assignments=[{institution_id:db.legacyId,profile_id:session.actor,class_id:db.tables.classes[0].id,level:null}];}
      return send({ok:true,count:n});
    }
    if(url.pathname==="/qa/metrics")return send({calls:session.db.calls,storageFiles:session.db.files.size,rss:process.memoryUsage().rss,synthetic:true});
    const archiveId = /^\/api\/production-nexa\/archive\/([a-f0-9-]+)$/.exec(url.pathname)?.[1];
    const route=archiveId ? "src/app/api/production-nexa/archive/[id]/route.ts" : routes.get(url.pathname);if(!route)return send({error:"not_found"},404);
    let db=session.db;
    if(url.pathname==="/api/public/school-cards/verify") {
      const {openCardToken}=db.admin("src/lib/school-card-token.ts"),payload=openCardToken(JSON.parse(raw).token);
      if(payload) db=[...sessions.values()].find(s=>s.db.legacyId===payload.institutionId && s.db.tables.class_enrollments.some(e=>e.id===payload.enrollmentId))?.db||db;
    }
    const actor = req.headers["x-qa-production"] === "true" ? session.production : session.actor;
    const loader=actor?db.load(actor):db.admin,handler=loader(route)[req.method];if(!handler)return send({error:"method_not_allowed"},405);
    const request=Object.assign(new Request(url,{method:req.method,headers:req.headers,...(["GET","HEAD"].includes(req.method)?{}:{body:raw})}),{nextUrl:url});
    const result=await handler(request, archiveId ? { params: Promise.resolve({ id: archiveId }) } : undefined);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
  }catch(error){console.error("QA request failed:",error.message);res.writeHead(500,{"Content-Type":"application/json"});res.end(JSON.stringify({error:"isolated_qa_failure"}))}
});
server.listen(Number(process.env.PORT||4397),"0.0.0.0",()=>console.log("Isolated school card QA listening; synthetic data only."));
