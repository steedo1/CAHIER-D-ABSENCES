import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { NextRequest } from "next/server.js";
import { setup, create, report, cls, math, teacher, pupil0 } from "./helpers/primary-event-fixture.mjs";
import { createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";

// Actual React screens and API handlers, with an isolated database transport.
for (const role of ["teacher", "class_device"]) test(`${role}: actual primary screen saves once and opens statistics PDF without publication or CSV controls`, async () => {
  const db = setup(), ev = await create(db, "DEC");
  let actor = teacher;
  if (role === "class_device") {
    actor = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    db.users.set(actor, { user: db.user(actor, "class@example.invalid") });
    db.tables.profiles.push({ id: actor, institution_id: db.legacyId });
    db.tables.user_roles.push({ profile_id: actor, institution_id: db.legacyId, role: "class_device" });
    db.tables.classes[0].class_device_auth_user_id = actor;
  }
  const load = createFixtureRouteLoader(db, actor);
  const mocks = {
    "next/link": 'import React from "react";export default function Link({href,children,...p}){return React.createElement("a",{...p,href},children)}',
    "next/navigation": 'export const useSearchParams=()=>new URLSearchParams(location.search);export const usePathname=()=>location.pathname;export const useRouter=()=>({push(){},replace(){},refresh(){}});',
    "@/hooks/useOnlineStatus": 'export const useOnlineStatus=()=>({isOnline:true});',
    "@/hooks/useEducationTeachingContext": 'export const useEducationTeachingContext=()=>({educationTypes:["general_secondary"],loading:false,formationsFor:()=>[],levelsFor:()=>[]});',
    "@/lib/offline": 'export async function cacheSet(){};export async function cacheDeleteByPrefixes(){}',
    "@/lib/offline-grades": `async function get(url){const r=await fetch(url),d=await r.json();if(!r.ok)throw Error(d.error||"API");return d;}
      export const gradesGetJson=get;
      ${["gradesClassesKey","gradesComponentsKey","gradesEvaluationsKey","gradesLockKey","gradesPeriodsKey","gradesRosterKey","gradesScoresKey","gradesSettingsKey"].map(name=>`export const ${name}=(...a)=>a.join(":");`).join("\n")}
      export async function saveGradesScores(role,payload){const r=await fetch(role==='teacher'?'/api/teacher/grades/scores/bulk':'/api/grades/scores/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return {ok:r.ok,data:await r.json(),status:r.status};}`,
  };
  const output = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Grades from './src/app/grades/${role === "teacher" ? "page" : "class-device/page"}';createRoot(document.getElementById('root')).render(<Grades/>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, jsx: "automatic", write: false, format: "iife", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, plugins: [{ name: "fixture", setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "fixture" } : undefined);
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "js", resolveDir: process.cwd() }));
    } }] });
  const window = new Window({ url: "https://fixture.invalid/grades" }), errors = [], calls = [];
  window.addEventListener("error", event => errors.push(event.message));
  window.console.error = (...args) => errors.push(args.join(" "));
  window.console.log = () => {};
  let pdf = "";
  window.open = () => ({ document: { open(){}, write(html){pdf=html;}, close(){} }, focus(){}, print(){} });
  window.fetch = async (input, options = {}) => {
    const url = new URL(String(input), window.location.href), method = options.method || "GET";
    calls.push({ path: url.pathname, method });
    if (url.pathname.endsWith("/settings")) return new Response(JSON.stringify({ academic_year: "2026-2027", current_academic_year: "2026-2027" }));
    if (url.pathname.includes("grading-periods")) return new Response('{"items":[]}');
    if (url.pathname.includes("/locks")) return new Response('{"lock":{"is_locked":false}}');
    const route = load(`src/app${url.pathname}/route.ts`);
    assert.equal(typeof route[method], "function", url.pathname);
    return route[method](new NextRequest(url, { method, headers: { origin: url.origin, "Content-Type": "application/json" }, ...(options.body ? { body: options.body } : {}) }));
  };
  const wait = async predicate => {
    const deadline = Date.now() + 8000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 15));
    assert.ok(predicate(), `${window.document.body.textContent?.slice(-1800)}; errors=${errors}`);
  };
  const button = text => [...window.document.querySelectorAll("button")].find(el => el.textContent.trim() === text);
  try {
    window.document.body.innerHTML = '<div id="root"></div>';
    window.eval(output.outputFiles[0].text);
    await wait(() => window.document.querySelector(`option[value="${cls}|${math}|french"]`));
    const select = window.document.querySelector('select[aria-label="Classe — Discipline"]');
    select.value = `${cls}|${math}|french`;
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    await wait(() => window.document.querySelector('input[type="number"][max="10"]') && button("Statistiques"));
    assert.equal([...window.document.querySelectorAll("button")].some(el => /Publier|Gérer la publication|CSV|Excel/i.test(el.textContent)), false);
    // Let catalog/roster effects settle before interacting with the current input.
    await window.happyDOM.whenAsyncComplete();
    await new Promise(resolve => setTimeout(resolve, 100));
    const score = window.document.querySelector('input[type="number"][max="10"]');
    await wait(() => !score.disabled && !button("Statistiques").disabled);
    score.focus();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(score, "8");
    score.dispatchEvent(new window.InputEvent("input", { bubbles: true, data: "8", inputType: "insertText" }));
    score.dispatchEvent(new window.Event("change", { bubbles: true }));
    await wait(() => !button("Enregistrer").disabled);
    button("Enregistrer").click();
    await wait(() => db.tables.grade_evaluations.find(row => row.id === ev.id).is_published);
    assert.equal((await report(db, "DEC")).specialized.documents.find(row => row.studentId === pupil0).document.french.generalAverage, 8);
    await wait(() => window.document.body.textContent.includes("disponibles pour le bulletin"));
    button("Statistiques").click();
    await wait(() => button("PDF"));
    button("PDF").click();
    assert.match(pdf, /8[,.]00/);
    assert.match(pdf, /Fiche|statistique/i);
    assert.equal(calls.filter(c => c.method === "POST" && c.path.endsWith("/scores/bulk")).length, 1);
    assert.equal(calls.some(c => c.method === "PATCH"), false, "no separate publication action");
    assert.deepEqual(errors, []);
  } finally { await window.happyDOM.close(); }
});
