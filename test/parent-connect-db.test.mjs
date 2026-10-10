import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const school='10000000-0000-0000-0000-000000000001', otherSchool='10000000-0000-0000-0000-000000000002';
const student='20000000-0000-0000-0000-000000000001', second='20000000-0000-0000-0000-000000000004', otherStudent='20000000-0000-0000-0000-000000000002', blank='20000000-0000-0000-0000-000000000003';
const finance='30000000-0000-0000-0000-000000000001', admin='30000000-0000-0000-0000-000000000002', correspondent='30000000-0000-0000-0000-000000000003', superAdmin='30000000-0000-0000-0000-000000000004';
const op='40000000-0000-0000-0000-000000000001', op2='40000000-0000-0000-0000-000000000002', op3='40000000-0000-0000-0000-000000000003', grantOp='50000000-0000-0000-0000-000000000001';
const year='2026-2027'; const db=new PGlite();
await db.exec(`
 create role service_role bypassrls; create role anon; create role authenticated;
 create table public.institutions(id uuid primary key,name text);
 create table public.profiles(id uuid primary key,institution_id uuid);
 create table public.students(id uuid primary key,institution_id uuid,matricule text,last_name text,first_name text,lifecycle_status text);
 create table public.user_roles(profile_id uuid,institution_id uuid,role text);
 create table public.academic_years(id uuid primary key,institution_id uuid,code text,start_date date,end_date date,is_current boolean);
 create table public.classes(id uuid primary key,institution_id uuid,academic_year text,label text,level text,formation_level_code text);
 create table public.class_enrollments(student_id uuid,institution_id uuid,class_id uuid,end_date date);
 create table public.institution_notification_channel_settings(institution_id uuid primary key,push_enabled boolean default true,sms_premium_enabled boolean default false,sms_absence_enabled boolean default false,sms_late_enabled boolean default false,sms_notes_digest_enabled boolean default false);
 grant select,insert,update,delete,truncate,references,trigger on public.institution_notification_channel_settings to anon,authenticated,service_role;
 create table public.teacher_sessions(id uuid primary key,institution_id uuid,class_id uuid,subject_id uuid,started_at timestamptz);
 create table public.attendance_marks(id uuid primary key default gen_random_uuid(),session_id uuid,student_id uuid,status text,minutes_late integer,reason text);
 create table public.notifications_queue(id uuid primary key default gen_random_uuid(),institution_id uuid,student_id uuid,session_id uuid,mark_id uuid,parent_id uuid,profile_id uuid,channels jsonb,payload jsonb,status text default 'pending',meta jsonb default '{}');
 create schema finance; create table finance.charges(id integer,amount integer); insert into finance.charges values(1,100000);
 create table public.student_grades(id integer,score integer); insert into public.student_grades values(1,17);
 insert into public.institutions values('${school}','École A'),('${otherSchool}','École B');
 insert into public.profiles values('${finance}','${school}'),('${admin}','${school}'),('${correspondent}','${school}'),('${superAdmin}',null);
 insert into public.students values('${student}','${school}','MAT001','KOUADIO','ANGE',null),('${second}','${school}','MAT004','YAO','SECOND','active'),('${otherStudent}','${otherSchool}','MAT002','YAO','ALICE','active'),('${blank}','${school}',null,'SANS','MATRICULE','active');
 insert into public.user_roles values('${finance}','${school}','finance_manager'),('${admin}','${school}','admin'),('${correspondent}','${school}','file_correspondent'),('${superAdmin}',null,'super_admin');
 insert into public.academic_years values('${school}','${school}','${year}',current_date-30,current_date+300,true),('${otherSchool}','${otherSchool}','${year}',current_date-30,current_date+300,true);
 insert into public.classes values('${school}','${school}','${year}','6ème A','6ème',null),('${otherSchool}','${otherSchool}','${year}','5ème A','5ème',null);
 insert into public.class_enrollments select id,institution_id,institution_id,null from public.students;
 grant usage on schema public to service_role; grant select,update on public.students to service_role;
 grant select on public.user_roles,public.profiles,public.academic_years,public.classes,public.class_enrollments,public.institutions to service_role;
`);
await db.exec(await fs.readFile(new URL('../supabase/migrations/20261010033119_parent_connect_school_payment.sql',import.meta.url),'utf8'));
// Seed an actual legacy receipt before applying the upgrade to verify historical preservation.
await db.query('select parent_connect_grant_credits($1,$2,$3,$4,$5,$6)',[school,superAdmin,grantOp,year,2,'Ancien lot']);
await db.query('select parent_connect_collect($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[school,student,finance,op,'Parent Ange','cash','',null,year,'+2250700000000']);
await db.exec(await fs.readFile(new URL('../supabase/migrations/20261010053906_parent_connect_flexible_amounts.sql',import.meta.url),'utf8'));
await db.exec(await fs.readFile(new URL('../supabase/migrations/20261010062246_parent_connect_activation_only.sql',import.meta.url),'utf8'));
await test('migration : un ancien reçu garde ses montants et reçoit le lien vers son lot, sans crédit ajouté',async()=>{
 const p=(await db.query('select * from parent_connect_payments where id=$1',[op])).rows[0];
 assert.equal(p.amount,2000);assert.equal(p.school_share,500);assert.equal(p.nexa_share,1500);assert.equal(p.credit_grant_id,grantOp);
 assert.equal((await db.query('select count(*)::int as n from parent_connect_credit_grants')).rows[0].n,1);
});
await db.exec('truncate parent_connect_activations,parent_connect_accounts,parent_connect_payments,parent_connect_school_settings,parent_connect_credit_grants,parent_connect_remittances,parent_connect_bulk_operations,parent_connect_phone_changes');

// Each deliberate refusal rolls back only that statement, like separate HTTP transactions.
const rawQuery = db.query.bind(db);
db.query = async (...args) => {
 await db.exec('savepoint pc_statement');
 try { const r=await rawQuery(...args); await db.exec('release savepoint pc_statement'); return r; }
 catch (e) { await db.exec('rollback to savepoint pc_statement; release savepoint pc_statement'); throw e; }
};
const value=async(sql,args=[]) => (await db.query(sql,args)).rows[0].value;
const collect=({actor=finance,schoolId=school,studentId=student,operation=op,payer='Parent Ange',academicYear=year,phone='+2250700000000'}={}) => value('select parent_connect_collect($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as value',[schoolId,studentId,actor,operation,payer,'cash','',null,academicYear,phone]);
const grant=({actor=superAdmin,schoolId=school,operation=grantOp,quantity=1,remittance=null,academicYear=year}={})=>value('select parent_connect_grant_credits($1,$2,$3,$4,$5,$6,$7) as value',[schoolId,actor,operation,academicYear,quantity,'Banque vérifiée',remittance]);
const remit=(amount=1500,operation=op)=>value('select parent_connect_remit($1,$2,$3,$4,$5,$6) as value',[school,finance,operation,amount,'Wave TEST',year]);
const bulk=({actor=superAdmin,count=2,operation=op,schoolId=school}={})=>value('select parent_connect_bulk_activate($1,$2,$3,$4,$5,$6) as value',[schoolId,actor,operation,year,'Contrat annuel déjà payé',count]);
const summary=(schoolId=school)=>value('select parent_connect_summary($1) as value',[schoolId]);
const access=(id=student)=>value('select parent_connect_access_status($1) as value',[id]);
const scenario=async(name,fn)=>test(name,async()=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}});
await scenario('installation : accès existant conservé, aucun crédit ni école activée',async()=>{
 assert.equal((await summary()).credits_available,0); assert.equal((await access()).enforced,false);
 assert.equal((await db.query('select count(*)::int as n from parent_connect_school_settings')).rows[0].n,0);
});
await scenario('sans crédit, aucun reçu et aucune activation ne sont créés',async()=>{
 await assert.rejects(collect(),/NO_CREDITS/); assert.equal((await summary()).collected,0);
});
await scenario('un versement déclaré ne crée aucun crédit, seule la confirmation super le fait',async()=>{
 await remit(3000); await remit(3000); assert.equal((await summary()).pending_remittances,3000);
 assert.equal((await summary()).nexa_received,0); await assert.rejects(collect(),/NO_CREDITS/);
 await assert.rejects(grant({quantity:1,remittance:op}),/INVALID_GRANT/);
 const g=await grant({quantity:2,remittance:op}); assert.equal(g.amount_received,3000);
 assert.equal((await summary()).credits_available,2); assert.equal((await summary()).pending_remittances,0);
 await grant({quantity:2,remittance:op}); assert.equal((await summary()).credits_granted,2);
 await assert.rejects(grant({quantity:2,operation:op2,remittance:op}),/ALREADY_CONFIRMED/);
});
await scenario('admin et financier ne peuvent ni attribuer des crédits ni activer toute une école',async()=>{
 for(const actor of [admin,finance,correspondent]) {await assert.rejects(grant({actor}),/FORBIDDEN/);await assert.rejects(bulk({actor}),/FORBIDDEN/);}
 await assert.rejects(collect({actor:correspondent}),/FORBIDDEN/);
 await assert.rejects(collect({schoolId:otherSchool,studentId:otherStudent}),/FORBIDDEN/);
});
await scenario('1 paiement consomme 1 crédit et expire à minuit après la fin scolaire inclusive',async()=>{
 await grant(); await db.exec('set local role service_role'); const p=await collect();
 assert.equal(p.amount,2000);assert.equal(p.school_share,500);assert.equal(p.nexa_share,1500);assert.equal(p.academic_year,year);
 assert.equal(p.student_name,'KOUADIO ANGE');assert.ok(p.receipt_no.startsWith(`PC-${year}`));
 assert.equal(await value("select ends_at=((y.end_date+1)::timestamp at time zone 'UTC') as value from parent_connect_payments p join academic_years y on y.institution_id=p.institution_id where p.id=$1",[op]),true);
 assert.equal((await summary()).credits_available,0);assert.equal((await access()).enforced,true);assert.ok((await access()).ends_at);
});
await scenario('relance identique, double clic et même année : jamais deux encaissements',async()=>{
 await grant({quantity:2});const p=await collect();assert.equal((await collect()).id,p.id);
 await assert.rejects(collect({payer:'Autre payeur'}),/OPERATION_CONFLICT/);
 await assert.rejects(collect({operation:op2}),/ALREADY_COVERED/);
 assert.equal((await summary()).credits_used,1);assert.equal((await summary()).collected,2000);
});
await scenario('le dernier crédit ne peut pas servir à deux enfants',async()=>{
 await grant();await collect();await assert.rejects(collect({studentId:second,operation:op2}),/NO_CREDITS/);
 assert.equal((await summary()).credits_available,0);assert.equal((await summary()).payments_count,1);
});
await scenario('matricule absent, enfant hors école ou sans inscription actuelle : aucune activation',async()=>{
 await grant({quantity:2});await assert.rejects(collect({studentId:otherStudent}),/STUDENT_NOT_FOUND/);
 await assert.rejects(collect({studentId:blank}),/MATRICULE_REQUIRED/);
 await db.query('update class_enrollments set end_date=current_date where student_id=$1',[student]);
 await assert.rejects(collect(),/STUDENT_NOT_ENROLLED/);assert.equal((await summary()).credits_used,0);
});
await scenario('année périmée, absente ou ambiguë : blocage sans inventer une date',async()=>{
 await db.query('update academic_years set end_date=current_date-1 where institution_id=$1',[school]);await assert.rejects(grant(),/YEAR_REQUIRED/);
 await db.query('update academic_years set end_date=null where institution_id=$1',[school]);await assert.rejects(bulk(),/YEAR_REQUIRED/);
 await db.query('update academic_years set end_date=current_date+300 where institution_id=$1',[school]);
 await db.query('insert into academic_years values($1,$2,$3,current_date,current_date+400,true)',[op,school,'other']);await assert.rejects(grant(),/YEAR_REQUIRED/);
});
await scenario('allonger le calendrier ne prolonge pas la période approuvée par Nexa',async()=>{
 const g=await grant({quantity:2});const approved=await value('select approved_ends_at as value from parent_connect_school_settings where institution_id=$1',[school]);
 await db.query('update academic_years set end_date=end_date+100 where institution_id=$1',[school]);
 const p=await collect();assert.equal(Date.parse(p.ends_at),Date.parse(approved));
 await grant({operation:op3}); assert.equal(Date.parse((await access()).ends_at),Date.parse(approved));assert.equal(g.quantity,2);
});
await scenario('raccourcir le calendrier ferme accès et compteurs à la vraie fin',async()=>{
 await grant();await collect();await db.query('update academic_years set end_date=current_date-1 where institution_id=$1',[school]);
 assert.ok(Date.parse((await access()).ends_at)<=Date.now());assert.equal((await summary()).subscriptions_active,0);
});
await scenario('suspension : empêche les nouvelles activations, conserve celles déjà payées',async()=>{
 await grant({quantity:2});await collect();await db.query('update parent_connect_school_settings set activations_paused=true where institution_id=$1',[school]);
 await assert.rejects(collect({studentId:second,operation:op2}),/ACTIVATIONS_PAUSED/);assert.ok((await access()).ends_at);
});
await scenario('activation collective déjà payée : roster actuel, sans matricules absents, sans faux paiements',async()=>{
 await db.exec('set local role service_role');const b=await bulk();assert.equal(b.activated_count,2);assert.equal(b.skipped_no_matricule,1);
 assert.equal((await summary()).school_covered,2);assert.equal((await summary()).collected,0);assert.equal((await summary()).credits_used,0);
 assert.equal((await access()).enforced,true);assert.ok((await access()).ends_at);assert.equal((await access(blank)).ends_at,null);
 await bulk();assert.equal((await summary()).school_covered,2);await assert.rejects(collect(),/ALREADY_COVERED/);
});
await scenario('activation collective vérifie le nombre confirmé et conserve un paiement antérieur',async()=>{
 await assert.rejects(bulk({count:3}),/ROSTER_CHANGED/);await grant();await collect();await bulk();
 assert.equal((await summary()).payments_count,1);assert.equal((await summary()).school_covered,1);
 assert.equal(await value('select source as value from parent_connect_accounts where student_id=$1',[student]),'payment');
});
await scenario('activation collective de plus de 1 000 élèves : aucun plafond API de liste',async()=>{
 await db.exec(`insert into students select ('60000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'${school}','MAT-'||i,'TEST','ELEVE','active' from generate_series(1,1001) i;insert into class_enrollments select id,institution_id,institution_id,null from students where id::text like '60000000%';`);
 const roster=await value('select parent_connect_students($1,$2,$3,$4,$5,$6) as value',[school,year,'',null,'',1000]);assert.equal(roster.total,1004);assert.equal(roster.items.length,4);
 const b=await bulk({count:1003});assert.equal(b.activated_count,1003);assert.equal((await summary()).subscriptions_active,1003);assert.equal((await summary()).collected,0);
});
await scenario('élèves fusionnés, anciennes classes et inscriptions terminées sont exclus du collectif',async()=>{
 await db.query("update students set lifecycle_status='merged' where id=$1",[student]);await db.query('update class_enrollments set end_date=current_date where student_id=$1',[second]);
 assert.equal((await value('select parent_connect_roster($1,$2) as value',[school,year])).eligible_count,0);await assert.rejects(bulk(),/ROSTER_CHANGED/);
});
await scenario('nouvelle année : ancien accès et crédits non reportés, nouveau paiement annuel possible',async()=>{
 await grant({quantity:2});const first=await collect();const next='2027-2028';
 await db.query('update academic_years set code=$1,end_date=end_date+365 where institution_id=$2',[next,school]);await db.query('update classes set academic_year=$1 where institution_id=$2',[next,school]);
 assert.equal((await summary()).credits_available,0);assert.equal((await access()).ends_at,null);
 assert.equal((await collect()).id,first.id);await assert.rejects(collect({operation:op2}),/YEAR_CHANGED/);
 await assert.rejects(collect({operation:op2,academicYear:next}),/NO_CREDITS/);
 await grant({operation:op3,academicYear:next});await collect({operation:op2,academicYear:next});assert.equal((await summary()).collected,2000);
 assert.equal(await value('select count(*)::int as value from parent_connect_payments'),2);
});
await scenario('un transfert conserve les reçus mais pas l’accès dans la nouvelle école',async()=>{
 await grant();await collect();await grant({schoolId:otherSchool,operation:op2});await db.query('update students set institution_id=$1 where id=$2',[otherSchool,student]);
 assert.equal((await access()).ends_at,null);assert.equal((await summary()).subscriptions_active,0);assert.equal((await summary()).collected,2000);
});
await scenario('suppression d’un élève : le reçu conservé ne recrée pas un crédit disponible',async()=>{
 await grant();await collect();await db.query('delete from students where id=$1',[student]);
 assert.equal((await summary()).credits_available,0);assert.equal((await summary()).collected,2000);
 assert.equal(await value('select student_id as value from parent_connect_payments where id=$1',[op]),null);
 assert.equal(await value('select matricule as value from parent_connect_payments where id=$1',[op]),'MAT001');
 assert.deepEqual((await db.query('select * from finance.charges')).rows,[{id:1,amount:100000}]);assert.deepEqual((await db.query('select * from student_grades')).rows,[{id:1,score:17}]);
});
await scenario('public et utilisateurs authentifiés ne peuvent lire ni modifier le registre',async()=>{
 for(const role of ['anon','authenticated']) {
  await db.exec(`savepoint permission;set local role ${role}`);await assert.rejects(db.query('select * from parent_connect_credit_grants'),/permission denied/);await db.exec('rollback to permission');
  await db.exec(`savepoint permission;set local role ${role}`);await assert.rejects(grant(),/permission denied/);await db.exec('rollback to permission');
 }
});
await scenario('liste paginée : nom/prénoms, niveau et classe restent dans l’école et l’année',async()=>{
 const list=async(search='',classId=null,level='')=>value('select parent_connect_students($1,$2,$3,$4,$5,$6) as value',[school,year,search,classId,level,0]);
 const found=await list('ange kouadio');assert.equal(found.total,1);assert.equal(found.items[0].id,student);assert.equal(found.items[0].class_label,'6ème A');
 assert.equal((await list('',otherSchool)).total,0);assert.equal((await list('',null,'5ème')).total,0);assert.equal((await list('',school,'6ème')).total,3);
});
await scenario('période approuvée absente : un compte seul ne suffit pas à ouvrir les données',async()=>{
 await grant();await collect();await db.query('update parent_connect_school_settings set approved_ends_at=null where institution_id=$1',[school]);assert.equal((await access()).ends_at,null);
});
await scenario('numéro obligatoire à la collecte : crédit, reçu et téléphone sont atomiques',async()=>{
 await grant();await assert.rejects(collect({phone:null}),/PHONE_REQUIRED/);assert.equal((await summary()).credits_available,1);
 const p=await collect();assert.equal(p.sms_phone_e164,'+2250700000000');
 assert.equal(await value('select sms_phone_e164 as value from parent_connect_accounts where student_id=$1',[student]),p.sms_phone_e164);
 await assert.rejects(collect({phone:'+2250500000000'}),/OPERATION_CONFLICT/);
});
const setPhone=({actor=finance,studentId=student,operation=op2,phone='+2250700000000',expected=null}={})=>value('select parent_connect_set_phone($1,$2,$3,$4,$5,$6,$7) as value',[school,studentId,actor,operation,year,phone,expected]);
const phones=(schoolId=school)=>value('select parent_connect_sms_contacts($1,$2) as value',[schoolId,[student,second]]);
await scenario('CSCA collectif : numéro sans parent connecté, aucun paiement et journal rejouable',async()=>{
 await bulk();await setPhone();await setPhone();assert.equal((await summary()).credits_used,0);assert.equal((await summary()).collected,0);
 assert.deepEqual(await phones(),[{student_id:student,phone_e164:'+2250700000000'}]);
 assert.equal(await value('select count(*)::int as value from parent_connect_phone_changes'),1);
 await assert.rejects(setPhone({actor:correspondent,operation:op3}),/FORBIDDEN/);
 await assert.rejects(setPhone({phone:'+2250500000000'}),/OPERATION_CONFLICT/);
 await assert.rejects(setPhone({phone:'+2250500000000',operation:op3}),/STALE_SUBSCRIPTION/);
 await setPhone({phone:'+2250500000000',expected:'+2250700000000',operation:op3});
 assert.equal((await phones())[0].phone_e164,'+2250500000000');
 assert.equal(await value('select previous_phone as value from parent_connect_phone_changes where id=$1',[op3]),'+2250700000000');
});
await scenario('SMS : aucun numéro transmis hors école, après transfert, expiration ou ambiguïté scolaire',async()=>{
 await bulk();await setPhone();assert.deepEqual(await phones(otherSchool),[]);
 await db.query('update students set institution_id=$1 where id=$2',[otherSchool,student]);assert.deepEqual(await phones(),[]);
 await db.query('update students set institution_id=$1 where id=$2',[school,student]);
 await db.query('update parent_connect_school_settings set approved_ends_at=now()-interval \'1 day\'');assert.deepEqual(await phones(),[]);
 await db.query('update parent_connect_school_settings set approved_ends_at=now()+interval \'10 days\'');
 await db.query('insert into academic_years values($1,$2,$3,current_date,current_date+400,true)',[op3,school,'other']);assert.deepEqual(await phones(),[]);
});
await scenario('SMS : clients anon/authenticated ne peuvent activer les réglages Nexa',async()=>{
 await db.query('insert into institution_notification_channel_settings(institution_id) values($1)',[school]);
 for(const role of ['anon','authenticated']) {
  await db.exec(`savepoint sms_permission;set local role ${role}`);
  await assert.rejects(db.query('update institution_notification_channel_settings set sms_premium_enabled=true'),/permission denied/);
  assert.equal(await value('select sms_premium_enabled as value from institution_notification_channel_settings'),false);
  await db.exec('rollback to sms_permission');
 }
});
await scenario('crédit, collectif et numéro ne changent aucun réglage SMS/push',async()=>{
 await db.query('insert into institution_notification_channel_settings(institution_id) values($1)',[school]);
 await grant({quantity:20});await bulk();await setPhone();
 assert.deepEqual((await db.query('select push_enabled,sms_premium_enabled,sms_absence_enabled,sms_late_enabled,sms_notes_digest_enabled from institution_notification_channel_settings')).rows,[{push_enabled:true,sms_premium_enabled:false,sms_absence_enabled:false,sms_late_enabled:false,sms_notes_digest_enabled:false}]);
 assert.equal((await summary()).credits_available,20);
});
// Existing legacy trigger is a fixture: the new isolated trigger must preserve its push rows.
await db.exec(`create function public.fixture_legacy_attendance() returns trigger language plpgsql as $$ begin
 insert into notifications_queue(institution_id,student_id,mark_id,channels,payload,meta) values('${school}',new.student_id,new.id,'["inapp","push"]','{"existing_push":true}','{"device_id":"legacy-device"}');
 return new;end; $$;create trigger t_aiu_mark_notify_guardians after insert on attendance_marks for each row execute function fixture_legacy_attendance();`);
