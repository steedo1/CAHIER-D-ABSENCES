// node test/general-statistics-print-server.mjs — local synthetic fixture.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
export async function startStatisticsFixture(port = 0) {
  const { build } = require("esbuild");
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const js = await build({ entryPoints: ["test/general-statistics-print-fixture.tsx"], bundle: true,
    write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  const css = await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" });
  const server = createServer((req, res) => {
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(js.outputFiles[0].text); }
    else if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(css.css); }
    else { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<!doctype html><html lang="fr"><head><title>Statistiques — données fictives</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await startStatisticsFixture(4178);
  console.log(`Statistics fixture ready: ${url}`);
}
