import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server.js";
import { setup, publish, year, cls, math, teacher } from "./helpers/primary-event-fixture.mjs";
import { createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

// Mount the actual TSX screens in Chromium, with the existing API handlers and
// an isolated in-memory Supabase transport. No production session or data writes.
for (const bulletinRole of ["admin", "file_correspondent"]) test(`browser: administrator calendar → teacher entry/publication → ${bulletinRole} bulletin screen`, { timeout: 180000 }, async () => {
  const db = setup();
  const settings = db.tables.institutions[0].settings_json;
  settings.school_teaching_signatories_v1 = { version: 1, french: { name: "DIRECTEUR FRANÇAIS TEST" }, arabic: { name: "DIRECTEUR ARABE TEST" } };
  db.tables.institutions[0].logo_url = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="green"/></svg>');
  db.tables.institutions[0].phone = "0700000000";
  const noDispatch = new Map([["src/lib/push-dispatch.ts", "export async function triggerPushDispatch(){return true;}"]]);
  db.teacher = createFixtureRouteLoader(db, teacher, noDispatch);
  const correspondentId = "77777777-7777-4777-8777-777777777777";
  db.users.set(correspondentId, { user: db.user(correspondentId, "correspondent@example.invalid") });
  db.tables.profiles.push({ id: correspondentId, institution_id: db.legacyId });
  db.tables.user_roles.push({ profile_id: correspondentId, institution_id: db.legacyId, role: "file_correspondent" });
  let bulletinReader = db.admin;
  const temp = await mkdtemp(path.join(tmpdir(), "primary-events-browser-"));
  const mocks = {
    "next/link": 'import React from "react";export default function Link({href,children,...p}){return React.createElement("a",{...p,href},children)}',
    "next/navigation": 'export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;export const useRouter=()=>({push(){},replace(){},refresh(){}});',
    "@/components/admin/SchoolNavigationProvider": bulletinRole === "file_correspondent"
      ? "export const useSchoolNavigation=()=>null;"
      : `export const useSchoolNavigation=()=>({settings:${JSON.stringify(settings.school_cycles_v1)},selection:{cycle:"primary",track:"all",level:"",classId:""},classes:[],href:x=>x});`,
    "@/app/admin/ui/admin-role-context": `export const useAdminRole=()=>${JSON.stringify(bulletinRole)};`,
    "@/hooks/useOnlineStatus": 'export const useOnlineStatus=()=>({isOnline:true});',
    "@/hooks/useEducationTeachingContext": 'export const useEducationTeachingContext=()=>({educationTypes:["general_secondary"],loading:false,formationsFor:()=>[],levelsFor:()=>[]});',
    "@/components/OfflineReadinessCard": 'export default function Empty(){return null}',
    "@/components/OfflineSyncBar": 'export default function Empty(){return null}',
    "@/lib/offline": 'export async function cacheSet(){}',
    "@/lib/offline-grades": `async function get(url){const r=await fetch(url),d=await r.json();if(!r.ok)throw Error(d.error||"API");return d;}
      export const gradesGetJson=get;
      ${["gradesClassesKey","gradesComponentsKey","gradesEvaluationsKey","gradesLockKey","gradesPeriodsKey","gradesRosterKey","gradesScoresKey","gradesSettingsKey"].map(name=>`export const ${name}=(...a)=>a.join(":");`).join("\n")}
      export async function saveGradesScores(role,payload){const r=await fetch('/api/teacher/grades/scores/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return {ok:r.ok,data:await r.json(),status:r.status};}`,
    "@/lib/offline-bulletins": `async function get(url){const r=await fetch(url),d=await r.json();if(!r.ok)throw Error(d.error||"API");return d;}
      export const getAdminBulletinClasses=()=>get('/api/admin/classes');
      export const getAdminBulletinSettings=()=>get('/api/admin/institution/settings');
      export const getAdminBulletinPeriods=()=>get('/api/admin/institution/grading-periods');
      export const getAdminBulletin=p=>get('/api/admin/grades/bulletin?'+p);
      export const getAdminBulletinConduct=()=>Promise.resolve({items:[]});
      export const adminBulletinDataKey=p=>'bulletin:'+p;`,
  };
  const output = await build({ stdin: { contents: `import React from "react";import{createRoot}from"react-dom/client";
    import Calendar from "./src/components/admin/PrimaryEvaluationEventsEditor";
    import Models from "./src/components/admin/SchoolBulletinModelPicker";
    import Grades from "./src/app/grades/page";import Bulletins from "./src/app/admin/bulletins/page";
    createRoot(document.getElementById('root')).render(location.pathname==='/models'?<Models/>:location.pathname==='/calendar'?<Calendar academicYear="${year}"/>:location.pathname==='/grades'?<Grades/>:<Bulletins/>);`,
    resolveDir: process.cwd(), loader: "tsx" }, bundle: true, jsx: "automatic", write: false, outdir: temp, entryNames: "app", minify: true,
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, plugins: [{ name: "isolated-shell", setup(builder) {
      builder.onResolve({filter: /.*/}, args => Object.hasOwn(mocks,args.path) ? {path:args.path,namespace:"fixture"}:undefined);
      builder.onLoad({filter: /.*/,namespace:"fixture"}, args=>({contents:mocks[args.path],loader:"js",resolveDir:process.cwd()}));
    } }] });
  const js = output.outputFiles.find(file => file.path.endsWith(".js")).text;
  const css = output.outputFiles.find(file => file.path.endsWith(".css"))?.text || "";
  const unexpected = [], requests = [];
  const server = createServer(async (request,response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname === "/app.js") { response.setHeader("Content-Type","text/javascript");response.end(js);return; }
      if (url.pathname === "/app.css") { response.setHeader("Content-Type","text/css");response.end(css);return; }
      if (!url.pathname.startsWith("/api/")) {response.end('<!doctype html><html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script src="/app.js"></script></body></html>');return;}
      let raw="";for await(const chunk of request)raw+=chunk;
      requests.push({path:url.pathname,query:url.search,method:request.method});
      const json = value => {response.setHeader("Content-Type","application/json");response.end(JSON.stringify(value));};
      if (url.pathname === "/api/admin/classes") return json({items:db.tables.classes});
      if (url.pathname === "/api/admin/institution/settings") return json({institution_name:"École fictive",institution_logo_url:db.tables.institutions[0].logo_url,settings_json:db.tables.institutions[0].settings_json});
      if (url.pathname.includes("grading-periods")) return json({items:[]});
      if (url.pathname.includes("/locks")) return json({lock:{is_locked:false}});
      if (url.pathname === "/api/teacher/institution/settings" || url.pathname === "/api/teacher/settings" || url.pathname === "/api/institution/settings") return json({academic_year:year,current_academic_year:year});
      let route;
      if (url.pathname === "/api/grades/classes") route=db.teacher("src/app/api/grades/classes/route.ts");
      else if (url.pathname.startsWith("/api/teacher/")) route=db.teacher(`src/app${url.pathname}/route.ts`);
      else if (url.pathname.startsWith("/api/admin/")) route=bulletinReader(`src/app${url.pathname}/route.ts`);
      if (!route?.[request.method]) {unexpected.push(url.pathname);return json({items:[]});}
      const apiRequest = new NextRequest(url, {method:request.method,headers:{...request.headers,"content-type":"application/json"},...(raw?{body:raw}:{})});
      const result = await route[request.method](apiRequest);
      response.statusCode=result.status;response.setHeader("Content-Type","application/json");response.end(await result.text());
    } catch(error) {unexpected.push(error.stack);response.statusCode=500;response.end(JSON.stringify({error:error.message}));}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base=`http://localhost:${server.address().port}`;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CLASS_LIST_CHROMIUM_EXECUTABLE||undefined,args:["--no-sandbox","--disable-gpu","--no-zygote"]});
  const page=await browser.newPage({viewport:{width:1440,height:1100}}), errors=[];
  page.on("pageerror",error=>errors.push(error.stack || error.message));
  try {
    await page.goto(base+"/models");
    await page.getByText("Aperçu A4 du modèle sélectionné", { exact: true }).waitFor();
    await page.getByLabel("Évaluation de démonstration", { exact: true }).selectOption("Évaluation de niveau");
    await page.getByText("Évaluation de niveau", { exact: true }).last().waitFor();
    assert.ok(await page.getByText("MAQUETTE · DONNÉES FICTIVES", { exact: true }).count());
    assert.ok(await page.locator("article").count());
    await page.getByLabel("Évaluation de démonstration", { exact: true }).selectOption("Composition de passage");
    await page.getByText("Moyenne générale annuelle", { exact: true }).first().waitFor();
    await page.goto(base+"/calendar");
    await page.getByRole("button",{name:"Enregistrer les évaluations",exact:true}).waitFor();
    await page.getByRole("button",{name:"+ Évaluation interne",exact:true}).click();
    const dates=page.locator('input[type="date"]');await dates.last().fill("2027-03-25");
    await page.getByRole("button",{name:"Enregistrer les évaluations",exact:true}).click();
    await page.getByRole("status").filter({hasText:"Calendrier des évaluations enregistré"}).waitFor();
    assert.equal(db.tables.institutions[0].settings_json.primary_evaluation_events_v1.years[year].events.filter(e=>e.label==="Évaluation de niveau").length,3);
    await page.goto(base+"/grades");
    const classSelect=page.getByLabel("Classe — Discipline",{exact:true});
    await classSelect.selectOption(`${cls}|${math}|french`);
    const kind=page.getByLabel("Type d’évaluation",{exact:true});
    await page.waitForFunction(()=>[...document.querySelectorAll('select[aria-label="Type d’évaluation"] option')].some(o=>o.value==="DEC"));
    assert.equal(await page.getByLabel("Période configurée",{exact:true}).count(),0);
    await kind.selectOption("DEC");
    assert.equal(await page.getByLabel("Date",{exact:true}).count(),0,"programmed date is not freely editable");
    await page.getByRole("button",{name:/Ajouter.*NOTE|Ajouter une note|Ajouter la note/i}).click();
    await page.getByText(/NOTE ajoutée/).waitFor();
    const scores=page.locator('input[type="number"][max="10"]').filter({visible:true});
    await scores.first().fill("8");
    await page.getByRole("button",{name:"Enregistrer",exact:true}).first().click();
    await page.getByText(/Notes enregistrées/).waitFor();
    assert.equal(db.tables.grade_evaluations[0].publication_status,"published","Enregistrer feeds the bulletin immediately");
    assert.equal(await page.getByRole("button",{name:/Publier/i}).count(),0);
    await page.getByRole("button",{name:"Statistiques",exact:true}).click();
    await page.getByRole("button",{name:"PDF",exact:true}).waitFor();
    await page.getByRole("button",{name:"Fermer",exact:true}).click();
    await classSelect.selectOption(`${cls}|${math}|arabic`);
    await page.waitForFunction(()=>document.body.innerText.includes("Enseignement arabe"));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('input[type="number"][max="10"]').count(),0,"French values disappear when changing teaching");
    assert.equal((await db.teacher("src/app/api/teacher/grades/evaluations/route.ts").GET(new NextRequest(base+`/api/teacher/grades/evaluations?class_id=${cls}&subject_id=${math}&teaching_track=arabic`))).status,200);
    // Complete the official Arabic event through the same tested handlers.
    await publish(db,"DEC","arabic",0.4);
    const cm2Class = "33333333-3333-4333-8333-222222222222";
    db.tables.classes.push({ ...db.tables.classes[0], id: cm2Class, level: "CM2", label: "CM2 Français" });
    db.tables.institutions[0].settings_json.primary_evaluation_events_v1.years[year].events.push({
      code: "CM2BLANC", kind: "mock", date: "2027-04-08", label: "Examen blanc CM2",
      levels: ["CM2"], tracks: ["french"], printBulletin: true,
    });
    bulletinReader = bulletinRole === "file_correspondent" ? createFixtureRouteLoader(db, correspondentId) : db.admin;
    const callsBeforeBulletins = db.calls.length;
    await page.goto(base+"/admin/bulletins");
    const select=page.locator("select").filter({has:page.locator(`option[value="${cls}"]`)});
    await select.last().selectOption(cls);
    await page.locator('#primary-bulletin-event option[value="DEC"]').waitFor({state:"attached"});
    await page.locator("#primary-bulletin-event").selectOption("DEC");
    await page.getByRole("button",{name:/Recharger/i}).first().click();
    await page.locator('select#specialized-bulletin-layout').waitFor();
    await page.locator('select#specialized-bulletin-layout').selectOption("french");
    await page.getByText("DIRECTEUR FRANÇAIS TEST",{exact:true}).first().waitFor();
    assert.ok(await page.getByAltText("Logo de l’établissement").first().isVisible());
    await page.locator('select#specialized-bulletin-layout').selectOption("arabic");
    await page.getByText("DIRECTEUR ARABE TEST",{exact:true}).first().waitFor();
    assert.equal(await page.getByText("DIRECTEUR FRANÇAIS TEST",{exact:true}).count(),0,"Arabic presentation uses its own director");
    await page.locator('select#specialized-bulletin-layout').selectOption("french");
    assert.ok(requests.some(r=>r.path==="/api/admin/grades/bulletin"&&r.query.includes("primary_event_code=DEC")));
    assert.ok(requests.some(r=>r.path==="/api/admin/institution/primary-evaluation-events"&&r.query.includes(`class_id=${cls}`)));
    assert.equal(db.calls.slice(callsBeforeBulletins).some(call=>call.op!=="read"),false,"bulletin consultation never changes notes or settings");
    assert.deepEqual(errors,[]);
    assert.deepEqual(unexpected,[]);
    if(process.env.PRIMARY_PRINT_OUTPUT) await page.screenshot({path:path.join(process.env.PRIMARY_PRINT_OUTPUT,"bulletin-browser.png"),fullPage:true});
    await page.getByRole("button",{name:"Changer de classe ou d’évaluation",exact:true}).click();
    const levelSelect = page.locator("select").filter({has:page.locator('option[value="CM2"]')});
    await levelSelect.selectOption("CM2");
    await page.locator("select").filter({has:page.locator(`option[value="${cm2Class}"]`)}).selectOption(cm2Class);
    await page.locator('#primary-bulletin-event option[value="CM2BLANC"]').waitFor({state:"attached"});
    assert.equal(await page.locator('#primary-bulletin-event option[value="PASS"]').count(),0,"CM2 never offers the primary passage composition");
    assert.equal(await page.locator('#primary-bulletin-event option[value="DEC"]').count(),0,"events from the previous class disappear");
    await levelSelect.selectOption("CP1");
    await select.last().selectOption(cls);
    await page.locator('#primary-bulletin-event option[value="DEC"]').waitFor({state:"attached"});
    assert.equal(await page.locator('#primary-bulletin-event').inputValue(),"","changing classes resets the selected event");
    assert.equal(await page.locator('#primary-bulletin-event option[value="CM2BLANC"]').count(),0);
  } catch (error) {
    console.error({ errors, unexpected, text: (await page.locator("body").innerText()).slice(-7000), requests: requests.slice(-10) });
    throw error;
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});

