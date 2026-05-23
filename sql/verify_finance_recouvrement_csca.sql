-- Vérification du vrai montant à recouvrer CSCA pour une année scolaire donnée.
-- Modifie target_year si nécessaire.

with params as (
  select '2026-2027'::text as target_year
),
csca as (
  select i.id, i.name, i.code
  from public.institutions i
  where i.name ilike '%CSCA%'
     or i.name ilike '%COURS%SECONDAIRE%CATHOLIQUE%'
     or coalesce(i.code, '') ilike '%CSCA%'
),
classes_year as (
  select c.id, c.label, c.level, c.academic_year, c.institution_id
  from public.classes c
  join csca s on s.id = c.institution_id
  join params p on true
  where c.academic_year = p.target_year
),
all_balances as (
  select b.*
  from finance.v_charge_balances b
  join classes_year c on c.id = b.class_id
  join csca s on s.id = b.school_id
  where coalesce(b.computed_status::text, '') <> 'cancelled'
),
first_1000_like_screen as (
  select *
  from all_balances
  order by id
  limit 1000
),
resume as (
  select
    'TOTAL_REEL_TOUTES_LIGNES' as bloc,
    count(*)::bigint as lignes,
    count(*) filter (where coalesce(balance_due, 0) > 0)::bigint as dettes_ouvertes,
    coalesce(sum(coalesce(net_amount, 0)), 0)::numeric as total_facture,
    coalesce(sum(coalesce(paid_amount, 0)), 0)::numeric as total_encaisse,
    coalesce(sum(coalesce(balance_due, 0)) filter (where coalesce(balance_due, 0) > 0), 0)::numeric as reste_a_recouvrer
  from all_balances
  union all
  select
    'SIMULATION_ECRAN_LIMITE_1000' as bloc,
    count(*)::bigint as lignes,
    count(*) filter (where coalesce(balance_due, 0) > 0)::bigint as dettes_ouvertes,
    coalesce(sum(coalesce(net_amount, 0)), 0)::numeric as total_facture,
    coalesce(sum(coalesce(paid_amount, 0)), 0)::numeric as total_encaisse,
    coalesce(sum(coalesce(balance_due, 0)) filter (where coalesce(balance_due, 0) > 0), 0)::numeric as reste_a_recouvrer
  from first_1000_like_screen
)
select * from resume;

-- Détail par classe pour contrôler l’origine des montants.
with params as (
  select '2026-2027'::text as target_year
),
csca as (
  select i.id, i.name, i.code
  from public.institutions i
  where i.name ilike '%CSCA%'
     or i.name ilike '%COURS%SECONDAIRE%CATHOLIQUE%'
     or coalesce(i.code, '') ilike '%CSCA%'
),
classes_year as (
  select c.id, c.label, c.level, c.academic_year, c.institution_id
  from public.classes c
  join csca s on s.id = c.institution_id
  join params p on true
  where c.academic_year = p.target_year
),
all_balances as (
  select b.*
  from finance.v_charge_balances b
  join classes_year c on c.id = b.class_id
  join csca s on s.id = b.school_id
  where coalesce(b.computed_status::text, '') <> 'cancelled'
)
select
  c.label as classe,
  count(b.id)::bigint as lignes,
  count(b.id) filter (where coalesce(b.balance_due, 0) > 0)::bigint as dettes_ouvertes,
  coalesce(sum(coalesce(b.net_amount, 0)), 0)::numeric as total_facture,
  coalesce(sum(coalesce(b.paid_amount, 0)), 0)::numeric as total_encaisse,
  coalesce(sum(coalesce(b.balance_due, 0)) filter (where coalesce(b.balance_due, 0) > 0), 0)::numeric as reste_a_recouvrer
from classes_year c
left join all_balances b on b.class_id = c.id
group by c.label, c.level
order by c.level nulls last, c.label;
