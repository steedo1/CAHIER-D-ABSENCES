-- =========================================================
-- Mon Cahier - Réparation SAFE des matières du Cahier de texte
-- Corrige les progressions/copies/affectations déjà créées avec
-- subject_id ou institution_subject_id NULL.
-- Ne supprime aucune progression, séance, note, élève ou classe.
-- =========================================================

begin;

create or replace function pg_temp.textbook_subject_key(value text)
returns text
language sql
immutable
as $$
  with normalized as (
    select regexp_replace(
      translate(
        lower(coalesce(value, '')),
        'àáâäãåçèéêëìíîïñòóôöõùúûüÿ',
        'aaaaaaceeeeiiiinooooouuuuy'
      ),
      '[^a-z0-9]+',
      '',
      'g'
    ) as key
  )
  select case key
    when 'math' then 'mathematiques'
    when 'maths' then 'mathematiques'
    when 'mathematique' then 'mathematiques'
    when 'esp' then 'espagnol'
    when 'all' then 'allemand'
    when 'ang' then 'anglais'
    when 'fr' then 'francais'
    when 'pc' then 'physiquechimie'
    when 'hg' then 'histoiregeographie'
    when 'educationmusicale' then 'musique'
    when 'artplastique' then 'artsplastiques'
    when 'artsplastique' then 'artsplastiques'
    else key
  end
  from normalized;
$$;

-- 1) Modèles nationaux : rattachement à subjects.id par le nom/code/clé.
with ranked as (
  select
    t.id as progression_id,
    s.id as subject_id,
    row_number() over (
      partition by t.id
      order by
        case
          when pg_temp.textbook_subject_key(t.subject_name) = pg_temp.textbook_subject_key(s.name) then 0
          when pg_temp.textbook_subject_key(t.subject_name) = pg_temp.textbook_subject_key(s.subject_key) then 1
          else 2
        end,
        s.id
    ) as rn
  from public.textbook_progression_templates t
  join public.subjects s
    on pg_temp.textbook_subject_key(t.subject_name) in (
      pg_temp.textbook_subject_key(s.name),
      pg_temp.textbook_subject_key(s.code),
      pg_temp.textbook_subject_key(s.subject_key)
    )
  where t.scope = 'national'
    and nullif(trim(coalesce(t.subject_name, '')), '') is not null
), resolved as (
  select progression_id, subject_id
  from ranked
  where rn = 1
)
update public.textbook_progression_templates t
set
  subject_id = r.subject_id,
  updated_at = now()
from resolved r
where t.id = r.progression_id
  and t.subject_id is distinct from r.subject_id;

-- 2) Copies établissement : résolution vers le référentiel matière de l'école.
with ranked as (
  select
    t.id as progression_id,
    s.id as subject_id,
    ins.id as institution_subject_id,
    coalesce(nullif(trim(ins.custom_name), ''), s.name, t.subject_name) as resolved_name,
    row_number() over (
      partition by t.id
      order by
        case
          when pg_temp.textbook_subject_key(t.subject_name) = pg_temp.textbook_subject_key(ins.custom_name) then 0
          when pg_temp.textbook_subject_key(t.subject_name) = pg_temp.textbook_subject_key(s.name) then 1
          when pg_temp.textbook_subject_key(t.subject_name) = pg_temp.textbook_subject_key(s.subject_key) then 2
          else 3
        end,
        ins.id
    ) as rn
  from public.textbook_progression_templates t
  join public.institution_subjects ins
    on ins.institution_id = t.institution_id
  join public.subjects s
    on s.id = ins.subject_id
  where t.scope = 'school'
    and t.institution_id is not null
    and nullif(trim(coalesce(t.subject_name, '')), '') is not null
    and pg_temp.textbook_subject_key(t.subject_name) in (
      pg_temp.textbook_subject_key(ins.custom_name),
      pg_temp.textbook_subject_key(s.name),
      pg_temp.textbook_subject_key(s.code),
      pg_temp.textbook_subject_key(s.subject_key)
    )
), resolved as (
  select progression_id, subject_id, institution_subject_id, resolved_name
  from ranked
  where rn = 1
)
update public.textbook_progression_templates t
set
  subject_id = r.subject_id,
  institution_subject_id = r.institution_subject_id,
  subject_name = coalesce(r.resolved_name, t.subject_name),
  updated_at = now()
from resolved r
where t.id = r.progression_id
  and (
    t.subject_id is distinct from r.subject_id
    or t.institution_subject_id is distinct from r.institution_subject_id
  );

-- 3) Affectations aux classes : toujours reprendre la matière de la progression.
update public.textbook_progression_class_assignments a
set
  subject_id = t.subject_id,
  institution_subject_id = t.institution_subject_id,
  updated_at = now()
from public.textbook_progression_templates t
where t.id = a.progression_id
  and a.institution_id = t.institution_id
  and (
    a.subject_id is distinct from t.subject_id
    or a.institution_subject_id is distinct from t.institution_subject_id
  );

-- 4) Historique déjà saisi : complète les matières manquantes sans supprimer les séances.
update public.textbook_lesson_sessions s
set
  subject_id = coalesce(a.subject_id, t.subject_id),
  institution_subject_id = coalesce(a.institution_subject_id, t.institution_subject_id),
  updated_at = now()
from public.textbook_progression_class_assignments a
join public.textbook_progression_templates t on t.id = a.progression_id
where s.assignment_id = a.id
  and s.institution_id = a.institution_id
  and (
    s.subject_id is distinct from coalesce(a.subject_id, t.subject_id)
    or s.institution_subject_id is distinct from coalesce(a.institution_subject_id, t.institution_subject_id)
  );

update public.textbook_lesson_completions c
set
  subject_id = coalesce(a.subject_id, t.subject_id),
  institution_subject_id = coalesce(a.institution_subject_id, t.institution_subject_id),
  updated_at = now()
from public.textbook_progression_class_assignments a
join public.textbook_progression_templates t on t.id = a.progression_id
where c.assignment_id = a.id
  and c.institution_id = a.institution_id
  and (
    c.subject_id is distinct from coalesce(a.subject_id, t.subject_id)
    or c.institution_subject_id is distinct from coalesce(a.institution_subject_id, t.institution_subject_id)
  );

commit;

-- Contrôle final : les progressions utilisées par les écoles doivent être rattachées.
select
  'textbook_subject_links_repaired' as check_name,
  count(*) filter (
    where t.scope = 'school'
      and t.status <> 'archived'
  ) as progressions_etablissement,
  count(*) filter (
    where t.scope = 'school'
      and t.status <> 'archived'
      and t.subject_id is null
  ) as progressions_sans_subject_id,
  count(*) filter (
    where t.scope = 'school'
      and t.status <> 'archived'
      and t.institution_subject_id is null
  ) as progressions_sans_matiere_etablissement
from public.textbook_progression_templates t;
