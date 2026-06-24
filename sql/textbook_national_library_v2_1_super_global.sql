-- =========================================================
-- Mon Cahier - Cahier de texte / Bibliothèque nationale
-- Correctif SQL SAFE V2 + V2.1
-- À utiliser si l'erreur "column scope does not exist" apparaît.
-- Script idempotent : ne supprime aucune donnée existante.
-- =========================================================

begin;

create extension if not exists pgcrypto;

-- 1) Ajouter d'abord les colonnes V2 si elles n'existent pas encore.
alter table public.textbook_progression_templates
  add column if not exists scope text not null default 'school';

alter table public.textbook_progression_templates
  add column if not exists source_national_template_id uuid
  references public.textbook_progression_templates(id) on delete set null;

alter table public.textbook_progression_templates
  add column if not exists is_customized boolean not null default false;

alter table public.textbook_progression_templates
  add column if not exists published_at timestamptz;

alter table public.textbook_progression_templates
  add column if not exists published_by uuid;

alter table public.textbook_progression_templates
  add column if not exists archived_at timestamptz;

alter table public.textbook_progression_templates
  add column if not exists archived_by uuid;

alter table public.textbook_progression_templates
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

-- Les anciennes progressions deviennent explicitement des progressions établissement.
update public.textbook_progression_templates
set scope = 'school'
where scope is null or scope = '';

-- 2) Contraindre les valeurs possibles de scope.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'textbook_progression_templates_scope_check'
      and conrelid = 'public.textbook_progression_templates'::regclass
  ) then
    alter table public.textbook_progression_templates
      add constraint textbook_progression_templates_scope_check
      check (scope in ('national','school'));
  end if;
end $$;

-- 3) Métadonnées de copie sur les lignes de progression.
alter table public.textbook_progression_items
  add column if not exists source_national_item_id uuid
  references public.textbook_progression_items(id) on delete set null;

alter table public.textbook_progression_items
  add column if not exists is_customized boolean not null default false;

-- 4) Les modèles nationaux Nexa sont globaux : institution_id peut être NULL
-- uniquement pour les documents/templates/items nationaux.
alter table public.textbook_progression_documents
  alter column institution_id drop not null;

alter table public.textbook_progression_templates
  alter column institution_id drop not null;

alter table public.textbook_progression_items
  alter column institution_id drop not null;

-- 5) Protection : une progression établissement doit rester rattachée à une école.
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

-- 6) Index utiles.
create index if not exists idx_textbook_templates_scope_year
  on public.textbook_progression_templates (scope, academic_year, status, level, subject_id);

create index if not exists idx_textbook_templates_source_national
  on public.textbook_progression_templates (source_national_template_id, institution_id, status);

create index if not exists idx_textbook_items_source_national
  on public.textbook_progression_items (source_national_item_id);

create unique index if not exists ux_textbook_school_copy_active
  on public.textbook_progression_templates (institution_id, source_national_template_id)
  where scope = 'school'
    and source_national_template_id is not null
    and status <> 'archived';

create index if not exists idx_textbook_templates_national_global
  on public.textbook_progression_templates (academic_year, status, subject_name, level)
  where scope = 'national';

create index if not exists idx_textbook_items_progression_global
  on public.textbook_progression_items (progression_id, sort_order, created_at);

comment on column public.textbook_progression_templates.scope is
  'national = modèle de la bibliothèque Nexa ; school = copie ou progression propre à un établissement.';

comment on column public.textbook_progression_templates.source_national_template_id is
  'Référence au modèle national d’origine quand la progression établissement provient de la bibliothèque Nexa.';

comment on column public.textbook_progression_items.source_national_item_id is
  'Référence à la ligne nationale d’origine quand la ligne établissement est issue d’une copie.';

comment on constraint textbook_templates_school_requires_institution
  on public.textbook_progression_templates is
  'Les progressions établissement restent rattachées à une école ; les modèles nationaux Nexa sont globaux.';

commit;

select
  'textbook_national_library_v2_1_safe_ok' as check_name,
  count(*) filter (where scope = 'national') as modeles_nationaux,
  count(*) filter (where scope = 'national' and institution_id is null) as modeles_nationaux_globaux,
  count(*) filter (where scope = 'school' and institution_id is not null) as progressions_etablissement
from public.textbook_progression_templates;
