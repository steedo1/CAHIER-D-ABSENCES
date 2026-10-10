import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const school = '10000000-0000-0000-0000-000000000001';
const otherSchool = '10000000-0000-0000-0000-000000000002';
const student = '20000000-0000-0000-0000-000000000001';
const otherStudent = '20000000-0000-0000-0000-000000000002';
const blankMatricule = '20000000-0000-0000-0000-000000000003';
const finance = '30000000-0000-0000-0000-000000000001';
const admin = '30000000-0000-0000-0000-000000000002';
const correspondent = '30000000-0000-0000-0000-000000000003';
const teacher = '30000000-0000-0000-0000-000000000004';
const op = '40000000-0000-0000-0000-000000000001';
const op2 = '40000000-0000-0000-0000-000000000002';
const op3 = '40000000-0000-0000-0000-000000000003';
const db = new PGlite();
await db.exec(`
 create role service_role bypassrls; create role anon; create role authenticated;
 create table public.institutions(id uuid primary key,name text);
 create table public.profiles(id uuid primary key,institution_id uuid);
 create table public.students(id uuid primary key,institution_id uuid,matricule text,last_name text,first_name text);
 create table public.user_roles(profile_id uuid,institution_id uuid,role text);
 create schema finance; create table finance.charges(id integer,amount integer); insert into finance.charges values(1,100000);
 create table public.student_grades(id integer,score integer); insert into public.student_grades values(1,17);
 insert into public.institutions values ('${school}','École A'),('${otherSchool}','École B');
 insert into public.profiles values('${finance}','${school}'),('${admin}','${school}'),('${correspondent}','${school}'),('${teacher}','${school}');
 insert into public.students values('${student}','${school}','MAT001','KOUADIO','ANGE'),('${otherStudent}','${otherSchool}','MAT002','YAO','ALICE'),('${blankMatricule}','${school}',null,'SANS','MATRICULE');
 insert into public.user_roles values('${finance}','${school}','finance_manager'),('${admin}','${school}','admin'),('${correspondent}','${school}','file_correspondent'),('${teacher}','${school}','teacher');
 grant usage on schema public to service_role;
 grant select,update on public.students to service_role;
 grant select on public.user_roles,public.profiles to service_role;
`);
await db.exec(await fs.readFile(new URL('../supabase/migrations/20261010033119_parent_connect_school_payment.sql', import.meta.url),'utf8'));
const collect = async ({ actor=finance, schoolId=school, studentId=student, operation=op, expected=null, payer='Parent Ange' }={}) => (await db.query('select public.parent_connect_collect($1,$2,$3,$4,$5,$6,$7,$8) as payment',[schoolId,studentId,actor,operation,payer,'cash','',expected])).rows[0].payment;
const summary = async () => (await db.query('select public.parent_connect_summary($1) as summary',[school])).rows[0].summary;

