import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Window } from "happy-dom";
import { NextRequest } from "next/server.js";
import { createFixtureRouteLoader } from "./helpers/multicycle-fixture.mjs";
import { setupComponents, cAr, cFr, cOther, subject } from "./helpers/subject-components-fixture.mjs";

const flush = async () => { await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));}); };
const change = async (node,value) => act(async()=>{
  assert.ok(node,"Input must be rendered");
  const key=Object.keys(node).find(key=>key.startsWith("__reactProps$"));
  if (key && node[key]?.onChange) node[key].onChange({target:{value}});
  else { node.value=value; node.dispatchEvent(new window.Event("change",{bubbles:true})); }
});

test("rendered classic table saves and reloads Arabic common-subject components through actual API handlers; class switch discards a late response",async()=>{
  const window=new Window({url:"https://example.invalid"});
  const keys=["window","document","navigator","IS_REACT_ACT_ENVIRONMENT","fetch"];
  const before=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const db=setupComponents(), load=createFixtureRouteLoader(db,db.legacyAdminId);
  const requests=[];
  let release, hold=false;
  const api=load("src/app/api/admin/institution/subject-components/route.ts");
  for(const [key,value] of Object.entries({window,document:window.document,navigator:window.navigator,IS_REACT_ACT_ENVIRONMENT:true,
    fetch:async(uri,options={})=>{
      const url=new URL(String(uri),"https://example.invalid"), method=options.method||"GET";
      requests.push({url,method});
      if(hold && url.pathname.endsWith("subject-components") && method==="GET") await new Promise(resolve=>{release=resolve;});
      const req=new NextRequest(url,{method,headers:{origin:url.origin,"content-type":"application/json"},...(options.body?{body:options.body}:{})});
      const handler=load("src/app"+url.pathname+"/route.ts");
      return handler[method](req);
    }})) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const container=window.document.createElement("div");window.document.body.append(container);
  const root=createRoot(container),Component=load("src/components/admin/SchoolCoefficientsClassicWorkflow.tsx").default;
  const button=text=>[...container.querySelectorAll("button")].find(node=>node.textContent.trim()===text);
  try{
    await act(async()=>{root.render(React.createElement(Component));});await flush();await flush();
    assert.equal(container.querySelectorAll("select").length,3);
    assert.ok(button("Ajouter / modifier les sous-matières"),"Common French discipline stays editable");
    await change(container.querySelector('[aria-label="Enseignement"]'),"arabic");await flush();await flush();
    await act(async()=>button("Ajouter / modifier les sous-matières").click());await flush();
    await act(async()=>button("+ Ajouter une sous-matière").click());
    await change(container.querySelector('[aria-label="Sous-matière 1"]'),"Calcul arabe");
    await change(container.querySelector('[aria-label="Coefficient sous-matière 1"]'),"5");
    await act(async()=>button("Enregistrer les sous-matières").click());await flush();
    assert.match(container.querySelector('[role="status"]').textContent,/Sous-matières enregistrées/);
    await act(async()=>button("Ajouter / modifier les sous-matières").click());await flush();
    assert.equal(container.querySelector('[aria-label="Sous-matière 1"]').value,"Calcul arabe");
    await change(container.querySelector('[aria-label="Sous-matière 1"]'),"Calcul modifié");
    await act(async()=>button("Enregistrer les sous-matières").click());await flush();
    const savedId=db.tables.grade_subject_components[0].id;
    assert.equal(db.tables.grade_subject_components[0].label,"Calcul modifié");
    await change(container.querySelector('[aria-label="Enseignement"]'),"french");await flush();await flush();
    await act(async()=>button("Ajouter / modifier les sous-matières").click());await flush();
    assert.equal(container.querySelector('[aria-label="Sous-matière 1"]'),null,"French remains empty");
    await act(async()=>button("Fermer").click());
    await change(container.querySelector('[aria-label="Enseignement"]'),"arabic");await flush();await flush();
    hold=true;
    await act(async()=>button("Ajouter / modifier les sous-matières").click());await flush();
    assert.ok(release);
    await change(container.querySelector('[aria-label="Niveau et classe"]'),cOther);await flush();await flush();
    await act(async()=>release());await flush();
    assert.equal(button("Enregistrer les sous-matières"),undefined,"Late response cannot reopen old class editor");
    assert.equal(db.tables.grade_subject_components[0].id,savedId);
    assert.ok(requests.some(row=>row.method==="PUT"&&row.url.pathname.endsWith("subject-components")));
    assert.equal(requests.some(row=>row.method==="PUT"&&row.url.pathname.endsWith("subject-coeffs")),false);
  }finally{
    await act(async()=>root.unmount());await window.happyDOM.close();
    for(const [key,value] of before){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}
  }
});
