-- Mon Cahier — Nettoyage des élèves de test CSCA
-- Cible : élèves dont le nom commence par « KOUADIO ANGE »
-- Établissement : COURS SECONDAIRE CATHOLIQUE ABOISSO / code 000657
-- Année visée par le nettoyage : toutes les années, pour retirer tout ce qui concerne ces élèves de test.

begin;

create temp table _csca_test_students_to_delete on commit drop as
select
  s.id,
  s.institution_id,
  s.matricule,
  s.last_name,
  s.first_name,
  s.full_name
from public.students s
join public.institutions i on i.id = s.institution_id
where (
    coalesce(i.code_unique, '') = '000657'
    or coalesce(i.code, '') = '000657'
    or upper(coalesce(i.name, '')) = 'COURS SECONDAIRE CATHOLIQUE ABOISSO'
  )
  and (
    upper(trim(concat_ws(' ', s.last_name, s.first_name))) like 'KOUADIO ANGE%'
    or upper(trim(concat_ws(' ', s.first_name, s.last_name))) like 'KOUADIO ANGE%'
    or upper(trim(coalesce(s.full_name, ''))) like 'KOUADIO ANGE%'
  );

-- Contrôle de sécurité : on s’attend à supprimer uniquement les élèves de test.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from _csca_test_students_to_delete;

  if v_count = 0 then
    raise notice 'Aucun élève de test KOUADIO ANGE trouvé pour le CSCA.';
  elsif v_count > 5 then
    raise exception 'Sécurité : % élèves correspondent au filtre. Suppression annulée.', v_count;
  else
    raise notice 'Suppression autorisée pour % élève(s) de test.', v_count;
  end if;
end $$;

-- Affiche les élèves ciblés avant suppression.
select * from _csca_test_students_to_delete order by last_name, first_name, matricule;

-- Tables liées aux reçus : on supprime d’abord les détails qui ne portent pas directement student_id.
delete from finance.receipt_allocation_components rac
using finance.receipt_allocations ra
join finance.student_charges sc on sc.id = ra.student_charge_id
join _csca_test_students_to_delete t on t.id = sc.student_id
where rac.receipt_allocation_id = ra.id;

delete from finance.receipt_allocation_components rac
using finance.receipt_allocations ra
join finance.receipts r on r.id = ra.receipt_id
join _csca_test_students_to_delete t on t.id = r.student_id
where rac.receipt_allocation_id = ra.id;

delete from finance.receipt_allocations ra
using finance.student_charges sc, _csca_test_students_to_delete t
where ra.student_charge_id = sc.id
  and sc.student_id = t.id;

delete from finance.receipt_allocations ra
using finance.receipts r, _csca_test_students_to_delete t
where ra.receipt_id = r.id
  and r.student_id = t.id;

-- Nettoyage automatique de toutes les tables qui ont une colonne student_id.
do $$
declare
  v_ids uuid[];
  rec record;
  v_sql text;
begin
  select array_agg(id) into v_ids from _csca_test_students_to_delete;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return;
  end if;

  for rec in
    select n.nspname as schema_name, c.relname as table_name
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where a.attname = 'student_id'
      and not a.attisdropped
      and c.relkind in ('r', 'p')
      and not (n.nspname = 'public' and c.relname = 'students')
    order by n.nspname, c.relname
  loop
    v_sql := format('delete from %I.%I where student_id = any($1)', rec.schema_name, rec.table_name);
    execute v_sql using v_ids;
  end loop;
end $$;

-- Quelques tables d’association utilisent parfois des noms de colonnes différents.
do $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids from _csca_test_students_to_delete;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return;
  end if;

  if to_regclass('public.student_guardians') is not null then
    execute 'delete from public.student_guardians where student_id = any($1)' using v_ids;
  end if;
end $$;

-- Suppression finale des dossiers élèves.
delete from public.students s
using _csca_test_students_to_delete t
where s.id = t.id;

-- Contrôle final.
select
  count(*) as eleves_kouadio_ange_restants
from public.students s
join public.institutions i on i.id = s.institution_id
where (
    coalesce(i.code_unique, '') = '000657'
    or coalesce(i.code, '') = '000657'
    or upper(coalesce(i.name, '')) = 'COURS SECONDAIRE CATHOLIQUE ABOISSO'
  )
  and (
    upper(trim(concat_ws(' ', s.last_name, s.first_name))) like 'KOUADIO ANGE%'
    or upper(trim(concat_ws(' ', s.first_name, s.last_name))) like 'KOUADIO ANGE%'
    or upper(trim(coalesce(s.full_name, ''))) like 'KOUADIO ANGE%'
  );

commit;
