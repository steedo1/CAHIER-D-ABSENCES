-- Nettoyage ciblé CSCA : reçu ouvert/test de 200 000 F + brouillons/intents de paiement en ligne.
-- À exécuter dans Supabase SQL Editor après vérification du SELECT final.
-- Objectif : supprimer uniquement les éléments financiers parasites du CSCA, sans toucher aux vrais encaissements confirmés.

begin;

with csca as (
  select id, name
  from public.institutions
  where name ilike '%CSCA%'
     or name ilike '%COURS%SECONDAIRE%CATHOLIQUE%'
     or coalesce(code, '') ilike '%CSCA%'
),
-- Brouillons / intentions non confirmées : initié, en attente, expiré, échoué ou annulé.
target_intents as (
  select opi.id, opi.receipt_id, opi.amount, opi.status
  from finance.online_payment_intents opi
  join csca s on s.id = opi.school_id
  where opi.status in ('initiated', 'pending', 'expired', 'failed', 'cancelled')
),
-- Reçu parasite de 200 000 F : on cible CSCA et les reçus liés au tunnel en ligne/test.
target_receipts as (
  select distinct r.id, r.receipt_no, r.total_amount
  from finance.receipts r
  join csca s on s.id = r.school_id
  left join target_intents ti on ti.receipt_id = r.id
  where r.total_amount = 200000
    and coalesce(r.receipt_status, '') <> 'cancelled'
    and (
      ti.receipt_id is not null
      or coalesce(r.reference_no, '') ilike 'ONLINE-%'
      or coalesce(r.notes, '') ilike '%test%'
      or coalesce(r.notes, '') ilike '%brouillon%'
      or coalesce(r.notes, '') ilike '%simulation%'
    )
),
unlink_intents as (
  update finance.online_payment_intents opi
     set receipt_id = null,
         updated_at = now()
   where opi.receipt_id in (select id from target_receipts)
   returning opi.id
),
deleted_allocations as (
  delete from finance.receipt_allocations ra
   where ra.receipt_id in (select id from target_receipts)
   returning ra.receipt_id
),
deleted_receipts as (
  delete from finance.receipts r
   where r.id in (select id from target_receipts)
   returning r.id, r.receipt_no, r.total_amount
),
deleted_drafts as (
  delete from finance.online_payment_intents opi
   where opi.id in (select id from target_intents)
   returning opi.id, opi.status, opi.amount
)
select
  (select count(*) from csca) as csca_structures_trouvees,
  (select count(*) from deleted_receipts) as recus_200000_supprimes,
  (select count(*) from deleted_allocations) as allocations_supprimees,
  (select count(*) from deleted_drafts) as brouillons_paiement_supprimes;

commit;
