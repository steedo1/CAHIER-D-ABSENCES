-- Correctif sécurité QR bulletin : colonnes optionnelles utilisées par la vérification publique
-- Objectif : éviter qu'une colonne institutionnelle optionnelle absente fasse tomber la route publique.
-- À exécuter dans Supabase SQL Editor si la route retourne INSTITUTION_NOT_FOUND
-- alors que l'établissement existe, ou si Supabase signale "column acronym does not exist".

begin;

alter table public.institutions
  add column if not exists code_unique text,
  add column if not exists acronym text,
  add column if not exists logo_url text,
  add column if not exists settings_json jsonb not null default '{}'::jsonb;

update public.institutions
set settings_json = '{}'::jsonb
where settings_json is null;

select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'institutions'
  and column_name in ('id','name','code','code_unique','acronym','logo_url','settings_json')
order by column_name;

commit;
