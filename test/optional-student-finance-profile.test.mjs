import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const require = createRequire(import.meta.url);

function loadFinanceSync(srv) {
  const source = ts.transpileModule(
    read("src/lib/finance/student-finance-sync.ts"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const loadedModule = { exports: {} };
  const mocks = {
    "@/lib/supabaseAdmin": { getSupabaseServiceClient: () => srv },
    "@/lib/finance/charge-rules": {},
    "@/lib/finance/class-transfer": {},
  };
  new Function("require", "module", "exports", source)(
    (id) => mocks[id] ?? require(id),
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}

test("la correction d'identité n'impose ni affectation ni internat", () => {
  const panel = read("src/components/ClassListCorrectionsPanel.tsx");
  const roster = read("src/app/api/admin/classes/[id]/roster/route.ts");

  assert.doesNotMatch(panel, /const incompleteFinance/);
  assert.doesNotMatch(panel, /Complétez Affecté\/Non affecté/);
  assert.doesNotMatch(roster, /missing_finance_profile/);
  assert.doesNotMatch(roster, /Affectation et internat sont obligatoires/);
  assert.match(roster, /is_affecte: isAffecte/);
  assert.match(roster, /is_boarder: isBoarder/);
});

test("les deux formulaires d'inscription acceptent les statuts vides", () => {
  const classList = read("src/app/admin/classes/liste/[id]/page.tsx");
  const parents = read("src/app/admin/parents/page.tsx");

  assert.match(
    classList,
    /affectationValue === "" \? null : affectationValue === "true"/,
  );
  assert.match(
    classList,
    /boardingValue === "" \? null : boardingValue === "true"/,
  );
  assert.doesNotMatch(
    classList,
    /value=\{newStudentForm\.is_(?:affecte|boarder)\}[\s\S]{0,220}?required/,
  );
  assert.match(
    parents,
    /form\.new_is_affecte === ""[\s\S]{0,80}?\? null/,
  );
  assert.match(
    parents,
    /form\.new_is_boarder === ""[\s\S]{0,80}?\? null/,
  );
  assert.doesNotMatch(parents, /Renseignez Affecte\/Non affecte/);
});

test("un établissement sans module Finance ne lance aucune synchronisation financière", async () => {
  const financeSync = read("src/lib/finance/student-finance-sync.ts");

  assert.match(
    financeSync,
    /\.from\("institution_finance_module_settings"\)[\s\S]*?\.select\("finance_premium_enabled"\)/,
  );
  assert.match(
    financeSync,
    /if \(!shouldSynchronizeFinance\) \{[\s\S]*?rollback: async \(\) => undefined/,
  );
  assert.match(
    financeSync,
    /if \(!financeModuleEnabled\) \{[\s\S]*?emptyTransferResult\(sourceClassIds\)/,
  );

  let financeSchemaCalls = 0;
  const srv = {
    from(table) {
      assert.equal(table, "institution_finance_module_settings");
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return {
            data: { finance_premium_enabled: false },
            error: null,
          };
        },
      };
    },
    schema() {
      financeSchemaCalls += 1;
      throw new Error("La finance ne doit pas être interrogée");
    },
  };
  const sync = loadFinanceSync(srv);

  const correction = await sync.applyStudentFinanceReconciliation({
    srv,
    institutionId: "school-without-finance",
    userId: "user",
    studentId: "student",
    classId: "class",
  });
  const enrollment = await sync.synchronizeStudentFinance({
    srv,
    institutionId: "school-without-finance",
    userId: "user",
    studentId: "student",
    sourceClassIds: ["old-class"],
    targetClass: { id: "new-class", academic_year: "2026-2027" },
  });

  assert.equal(financeSchemaCalls, 0);
  assert.equal(correction.summary.inserted, 0);
  assert.equal(enrollment.transfer.attempted, false);
  assert.deepEqual(enrollment.transfer.source_class_ids, ["old-class"]);
});
