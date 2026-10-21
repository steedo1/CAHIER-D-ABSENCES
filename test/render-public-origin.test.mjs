import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isTrustedAppOrigin } from "../src/lib/request-origin.ts";

const request = (origin, internal = "http://localhost:10000", forwarded = {}) => ({
  headers: new Headers({...(origin === null ? {} : {origin}),...forwarded}), nextUrl: {origin:internal},
});
test("Render: les deux domaines officiels restent autorisés derrière le proxy TLS", () => {
  assert.equal(isTrustedAppOrigin(request("https://www.mon-cahier.com"),[]),true);
  assert.equal(isTrustedAppOrigin(request("https://mon-cahier.com"),[]),true);
});
test("un domaine étranger, une origine nulle ou une URL trompeuse restent refusés", () => {
  for(const origin of ["https://evil.invalid","null","https://www.mon-cahier.com.evil.invalid",
    "http://www.mon-cahier.com","https://www.mon-cahier.com:444","https://www.mon-cahier.com@evil.invalid",
    "https://evil.invalid@www.mon-cahier.com","https://www.mon-cahier.com/path",
    "https://www.mon-cahier.com?x=1","https://www.mon-cahier.com#x","file:///tmp/example"]) {
    assert.equal(isTrustedAppOrigin(request(origin),[]),false,origin);
  }
});
test("ni Host ni les en-têtes forwarded ne peuvent autoriser un site attaquant", () => {
  assert.equal(isTrustedAppOrigin(request("https://evil.invalid",undefined,{
    host:"evil.invalid","x-forwarded-host":"evil.invalid","x-forwarded-proto":"https",
    forwarded:"proto=https;host=evil.invalid"}),[]),false);
});
test("les clients sans Origin et le développement local gardent le contrat existant", () => {
  assert.equal(isTrustedAppOrigin(request(null),[]),true);
  assert.equal(isTrustedAppOrigin(request("http://localhost:3000","http://localhost:3000"),[]),true);
  assert.equal(isTrustedAppOrigin(request("http://localhost:3001","http://localhost:3000"),[]),false);
});
test("en production, le listener interne n'est jamais un domaine navigateur autorisé", () => {
  const previous=process.env.NODE_ENV;
  try {
    process.env.NODE_ENV="production";
    assert.equal(isTrustedAppOrigin(request("http://localhost:10000"),[]),false);
    assert.equal(isTrustedAppOrigin(request("https://evil.invalid","https://evil.invalid"),[]),false);
    assert.equal(isTrustedAppOrigin(request("https://www.mon-cahier.com"),[]),true);
  } finally {
    if(previous===undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=previous;
  }
});
test("une URL publique configurée est admise exactement, sans joker ni identifiants", () => {
  assert.equal(isTrustedAppOrigin(request("https://school.example"),["https://school.example"]),true);
  assert.equal(isTrustedAppOrigin(request("https://school.example.evil.invalid"),["https://school.example"]),false);
  assert.equal(isTrustedAppOrigin(request("https://school.example"),["https://user:secret@school.example"]),false);
  assert.equal(isTrustedAppOrigin(request("https://school.example"),["https://*.example"]),false);
});

const routes = [
  "super/institutions/route.ts", "super/create-admin/route.ts", "super/institutions/[id]/school-cycles/route.ts",
  "super/institutions/[id]/route.ts", "admin/bulletin-model-selection/route.ts", "admin/school-grading-periods/route.ts",
  "admin/teaching-import/preview/route.ts", "admin/institution/subject-components/route.ts",
  "admin/bulletin-templates/route.ts", "admin/grades/bulletin/route.ts", "admin/settings/route.ts",
];
test("tous les gardes d'origine concernés partagent la validation publique ; les refus sont conservés", () => {
  for(const path of routes) {
    const source=readFileSync(new URL("../src/app/api/"+path,import.meta.url),"utf8");
    assert.match(source,/isTrustedAppOrigin\(req\)/,path);
    assert.doesNotMatch(source,/origin\s*!==\s*req\.nextUrl\.origin/,path);
    assert.match(source,/status:\s*403|,\s*403\)/,path);
  }
});
