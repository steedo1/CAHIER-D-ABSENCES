import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
const require = createRequire(import.meta.url);
export async function startClassListFixture() {
  const { build } = require("esbuild");
  const postcss = require("postcss");
  const tailwind = require("@tailwindcss/postcss");
  const js = await build({ entryPoints: ["test/class-list-print-fixture.tsx"], bundle: true,
    write: false, jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "fixture-navigation", setup(build) {
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents:
        'export const useParams = () => ({id:"fixture"}); export const usePathname = () => "/admin/classes/liste/fixture";' }));
    } }],
  });
  const css = await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" });
  const tuning = await readFile("src/app/class-list-print-tuning.css", "utf8");
  const server = createServer((req, res) => {
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(js.outputFiles[0].text); }
    else if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(css.css + tuning); }
    else { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<!doctype html><html lang="fr"><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
