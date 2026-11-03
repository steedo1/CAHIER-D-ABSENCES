import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { Window } from "happy-dom";

test("Arabic class-list screen opens corrections, saves a changed name and reloads it in the printable list", async () => {
  const output = await build({ entryPoints: ["test/class-list-print-fixture.tsx"], bundle: true,
    write: false, jsx: "automatic", format: "iife", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "test-navigation", setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents:
        'export const useParams=()=>({id:"fixture"});export const usePathname=()=>"/admin/classes/liste/fixture";' }));
    } }],
  });
  const window = new Window({ url: "https://example.invalid/?arabic=1&primary=1&count=3" });
  const errors = [], scrolled = [];
  window.addEventListener("error", event => errors.push(event.message));
  window.console.error = (...args) => errors.push(args.join(" "));
  window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.id); };
  const wait = async predicate => {
    const deadline = Date.now() + 5000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 15));
    assert.ok(predicate(), `${window.document.body.textContent.slice(-1200)}; errors=${errors}`);
  };
  const button = label => [...window.document.querySelectorAll("button")].find(row => row.textContent.includes(label));
  try {
    window.document.body.innerHTML = '<div id="root"></div>';
    window.eval(output.outputFiles[0].text);
    await wait(() => button("Corriger les noms en arabe"));
    button("Corriger les noms en arabe").click();
    await wait(() => window.document.querySelector('#arabic-name-corrections input'));
    await wait(() => scrolled.includes("arabic-name-corrections"));
    const input = window.document.querySelector('#arabic-name-corrections input');
    assert.equal(input.value, "محمد تراوري");
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, "محمّد تراوري");
    input.dispatchEvent(new window.InputEvent("input", { bubbles: true, data: "محمّد تراوري", inputType: "insertText" }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    button("Enregistrer les noms arabes").click();
    await wait(() => window.document.querySelector('[role="status"]')?.textContent.includes("1 nom(s) arabe(s) enregistré(s)"));
    assert.deepEqual(JSON.parse(JSON.stringify(window.__arabicNameSaves)), [
      [{ student_id: "s-0", full_name_ar: "محمّد تراوري" }],
    ]);
    assert.equal(window.document.querySelector('#arabic-name-corrections input').value, "محمّد تراوري");
    assert.match(window.document.querySelector('.roster-table tbody .col-name').textContent, /محمّد تراوري/);
    assert.deepEqual(errors, []);
  } finally { await window.happyDOM.close(); }
});
