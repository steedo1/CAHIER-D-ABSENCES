import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("PostgreSQL migration: private tables, CAS revisions, transactional audits and tenant-safe revocation",async()=>{
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table public.institutions(id uuid primary key);create table public.class_enrollments(id uuid primary key,institution_id uuid);
    insert into institutions values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
    insert into class_enrollments values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111');
    grant select on class_enrollments to service_role;`);
  await db.exec(readFileSync(new URL("../supabase/migrations/20261025101927_school_cards_private_configuration.sql",import.meta.url),"utf8"));
  const rls=await db.query("select relname,relrowsecurity from pg_class where relname in ('school_card_settings','school_card_revocations','school_card_audit')");
  assert.ok(rls.rows.every(row=>row.relrowsecurity));
  for(const role of ["anon","authenticated"]) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query("select * from school_card_settings"),/permission denied/);
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  await db.exec(`insert into school_card_settings(institution_id,configuration,updated_by) values('11111111-1111-4111-8111-111111111111','{}','44444444-4444-4444-8444-444444444444');`);
  await db.exec(`update school_card_settings set configuration='{"enabled":false}',revision=2 where institution_id='11111111-1111-4111-8111-111111111111' and revision=1`);
  const stale=await db.query("update school_card_settings set revision=2 where institution_id='11111111-1111-4111-8111-111111111111' and revision=1 returning revision");assert.equal(stale.rows.length,0);
  await assert.rejects(db.exec("update school_card_settings set revision=4"),/invalid_card_revision/);
  await assert.rejects(db.exec(`insert into school_card_revocations(institution_id,enrollment_id,updated_by) values('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444')`),/cross_institution/);
  await db.exec(`insert into school_card_revocations(institution_id,enrollment_id,updated_by) values('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444')`);
  const audit=await db.query("select action from school_card_audit order by id");assert.deepEqual(audit.rows.map(row=>row.action),["configuration_updated","configuration_updated","card_revoked"]);
  await db.exec("reset role");await db.close();
});
