-- =========================================================
-- Mon Cahier - Cahier de texte / Bibliothèque nationale V2.1
-- Objectif : séparer clairement la bibliothèque globale Nexa
-- de l'espace établissement.
--
-- À exécuter après :
-- 1) sql/textbook_module_v1.sql
-- 2) sql/textbook_national_library_v2.sql
--
-- Script idempotent : ne supprime aucune donnée existante.
-- =========================================================

begin;

-- Les modèles nationaux sont globaux : ils ne doivent pas dépendre
-- d'un établissement particulier. On autorise donc institution_id à NULL
-- uniquement pour les données nationales / globales.
alter table public.textbook_progression_documents
  alter column institution_id drop not null;

alter table public.textbook_progression_templates
  alter column institution_id drop not null;

alter table public.textbook_progression_items
  alter column institution_id drop not null;

-- Protection : une progression établissement doit toujours rester rattachée
-- à un établissement. Seuls les modèles nationaux peuvent avoir institution_id NULL.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'textbook_templates_school_requires_institution'
      and conrelid = 'public.textbook_progression_templates'::regclass
  ) then
    alter table public.textbook_progression_templates
      add constraint textbook_templates_school_requires_institution
      check (scope = 'national' or institution_id is not null);
  end if;
end $$;

-- Index global pour la bibliothèque nationale Nexa.
create index if not exists idx_textbook_templates_national_global
  on public.textbook_progression_templates (academic_year, status, subject_name, level)
  where scope = 'national';

create index if not exists idx_textbook_items_progression_global
  on public.textbook_progression_items (progression_id, sort_order, created_at);

comment on constraint textbook_templates_school_requires_institution
  on public.textbook_progression_templates is
  'Les progressions établissement restent rattachées à une école ; les modèles nationaux Nexa sont globaux.';

commit;

select
  'textbook_national_library_v2_1_ok' as check_name,
  count(*) filter (where scope = 'national') as modeles_nationaux,
  count(*) filter (where scope = 'national' and institution_id is null) as modeles_nationaux_globaux,
  count(*) filter (where scope = 'school' and institution_id is not null) as progressions_etablissement
from public.textbook_progression_templates;