const mark=()=>value("insert into attendance_marks(session_id,student_id,status,minutes_late) values($1,$2,'absent',0) returning id as value",[school,student]);
await scenario('absence sans compte parent : uniquement le SMS autorisé, push existant conservé',async()=>{
 await bulk();await setPhone();await db.query('insert into teacher_sessions values($1,$1,$1,null,now())',[school]);
 await db.query('insert into institution_notification_channel_settings(institution_id) values($1)',[school]);
 await mark();assert.equal(await value("select count(*)::int as value from notifications_queue where channels='[\"sms\"]'"),0);
 await db.query('update institution_notification_channel_settings set sms_premium_enabled=true,sms_absence_enabled=true');
 await mark();const rows=(await db.query('select channels,payload,parent_id,profile_id,meta from notifications_queue')).rows;
 assert.equal(rows.filter(r=>r.channels.includes('push')).length,2);
 assert.deepEqual(rows.filter(r=>r.channels.includes('push')).map(r=>r.payload),[{existing_push:true},{existing_push:true}]);
 const sms=rows.filter(r=>r.channels.includes('sms'));assert.equal(sms.length,1);assert.deepEqual(sms[0].channels,['sms']);assert.equal(sms[0].parent_id,null);assert.equal(sms[0].profile_id,null);assert.equal(sms[0].payload.event,'absent');
});
await scenario('SMS désactivé par événement et panne SMS : l’appel et ses push restent enregistrés',async()=>{
 await bulk();await setPhone();await db.query('insert into teacher_sessions values($1,$1,$1,null,now())',[school]);
 await db.query('insert into institution_notification_channel_settings(institution_id,sms_premium_enabled,sms_late_enabled) values($1,true,true)',[school]);
 await mark();assert.equal(await value("select count(*)::int as value from notifications_queue where channels='[\"sms\"]'"),0);
 await db.query('update institution_notification_channel_settings set sms_absence_enabled=true');
 await db.exec(`alter table notifications_queue add constraint fixture_sms_failure check (channels <> '["sms"]'::jsonb)`);
 await mark();assert.equal(await value('select count(*)::int as value from attendance_marks'),2);assert.equal(await value('select count(*)::int as value from notifications_queue'),2);
});


