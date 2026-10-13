import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(
  path.join(root, "src/app/admin/finance/payments/page.tsx"),
  "utf8",
);
const start = source.indexOf("async function fetchAllChargeBalancesForPayments(");
const end = source.indexOf("\nfunction StatCard(", start);
assert.ok(start !== -1 && end > start, "Le chargement des dettes doit rester testable");

const compiled = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
}).outputText;

const chunkArray = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

function makeLoader(pages) {
  const orderedColumns = [];
  const admin = {
    schema(name) {
      assert.equal(name, "finance");
      return this;
    },
    from(table) {
      assert.equal(table, "v_charge_balances");
      return this;
    },
    select() { return this; },
    eq() { return this; },
    in() { return this; },
    neq() { return this; },
    order(column) {
      orderedColumns.push(column);
      return this;
    },
    async range(from) {
      return { data: pages.get(from) ?? [], error: null };
    },
  };
  const loader = new Function(
    "getSupabaseServiceClient",
    "chunkArray",
    compiled + "\nreturn fetchAllChargeBalancesForPayments;",
  )(() => admin, chunkArray);
  return { loader, orderedColumns };
}

test("CSCA : 110 000 F ne sont pas comptés deux fois à la frontière de pagination", async () => {
  const amounts = [60000, 110000, 46500, 95000, 178500, 700000, 60000, 75000];
  const monhin = amounts.map((net_amount, i) => ({
    id: "charge-monhin-" + i,
    student_id: "MONHIN",
    net_amount,
  }));
  const other = Array.from({ length: 992 }, (_, i) => ({
    id: "autre-" + i,
    student_id: "OTHER",
    net_amount: 10,
  }));
  const { loader, orderedColumns } = makeLoader(new Map([
    [0, [...monhin, ...other]],
    [1000, [monhin[1]]], // Lecture concurrente : un UUID revient sur la page 2.
  ]));
  const rows = await loader({ institutionId: "csca", classIds: ["3e3"] });
  const matching = rows.filter((row) => row.student_id === "MONHIN");

  assert.equal(rows.length, 1000);
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);
  assert.equal(matching.length, 8);
  assert.equal(matching.reduce((sum, row) => sum + row.net_amount, 0), 1325000);
  assert.deepEqual(orderedColumns, ["due_date", "id", "due_date", "id"]);
});

test("une seule page préserve l'ensemble des dettes et leurs montants", async () => {
  const { loader, orderedColumns } = makeLoader(new Map([
    [0, [{ id: "x", net_amount: 95000 }, { id: "y", net_amount: 110000 }]],
  ]));
  const rows = await loader({ institutionId: "csca", classIds: ["3e3"] });
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((sum, row) => sum + row.net_amount, 0), 205000);
  assert.deepEqual(orderedColumns, ["due_date", "id"]);
});
