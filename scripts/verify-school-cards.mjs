import { performance } from "node:perf_hooks";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import PDFDocument from "pdfkit";
import { schoolCardFixture,request,year } from "../test/helpers/school-card-fixture.mjs";
import { renderCardPages } from "../src/lib/school-card-pdf.ts";
import { cardFingerprint, issueCardToken } from "../src/lib/school-card-token.ts";
process.env.SCHOOL_CARDS_ENABLED="true";
process.env.SCHOOL_CARD_QR_SECRET="isolated-test-secret-not-a-real-key-2026";
const output=process.env.CARD_TEST_OUTPUT || "tmp/school-cards";await mkdir(output,{recursive:true});
const font=new Uint8Array(await readFile("public/card-fonts/DejaVuSans.ttf"));
const metrics=[];
for(const count of [500,1000]) {
  const db=schoolCardFixture(count,true),api=db.admin("src/app/api/admin/school-cards/route.ts");
  const started=performance.now();let offset=0,rows=[];
  do {
    const response=await api.GET(request(`/api/admin/school-cards?year=${year}&offset=${offset}`));
    if(!response.ok) throw Error(JSON.stringify(await response.json()));
    const body=await response.json();rows.push(...body.items);offset=body.nextOffset;
  }while(offset!==null);
  const loadedAt=performance.now(),loadCalls=db.calls.length;
  const prepared=[];
  for(let i=0;i<rows.length;i+=100) {
    const response=await api.POST(request("/api/admin/school-cards",{year,enrollmentIds:rows.slice(i,i+100).map(row=>row.enrollmentId)}));
    if(!response.ok) throw Error(JSON.stringify(await response.json()));
    prepared.push(...(await response.json()).items);
  }
  const preparedAt=performance.now(),prepareCalls=db.calls.length-loadCalls;
  let bytes=0,peakRss=process.memoryUsage().rss;
  for(let i=0;i<prepared.length;i+=100) {
    const doc=new PDFDocument({autoFirstPage:false,bufferPages:false,compress:true});
    const chunks=[];const done=new Promise((resolve,reject)=>{doc.on("data",c=>chunks.push(c));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject)});
    renderCardPages(doc,prepared.slice(i,i+100),db.tables.institutions[0],{font,photos:new Map(),signatures:{}});doc.end();
    const pdf=await done;bytes+=pdf.length;
    if(count===500 && i===0) await writeFile(`${output}/sample-a4-recto-verso.pdf`,pdf);
    peakRss=Math.max(peakRss,process.memoryUsage().rss);
  }
  const finished=performance.now();
  metrics.push({count,rosterMs:+(loadedAt-started).toFixed(1),prepareMs:+(preparedAt-loadedAt).toFixed(1),pdfMs:+(finished-preparedAt).toFixed(1),loadSqlReads:loadCalls,prepareSqlReads:prepareCalls,sqlWrites:db.calls.filter(c=>c.op!=="read").length,qrTableCalls:db.calls.filter(c=>c.table==="bulletin_qr_codes").length,reprintSqlReads:0,pdfBytes:bytes,peakRssMiB:+(peakRss/1048576).toFixed(1),scope:"local synthetic transport; not live Supabase latency or browser RAM"});
}
// One deterministic single-card sample for an independent image decoder.
const db=schoolCardFixture(1),row=db.tables.class_enrollments[0],student=db.tables.students[0];
const token=issueCardToken({institutionId:db.legacyId,studentId:student.id,enrollmentId:row.id,classId:row.class_id,year});
const doc=new PDFDocument({autoFirstPage:false});const chunks=[];
const done=new Promise(resolve=>{doc.on("data",c=>chunks.push(c));doc.on("end",()=>resolve(Buffer.concat(chunks)))});
renderCardPages(doc,[{...student,enrollmentId:row.id,studentId:student.id,classId:row.class_id,name:"TRAORÉ Ousmane",year,birthPlace:"Yamoussoukro",classLabel:"CP1 FR",token,verificationUrl:`https://www.mon-cahier.com/verifier-carte#${token}`,fingerprint:cardFingerprint(token),tracks:[],warnings:[],photoUrl:null,revoked:false,signatureSlot:null,signatoryName:""}],db.tables.institutions[0],{font,photos:new Map(),signatures:{}},{individual:true});doc.end();
await writeFile(`${output}/sample-individual.pdf`,await done);
// Persist the actual RTL/mixed-script layout in the CI artifacts for review.
const arabicDoc=new PDFDocument({autoFirstPage:false}),arabicChunks=[];
const arabicDone=new Promise(resolve=>{arabicDoc.on("data",c=>arabicChunks.push(c));arabicDoc.on("end",()=>resolve(Buffer.concat(arabicChunks)))});
renderCardPages(arabicDoc,[{...student,studentId:student.id,name:"عبد الرحمن محمد أمين",matricule:"EPC260001",birthdate:"2016-05-12",birthPlace:"ياموسوكرو",gender:"M",classLabel:"القسم العربي ١",year,verificationUrl:`https://www.mon-cahier.com/verifier-carte#${token}`,fingerprint:"FICTIF RTL",signatureSlot:null}],{...db.tables.institutions[0],name:"EPC Dimbokro — مدرسة نموذجية"},{font,photos:new Map(),signatures:{}},{individual:true});arabicDoc.end();
await writeFile(`${output}/sample-arabic.pdf`,await arabicDone);
await writeFile(`${output}/expected-qr.txt`,`https://www.mon-cahier.com/verifier-carte#${token}`);
await writeFile(`${output}/metrics.json`,JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics,null,2));