const grantAtPrice=({actor=superAdmin,quantity=1,amount=1200,operation=grantOp,remittance=null}={})=>value('select parent_connect_grant_credits_at_price($1,$2,$3,$4,$5,$6,$7,$8) as value',[school,actor,operation,year,quantity,'Contrat vérifié',amount,remittance]);
const collectAtPrice=({studentId=student,actor=finance,amount=3500,operation=op}={})=>value('select parent_connect_collect_at_price($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as value',[school,studentId,actor,operation,'Parent Ange','cash','',amount,null,year,'+2250700000000']);
await scenario('tarifs libres : école encaisse son prix, Nexa confirme un autre montant sans changer le crédit consommé',async()=>{
 await remit(2600);await grantAtPrice({quantity:2,amount:2600,remittance:op});
 const p=await collectAtPrice({amount:3500,operation:op2});assert.equal(p.amount,3500);assert.equal(p.nexa_share,1300);assert.equal(p.school_share,2200);assert.equal(p.credit_grant_id,grantOp);
 const state=await summary();assert.equal(state.credits_used,1);assert.equal(state.credits_available,1);assert.equal(state.nexa_received,2600);
 await grantAtPrice({amount:1000,operation:op3});
 assert.equal(await value('select nexa_share as value from parent_connect_payments where id=$1',[op2]),1300);
});
await scenario('montant reçu libre : les fractions du lot sont réparties exactement en FCFA sans perte',async()=>{
 await grantAtPrice({quantity:2,amount:2601});const a=await collectAtPrice();const b=await collectAtPrice({studentId:second,operation:op2});
 assert.equal(a.nexa_share,1301);assert.equal(b.nexa_share,1300);assert.equal(a.nexa_share+b.nexa_share,2601);
 assert.equal((await summary()).credits_available,0);
});
await scenario('nouveaux tarifs : refus des rôles école, montant invalide et paiement insuffisant sans effets partiels',async()=>{
 for(const actor of [admin,finance,correspondent])await assert.rejects(grantAtPrice({actor}),/FORBIDDEN/);
 for(const amount of [0,-1,2147483648])await assert.rejects(grantAtPrice({amount}),/INVALID_GRANT/);
 await grantAtPrice({amount:1300});await assert.rejects(collectAtPrice({actor:correspondent}),/FORBIDDEN/);
 await assert.rejects(collectAtPrice({amount:1200}),/INVALID_AMOUNT/);await assert.rejects(collectAtPrice({amount:0}),/INVALID_AMOUNT/);
 assert.equal((await summary()).payments_count,0);assert.equal((await summary()).credits_available,1);
});
await scenario('tarifs libres : reprise idempotente et montant changé refusé, une seule consommation',async()=>{
 await grantAtPrice();await grantAtPrice();await assert.rejects(grantAtPrice({amount:1100}),/OPERATION_CONFLICT/);
 const p=await collectAtPrice();assert.equal((await collectAtPrice()).id,p.id);await assert.rejects(collectAtPrice({amount:3600}),/OPERATION_CONFLICT/);
 assert.equal((await summary()).credits_used,1);assert.equal((await summary()).collected,3500);
});
await scenario('compteur activés : exclure un dossier sorti ou désinscrit sans effacer son reçu',async()=>{
 await grantAtPrice();await collectAtPrice();assert.equal((await summary()).subscriptions_active,1);
 await db.query('update students set lifecycle_status=$1 where id=$2',['exited',student]);assert.equal((await summary()).subscriptions_active,0);
 assert.equal((await summary()).collected,3500);assert.equal((await summary()).credits_used,1);
 await db.query('update students set lifecycle_status=$1 where id=$2',['active',student]);await db.query('update class_enrollments set end_date=current_date where student_id=$1',[student]);
 assert.equal((await summary()).subscriptions_active,0);assert.equal((await summary()).payments_count,1);
});
await scenario('nouveaux points serveur : aucun rôle client ne peut appeler les fonctions de tarifs',async()=>{
 for(const role of ['anon','authenticated']) {
  assert.equal(await value("select has_function_privilege($1,'public.parent_connect_collect_at_price(uuid,uuid,uuid,uuid,text,text,text,integer,timestamptz,text,text)','EXECUTE') as value",[role]),false);
  assert.equal(await value("select has_function_privilege($1,'public.parent_connect_grant_credits_at_price(uuid,uuid,uuid,text,integer,text,bigint,uuid)','EXECUTE') as value",[role]),false);
 }
});

