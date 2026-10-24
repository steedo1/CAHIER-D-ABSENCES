import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = fs.readFileSync(new URL("../supabase/migrations/20261024053353_class_exceptional_session_guard.sql", import.meta.url), "utf8");

test("le verrou SQL protège Autre cours et conserve les cours groupés habituels", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE public.teacher_sessions (
        id text PRIMARY KEY, institution_id text, class_id text,
        status text, ended_at timestamptz, notes text
      );
    `);
    await db.exec(migration);
    const insert = (id, classId, manual) => db.query(
      "INSERT INTO teacher_sessions VALUES ($1,'school',$2,'open',null,$3)",
      [id, classId, manual ? "mon-cahier:autre-cours:v1" : null],
    );
    await insert("ordinary", "class-a", false);
    await assert.rejects(insert("exception", "class-a", true), /class_session_already_open/);
    await db.query("UPDATE teacher_sessions SET ended_at=now(),status='submitted' WHERE id='ordinary'");
    await insert("exception", "class-a", true);
    await assert.rejects(insert("second", "class-a", true), /class_session_already_open/);
    await assert.rejects(insert("ordinary-next", "class-a", false), /class_session_already_open/);
    await insert("other-class", "class-b", true);
    await insert("group-a", "class-c", false);
    await insert("group-b", "class-c", false);
    const privileges = await db.query(`SELECT
      has_function_privilege('anon','public.guard_exceptional_class_session()','execute') AS anon,
      has_function_privilege('authenticated','public.guard_exceptional_class_session()','execute') AS authenticated,
      prosecdef FROM pg_proc WHERE oid='public.guard_exceptional_class_session()'::regprocedure`);
    assert.deepEqual(privileges.rows, [{ anon: false, authenticated: false, prosecdef: false }]);
    const rows = await db.query("SELECT id FROM teacher_sessions ORDER BY id");
    assert.deepEqual(rows.rows.map((row) => row.id), ["exception", "group-a", "group-b", "ordinary", "other-class"]);
  } finally { await db.close(); }
});
