import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const school = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const actor = "33333333-3333-4333-8333-333333333333";
const a = "44444444-4444-4444-8444-444444444444";
const b = "55555555-5555-4555-8555-555555555555";
const year = "2026-2027";
const migration = await readFile(new URL("../supabase/migrations/20261114190251_production_nexa.sql", import.meta.url), "utf8");

test("Production Nexa SQL enforces default deny, distinct selections, order transitions, immutable versions and audits", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create schema storage; create table storage.objects(bucket_id text);
      alter table storage.objects enable row level security;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      grant usage on schema storage to anon,authenticated; grant select on storage.objects to anon,authenticated;
      create table public.institutions(id uuid primary key);
      create function public.fn_upsert_role(uuid,uuid,text) returns void language sql as 'select';
      grant execute on function public.fn_upsert_role(uuid,uuid,text) to service_role;
      insert into public.institutions values ('${school}'),('${other}');
      insert into auth.users values ('${actor}');
    `);
    await db.exec(migration);
    assert.deepEqual((await db.query("select id,public,file_size_limit from storage.buckets")).rows,
      [{ id: "nexa-production-cards", public: false, file_size_limit: 12582912 }]);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      for (const table of ["nexa_production_accounts", "nexa_card_preparations", "nexa_card_orders", "nexa_card_archives", "nexa_production_audit"]) {
        await assert.rejects(db.query(`select * from ${table}`), /permission denied/);
      }
      await assert.rejects(db.query("select fn_upsert_role($1,$2,'super_admin')", [actor, school]), /permission denied/);
      await assert.rejects(db.query("select nexa_prepare_cards($1,$2,$3,$4,true)", [school, year, actor, [a]]), /permission denied/);
      assert.equal((await db.query("select * from storage.objects")).rows.length, 0);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    await db.query("insert into nexa_production_accounts(user_id,email,permissions,actor_id) values($1,'nexa@example.invalid',array['cards.read'],$1)", [actor]);
    await db.query("update nexa_production_accounts set status='disabled',revision=2 where user_id=$1", [actor]);
    await db.query("update nexa_production_accounts set status='revoked',revision=3 where user_id=$1", [actor]);
    await assert.rejects(db.query("update nexa_production_accounts set status='active',revision=4 where user_id=$1", [actor]), /invalid_account_transition/);
    const submit = async (ids, order = true) => (await db.query("select nexa_prepare_cards($1,$2,$3,$4,$5) as id", [school, year, actor, ids, order])).rows[0].id;
    await submit([a], false);
    const orderId = await submit([b,a,a]);
    assert.equal(await submit([a,b]), orderId);
    assert.equal((await db.query("select * from nexa_card_preparations")).rows.length, 2);
    await assert.rejects(db.query("update nexa_card_orders set status='completed',revision=2"), /invalid_order_transition/);
    await db.query("update nexa_card_orders set status='preparing',revision=2");
    await assert.rejects(db.query("update nexa_card_orders set status='ready',revision=3"), /order_production_incomplete/);
    const save = (id, previous, version, institution = school) => db.query(`insert into nexa_card_archives
      (id,institution_id,academic_year,order_id,previous_id,version,batch_key,student_ids,students,object_path,size_bytes,format,flip,actor_id)
      values($1,$2,$3,$4,$5,$6,'batch',$7,$8,$1::uuid::text||'.pdf',100,'pvc','long',$9)`, [
        id,institution,year,orderId,previous,version,[a,b],JSON.stringify([{id:a},{id:b}]),actor,
      ]);
    await assert.rejects(save(a,null,1,other), /invalid_production_order|foreign key/);
    await save(a,null,1);
    await db.query("update nexa_card_orders set status='ready',revision=3");
    await db.query("update nexa_card_orders set status='completed',revision=4");
    await save(b,a,2);
    await assert.rejects(db.query("update nexa_card_archives set size_bytes=9"), /permission denied/);
    const { rows } = await db.query("select action from nexa_production_audit order by id");
    assert.deepEqual(rows.map(row => row.action), ["created","updated","updated","cards_prepared","order_submitted",
      "order_updated","generated","order_updated","order_updated","regenerated"]);
  } finally { await db.close(); }
});
