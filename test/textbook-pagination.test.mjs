import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/textbook/read-all.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
});
const { readAllTextbookRows } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

function database(rows, failAt = -1) {
  const ranges = [];
  let factories = 0;
  return {
    ranges,
    get factories() { return factories; },
    query() {
      factories++;
      return {
        order(column, options) {
          assert.equal(column, "id");
          assert.equal(options.ascending, true);
          return this;
        },
        async range(from, to) {
          ranges.push([from, to]);
          return from === failAt
            ? { data: null, error: { message: "page unavailable" } }
            : { data: rows.slice(from, to + 1), error: null };
        },
      };
    },
  };
}

test("all 1,480 CSCA progression items reach the monitor", async () => {
  const rows = Array.from({ length: 1480 }, (_, i) => ({ id: String(i), progression_id: `p${i % 48}` }));
  const db = database(rows);
  const result = await readAllTextbookRows(() => db.query());
  assert.equal(result.error, null);
  assert.deepEqual(result.data, rows);
  assert.deepEqual(db.ranges, [[0, 499], [500, 999], [1000, 1499]]);
  assert.equal(db.factories, 3);
});

test("a later-page failure cannot publish partial progress totals", async () => {
  const db = database(Array.from({ length: 1480 }, (_, i) => ({ id: String(i) })), 1000);
  const result = await readAllTextbookRows(() => db.query());
  assert.equal(result.data, null);
  assert.equal(result.error.message, "page unavailable");
});

test("an exact page boundary ends on an empty page without duplicates", async () => {
  const db = database(Array.from({ length: 1000 }, (_, i) => ({ id: String(i) })));
  const result = await readAllTextbookRows(() => db.query());
  assert.equal(result.data.length, 1000);
  assert.equal(db.ranges.length, 3);
});

test("empty results remain empty", async () => {
  const db = database([]);
  assert.deepEqual(await readAllTextbookRows(() => db.query()), { data: [], error: null });
  assert.equal(db.ranges.length, 1);
});
