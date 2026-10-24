// Exécuter uniquement sur un cluster PostgreSQL local jetable (aucune URL Cloud).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const port = process.env.MON_CAHIER_AUDIT_PG_PORT;
if (!port || !/^\d{4,5}$/.test(port)) throw new Error("MON_CAHIER_AUDIT_PG_PORT doit désigner le cluster local jetable.");
const executable = process.env.MON_CAHIER_AUDIT_PSQL || "psql";
const database = `mon_cahier_guard_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
function sql(query, db = database, allowFailure = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-X", "-h", "127.0.0.1", "-p", port, "-U", "audit", "-d", db, "-v", "ON_ERROR_STOP=1", "-At"], { windowsHide: true });
    let output = "", errors = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { errors += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 || allowFailure
      ? resolve({ code, output, errors }) : reject(new Error(errors)));
    child.stdin.end(query);
  });
}

await sql(`CREATE DATABASE ${database};`, "postgres");
try {
  await sql(`DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE TABLE public.teacher_sessions (
      id text PRIMARY KEY, institution_id text, class_id text,
      status text, ended_at timestamptz, notes text
    );`);
  await sql(fs.readFileSync(new URL("../supabase/migrations/20261024053353_class_exceptional_session_guard.sql", import.meta.url), "utf8"));
  const first = sql(`BEGIN;
    INSERT INTO teacher_sessions VALUES ('a','school','class-a','open',null,'mon-cahier:autre-cours:v1');
    SELECT pg_sleep(1); COMMIT;`);
  const second = sql(`BEGIN;
    INSERT INTO teacher_sessions VALUES ('b','school','class-a','open',null,'mon-cahier:autre-cours:v1');
    SELECT pg_sleep(1); COMMIT;`, database, true);
  const results = await Promise.allSettled([first, second]);
  const successes = results.filter((result) => result.status === "fulfilled" && result.value.code === 0);
  assert.equal(successes.length, 1, JSON.stringify(results));
  const failure = results.find((result) => result.status === "rejected" || result.value.code !== 0);
  assert.match(failure.status === "rejected" ? String(failure.reason) : failure.value.errors, /class_session_already_open/);
  assert.equal((await sql("SELECT count(*) FROM teacher_sessions;")).output.trim(), "1");
  await sql("UPDATE teacher_sessions SET status='submitted',ended_at=now(); INSERT INTO teacher_sessions VALUES ('c','school','class-a','open',null,'mon-cahier:autre-cours:v1');");
  assert.equal((await sql("SELECT count(*) FROM teacher_sessions;")).output.trim(), "2");
  console.log("PASS: deux connexions concurrentes, une seule ouverture, puis cours suivant après clôture.");
} finally {
  await sql(`DROP DATABASE ${database};`, "postgres");
}
