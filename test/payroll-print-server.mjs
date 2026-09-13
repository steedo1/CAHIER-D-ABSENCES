// Run from the repository root: node test/payroll-print-server.mjs
// Local synthetic fixture only; no credentials, API calls or generated files.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");
const js = await esbuild.build({ entryPoints:["test/payroll-print-fixture.tsx"], bundle:true, write:false, jsx:"automatic", define:{"process.env.NODE_ENV":'"development"'} });
const css = await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from:"src/app/globals.css" });
createServer((req,res) => {
  if (req.url === "/fixture.js") { res.setHeader("Content-Type","text/javascript"); res.end(js.outputFiles[0].text); }
  else if (req.url === "/fixture.css") { res.setHeader("Content-Type","text/css"); res.end(css.css); }
  else if (req.url === "/missing-logo.png") { res.statusCode=404; res.end(); }
  else { res.setHeader("Content-Type","text/html; charset=utf-8"); res.end('<!doctype html><html lang="fr"><head><title>Vérification paie — données fictives</title><link rel="stylesheet" href="/fixture.css"></head><body><aside>Navigation admin à masquer</aside><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
}).listen(4177,"127.0.0.1",() => console.log("Payroll fixture ready: http://127.0.0.1:4177/?auto"));
