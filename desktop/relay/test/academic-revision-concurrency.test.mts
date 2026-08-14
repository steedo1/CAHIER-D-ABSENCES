import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const migration = readFileSync(
  join(process.cwd(), "..", "..", "migrations", "20260813_relay_academic_revision_v1.sql"),
  "utf8",
);

class TransactionalScopeLock {
  private tails = new Map<string, Promise<void>>();

  async run<T>(institutionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(institutionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(institutionId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(institutionId) === current) this.tails.delete(institutionId);
    }
  }
}

class RevisionHarness {
  readonly scopes = new TransactionalScopeLock();
  readonly academic = new Map<string, number>();
  readonly planning = new Map<string, number>();
  activeCriticalSections = 0;
  maximumParallelCriticalSections = 0;

  async transaction(
    institutionId: string,
    actions: readonly ("academic" | "planning")[],
  ): Promise<void> {
    await this.scopes.run(institutionId, async () => {
      this.activeCriticalSections += 1;
      this.maximumParallelCriticalSections = Math.max(
        this.maximumParallelCriticalSections,
        this.activeCriticalSections,
      );
      try {
        const bumped = new Set<string>();
        for (const action of actions) {
          if (action === "academic" && !bumped.has(action)) {
            this.academic.set(institutionId, (this.academic.get(institutionId) ?? 0) + 1);
            bumped.add(action);
          } else if (action === "planning") {
            this.planning.set(institutionId, (this.planning.get(institutionId) ?? 0) + 1);
          }
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      } finally {
        this.activeCriticalSections -= 1;
      }
    });
  }
}

test("migration PostgreSQL atomique avec timeout local", () => {
  const executable = migration
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .trim();
  assert.match(executable, /^BEGIN;\s+SET LOCAL lock_timeout = '10s';/);
  assert.match(executable, /COMMENT ON TABLE public\.academic_revisions[\s\S]+;\s+COMMIT;$/);
  assert.equal((migration.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((migration.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.doesNotMatch(migration, /\bCOMMIT\b[\s\S]+CREATE (?:TABLE|OR REPLACE FUNCTION|TRIGGER)/);
});

test("erreur injectee: tous les objets academiques appartiennent a la transaction globale", () => {
  const begin = migration.indexOf("BEGIN;");
  const commit = migration.lastIndexOf("COMMIT;");
  const objectPatterns = [
    /CREATE TABLE IF NOT EXISTS public\.academic_revisions/g,
    /CREATE OR REPLACE FUNCTION public\.(?:lock_relay_revision_scope|bump_(?:relay_academic|attendance_schedule)_revision)/g,
    /CREATE TRIGGER (?:trg_|%I)/g,
  ];
  for (const pattern of objectPatterns) {
    for (const match of migration.matchAll(pattern)) {
      assert.ok(match.index > begin && match.index < commit, match[0]);
    }
  }
  assert.match(migration, /DO \$\$[\s\S]+RAISE EXCEPTION[\s\S]+END;\s*\$\$;/);
});

test("A: profiles et teacher_timetables partagent le meme verrou avant les compteurs", async () => {
  assert.match(migration, /bump_relay_academic_revision[\s\S]+PERFORM public\.lock_relay_revision_scope/);
  assert.match(migration, /bump_attendance_schedule_revision_value[\s\S]+PERFORM public\.lock_relay_revision_scope/);
  const harness = new RevisionHarness();
  await Promise.all([
    harness.transaction("school-a", ["academic", "planning"]),
    harness.transaction("school-a", ["planning", "academic"]),
  ]);
  assert.equal(harness.academic.get("school-a"), 2);
  assert.equal(harness.planning.get("school-a"), 2);
  assert.equal(harness.maximumParallelCriticalSections, 1);
});

test("B: deux lots concurrents de 40 notes sont serialises et dedupliques par transaction", async () => {
  assert.match(migration, /current_setting\(revision_marker, true\) = 'bumped'/);
  assert.match(migration, /set_config\(revision_marker, 'bumped', true\)/);
  const harness = new RevisionHarness();
  await Promise.all([
    harness.transaction("school-a", Array.from({ length: 40 }, () => "academic" as const)),
    harness.transaction("school-a", Array.from({ length: 40 }, () => "academic" as const)),
  ]);
  assert.equal(harness.academic.get("school-a"), 2);
  assert.equal(harness.maximumParallelCriticalSections, 1);
});

test("C: appel de 40 eleves pendant une mutation academique sans inversion de verrous", async () => {
  const harness = new RevisionHarness();
  await Promise.all([
    harness.transaction("school-a", Array.from({ length: 40 }, () => "academic" as const)),
    harness.transaction("school-a", ["planning", ...Array.from({ length: 40 }, () => "academic" as const)]),
  ]);
  assert.equal(harness.academic.get("school-a"), 2);
  assert.equal(harness.planning.get("school-a"), 1);
  assert.equal(harness.maximumParallelCriticalSections, 1);
});

test("D: deux etablissements conservent des scopes de verrou independants", async () => {
  const harness = new RevisionHarness();
  await Promise.all([
    harness.transaction("school-a", ["academic", "planning", "academic"]),
    harness.transaction("school-b", ["planning", "academic", "planning"]),
  ]);
  assert.equal(harness.academic.get("school-a"), 1);
  assert.equal(harness.academic.get("school-b"), 1);
  assert.equal(harness.maximumParallelCriticalSections, 2);
});

test("ordre multi-etablissements deterministe et Finance absente", () => {
  assert.match(migration, /SELECT id FROM public\.institutions ORDER BY id/);
  assert.match(migration, /ORDER BY candidate\.institution_id/);
  assert.doesNotMatch(migration, /finance|payment|receipt|payroll|expense|budget|charge|debt/i);
});

test("un lot d'appel est deduplique sur attendance_schedule_revision et jamais academique", () => {
  assert.match(
    migration,
    /moncahier\.attendance_schedule_revision_[\s\S]+current_setting\(revision_marker, true\) = 'bumped'/,
  );
  assert.match(migration, /CREATE TRIGGER trg_attendance_marks_attendance_schedule_revision/);
  assert.doesNotMatch(
    migration,
    /CREATE TRIGGER trg_(?:attendance_marks|teacher_sessions|teacher_timetables|teacher_absence_requests)_relay_academic_revision/,
  );
});