await test('l’installation conserve l’accès existant sans activer toutes les écoles', async () => {
 assert.equal((await db.query('select count(*)::int as n from parent_connect_school_settings')).rows[0].n,0);
 assert.equal((await summary()).payments_count,0);
});
await test('le paiement finance crée un reçu et active exactement douze mois', async () => {
 await db.exec('set role service_role');
 const p=await collect();
 assert.equal(p.amount,2000); assert.equal(p.school_share,500); assert.equal(p.nexa_share,1500);
 assert.equal(p.student_name,'KOUADIO ANGE'); assert.ok(p.receipt_no.startsWith('PC-'));
 assert.equal((await db.query('select ends_at = starts_at + interval \'12 months\' as valid from parent_connect_payments where id=$1',[op])).rows[0].valid,true);
 const account=(await db.query('select * from parent_connect_accounts')).rows[0]; assert.equal(new Date(account.ends_at).toISOString(),new Date(p.ends_at).toISOString());
});
await test('une relance ou un double clic ne crée pas un deuxième encaissement', async () => {
 const first=await collect(); const second=await collect(); assert.equal(first.id,second.id);
 assert.equal((await summary()).payments_count,1);
 await assert.rejects(collect({payer:'Un autre payeur'}),/PARENT_CONNECT_OPERATION_CONFLICT/);
});
await test('aucune activation par un correspondant, enseignant ou pour une autre école', async () => {
 await assert.rejects(collect({actor:correspondent,operation:op2}),/PARENT_CONNECT_FORBIDDEN/);
 await assert.rejects(collect({actor:teacher,operation:op2}),/PARENT_CONNECT_FORBIDDEN/);
 await assert.rejects(collect({schoolId:otherSchool,studentId:otherStudent,operation:op2}),/PARENT_CONNECT_FORBIDDEN/);
 await assert.rejects(collect({studentId:otherStudent,operation:op2}),/PARENT_CONNECT_STUDENT_NOT_FOUND/);
 await assert.rejects(collect({studentId:blankMatricule,operation:op2}),/PARENT_CONNECT_MATRICULE_REQUIRED/);
 assert.equal((await summary()).payments_count,1);
});
await test('un renouvellement admin conserve les jours restants et refuse les fenêtres périmées', async () => {
 const first=await collect();
 await assert.rejects(collect({operation:op2}),/PARENT_CONNECT_STALE_SUBSCRIPTION/);
 const renewal=await collect({actor:admin,operation:op2,expected:first.ends_at});
 assert.equal(new Date(renewal.starts_at).toISOString(),new Date(first.ends_at).toISOString());
 await assert.rejects(collect({actor:admin,operation:op3,expected:first.ends_at}),/PARENT_CONNECT_STALE_SUBSCRIPTION/);
 const s=await summary(); assert.equal(s.collected,4000); assert.equal(s.nexa_share,3000); assert.equal(s.school_share,1000);
});
await test('les reversements sont idempotents et ne dépassent jamais la part Nexa', async () => {
 const args=[school,finance,op,1500,'Wave-TEST'];
 const run=async()=>db.query('select parent_connect_remit($1,$2,$3,$4,$5) as payment',args);
 await run(); await run(); assert.equal((await summary()).remitted,1500);
 await assert.rejects(db.query('select parent_connect_remit($1,$2,$3,$4,$5)',[school,admin,op2,1600,'Wave-TEST2']),/PARENT_CONNECT_REMITTANCE_EXCEEDS_DUE/);
 assert.equal((await summary()).remitted,1500);
});
await test('les clients publics ne peuvent ni lire les paiements ni appeler les fonctions', async () => {
 await db.exec('reset role; set role anon');
 await assert.rejects(db.query('select * from parent_connect_payments'),/permission denied/);
 await assert.rejects(collect(),/permission denied/);
 await db.exec('reset role; set role authenticated');
 await assert.rejects(db.query('select * from parent_connect_accounts'),/permission denied/);
 await assert.rejects(collect(),/permission denied/);
 await db.exec('reset role');
});
await test('un transfert ne donne pas l’abonnement de l’ancienne école à la nouvelle', async () => {
 await db.query('insert into parent_connect_school_settings(institution_id,enforcement_enabled) values ($1,true),($2,true)',[school,otherSchool]);
 const status=async()=>(await db.query('select parent_connect_access_status($1) as access',[student])).rows[0].access;
 assert.equal((await status()).enforced,true); assert.ok((await status()).ends_at);
 await db.query('update students set institution_id=$1 where id=$2',[otherSchool,student]);
 assert.equal((await status()).ends_at,null); assert.equal((await summary()).subscriptions_active,0);
 assert.equal((await summary()).collected,4000);
 await db.query('update students set institution_id=$1 where id=$2',[school,student]);
 assert.ok((await status()).ends_at); assert.equal((await summary()).subscriptions_active,1);
});
await test('aucun changement aux dettes scolaires, notes et suppression habituelle d’élève', async () => {
 assert.deepEqual((await db.query('select * from finance.charges')).rows,[{id:1,amount:100000}]);
 assert.deepEqual((await db.query('select * from student_grades')).rows,[{id:1,score:17}]);
 await db.query('delete from students where id=$1',[student]);
 assert.equal((await db.query('select count(*)::int as n from parent_connect_accounts')).rows[0].n,0);
 assert.equal((await summary()).collected,4000);
 const p=(await db.query('select * from parent_connect_payments where id=$1',[op])).rows[0]; assert.equal(p.student_id,null); assert.equal(p.matricule,'MAT001');
});
await db.close();