const manualGrant=({actor=superAdmin,quantity=2,operation=grantOp,academicYear=year}={})=>value('select parent_connect_grant_activation_credits($1,$2,$3,$4,$5) as value',[school,actor,operation,academicYear,quantity]);
const activate=({actor=finance,studentId=student,schoolId=school,operation=op,academicYear=year}={})=>value('select parent_connect_activate($1,$2,$3,$4,$5) as value',[schoolId,studentId,actor,operation,academicYear]);
await scenario('activation directe : un crédit, aucun paiement, aucun téléphone requis, fin scolaire',async()=>{
 await db.exec('set local role service_role');const g=await manualGrant();assert.equal(g.amount_received,null);const a=await activate();
 assert.equal(a.credit_grant_id,grantOp);assert.equal(a.created_by,finance);assert.equal(a.student_name,'KOUADIO ANGE');
 assert.equal((await summary()).credits_available,1);assert.equal((await summary()).credits_used,1);assert.equal((await summary()).payments_count,0);assert.equal((await summary()).collected,0);assert.equal((await summary()).nexa_received,0);
 assert.equal(await value('select source as value from parent_connect_accounts where student_id=$1',[student]),'activation');
 assert.equal(await value('select sms_phone_e164 as value from parent_connect_accounts where student_id=$1',[student]),null);
 assert.equal(await value("select ends_at=((y.end_date+1)::timestamp at time zone 'UTC') as value from parent_connect_activations a join academic_years y on y.institution_id=a.institution_id where a.id=$1",[op]),true);
});
await scenario('activation : reprises et nouveau clic sur le même élève ne consomment pas deux crédits',async()=>{
 await manualGrant();const first=await activate();assert.equal((await activate()).id,first.id);
 assert.equal((await activate({operation:op2})).already_active,true);
 await assert.rejects(activate({operation:op,studentId:second}),/OPERATION_CONFLICT/);
 assert.equal((await summary()).credits_used,1);assert.equal((await summary()).credits_available,1);
});
await scenario('activation : aucun crédit, mauvaise école, aucun matricule ou inscription terminée bloquent sans écriture',async()=>{
 await assert.rejects(activate(),/NO_CREDITS/);await manualGrant();
 await assert.rejects(activate({studentId:otherStudent}),/STUDENT_NOT_FOUND/);
 await assert.rejects(activate({studentId:blank}),/MATRICULE_REQUIRED/);
 await db.query('update class_enrollments set end_date=current_date where student_id=$1',[student]);
 await assert.rejects(activate(),/STUDENT_NOT_ENROLLED/);
 assert.equal((await summary()).credits_used,0);assert.equal(await value('select count(*)::int as value from parent_connect_activations'),0);
});
await scenario('activation : crédits et contrôle restent réservés au super admin, correspondant en consultation',async()=>{
 for(const actor of [admin,finance,correspondent])await assert.rejects(manualGrant({actor}),/FORBIDDEN/);
 await manualGrant();await assert.rejects(activate({actor:correspondent}),/FORBIDDEN/);
 await activate({actor:admin});assert.equal((await summary()).subscriptions_active,1);
});
await scenario('activation : dernier crédit partagé avec les anciens clients sans dépassement',async()=>{
 await grant({quantity:1});await activate();
 await assert.rejects(activate({studentId:second,operation:op2}),/NO_CREDITS/);
 await assert.rejects(collect({studentId:second,operation:op2}),/NO_CREDITS/);
 assert.equal((await summary()).credits_available,0);assert.equal((await summary()).payments_count,0);
});
await scenario('activation : un paiement historique et une activation utilisent le même lot une seule fois',async()=>{
 await grant({quantity:2});await collect();await activate({studentId:second,operation:op2});
 assert.equal((await summary()).credits_used,2);assert.equal((await summary()).credits_available,0);assert.equal((await summary()).payments_count,1);
});
await scenario('activation : lot manuel ne peut pas fabriquer un encaissement par un ancien client',async()=>{
 await manualGrant();await assert.rejects(collect(),/INVALID_AMOUNT/);
 assert.equal((await summary()).payments_count,0);assert.equal((await summary()).credits_used,0);
 await assert.rejects(grant({quantity:2}),/OPERATION_CONFLICT/);
});
await scenario('crédits manuels : quantité contrôlée, reprise idempotente et aucune somme inventée',async()=>{
 for(const quantity of [0,-1,1000001])await assert.rejects(manualGrant({quantity}),/INVALID_GRANT/);
 await manualGrant({quantity:20});await manualGrant({quantity:20});
 await assert.rejects(manualGrant({quantity:21}),/OPERATION_CONFLICT/);
 assert.equal((await summary()).credits_granted,20);assert.equal((await summary()).nexa_received,0);
 assert.equal(await value('select count(*)::int as value from parent_connect_remittances'),0);
});
await scenario('activation : pause, changement d’année et cap approuvé restent appliqués',async()=>{
 await manualGrant();const approved=await value('select approved_ends_at as value from parent_connect_school_settings where institution_id=$1',[school]);
 await db.query('update parent_connect_school_settings set activations_paused=true where institution_id=$1',[school]);
 await assert.rejects(activate(),/ACTIVATIONS_PAUSED/);
 await db.query('update parent_connect_school_settings set activations_paused=false where institution_id=$1',[school]);
 await assert.rejects(activate({academicYear:'2027-2028'}),/YEAR_CHANGED/);
 await db.query('update academic_years set end_date=end_date+100 where institution_id=$1',[school]);
 const a=await activate();assert.equal(Date.parse(a.ends_at),Date.parse(approved));
});
await scenario('activation collective existante : aucun crédit ni journal individuel supplémentaire',async()=>{
 await bulk();const a=await activate();assert.equal(a.already_active,true);
 assert.equal((await summary()).school_covered,2);assert.equal((await summary()).credits_used,0);
 assert.equal(await value('select count(*)::int as value from parent_connect_activations'),0);
});
await scenario('activation : ajout du numéro ensuite, SMS désactivés et push conservés',async()=>{
 await db.query('insert into institution_notification_channel_settings(institution_id) values($1)',[school]);
 await manualGrant();await activate();await setPhone({operation:op2});
 assert.deepEqual((await db.query('select push_enabled,sms_premium_enabled,sms_absence_enabled,sms_late_enabled,sms_notes_digest_enabled from institution_notification_channel_settings')).rows,[{push_enabled:true,sms_premium_enabled:false,sms_absence_enabled:false,sms_late_enabled:false,sms_notes_digest_enabled:false}]);
 assert.equal((await summary()).credits_used,1);assert.equal((await summary()).collected,0);
});
await scenario('activation : journal et fonctions inaccessibles aux rôles clients',async()=>{
 for(const role of ['anon','authenticated']) {
  for(const fn of ['parent_connect_activate(uuid,uuid,uuid,uuid,text)','parent_connect_grant_activation_credits(uuid,uuid,uuid,text,integer,text)']) assert.equal(await value('select has_function_privilege($1,$2,\'EXECUTE\') as value',[role,'public.'+fn]),false);
  assert.equal(await value('select has_table_privilege($1,\'public.parent_connect_activations\',\'SELECT\') as value',[role]),false);
 }
 assert.equal(await value("select relrowsecurity as value from pg_class where relname='parent_connect_activations'"),true);
});
await db.close();
