-- src/db/mon_cahier_ai_v38_auto_training_dataset.sql
-- Mon Cahier IA v38 — Jeu de données automatique à partir des données existantes
-- Objectif : préparer l'entraînement ML sans demander de saisie manuelle à l'administration.
-- Principe : notes, évaluations, absences/retards, conduite, progression, effectif et lien parent
--            sont agrégés automatiquement en snapshots périodiques.
-- Migration additive : ne supprime aucune donnée existante.

begin;

create extension if not exists pgcrypto;

-- 1) Enrichir la table existante des échantillons sans casser la v2.
alter table public.ai_training_samples add column if not exists sample_kind text not null default 'student_period';
alter table public.ai_training_samples add column if not exists period_code text null;
alter table public.ai_training_samples add column if not exists period_label text null;
alter table public.ai_training_samples add column if not exists target_kind text not null default 'next_period_or_annual_decision';
alter table public.ai_training_samples add column if not exists label_status text not null default 'pending';
alter table public.ai_training_samples add column if not exists source_json jsonb not null default '{}'::jsonb;

create index if not exists idx_ai_training_samples_period
  on public.ai_training_samples(institution_id, academic_year, period_code, snapshot_date);

create index if not exists idx_ai_training_samples_label_status
  on public.ai_training_samples(institution_id, academic_year, label_status, is_usable);

comment on column public.ai_training_samples.sample_kind is
  'Nature de l’échantillon. v38 utilise student_period : un élève, une année, une période.';
comment on column public.ai_training_samples.label_status is
  'ready si le résultat cible est connu, pending si la période suivante ou décision annuelle manque encore.';
comment on column public.ai_training_samples.source_json is
  'Métadonnées d’origine : sources exploitées, sans nom/prénom ni téléphone parent.';

-- 2) Agrégats automatiques : un snapshot pédagogique par élève et par période.
-- Important : aucune donnée nominative n’est mise dans features_json.
create or replace view public.v_ai_student_period_feature_snapshots as
with periods as (
  select
    gp.id,
    gp.institution_id,
    gp.academic_year,
    gp.code as period_code,
    coalesce(gp.short_label, gp.label, gp.code) as period_label,
    gp.start_date::date as period_start,
    gp.end_date::date as period_end,
    row_number() over (
      partition by gp.institution_id, gp.academic_year
      order by gp.start_date nulls last, gp.end_date nulls last, gp.code
    ) as period_order
  from public.grade_periods gp
  where gp.start_date is not null
    and gp.end_date is not null
),
students_base as (
  -- Dans Mon Cahier, la classe courante/historique d'un élève est portée par class_enrollments,
  -- pas par public.students.class_id.
  select
    s.id as student_id,
    s.institution_id,
    ce.class_id,
    ce.id as enrollment_id,
    s.student_person_id,
    s.gender,
    s.is_affecte,
    s.is_boarder,
    s.lifecycle_status,
    c.label as class_label,
    c.level as class_level,
    c.academic_year
  from public.class_enrollments ce
  join public.students s on s.id = ce.student_id
  join public.classes c on c.id = ce.class_id
  where ce.class_id is not null
    and (ce.end_date is null or ce.end_date >= current_date)
),
class_sizes as (
  select
    ce.institution_id,
    ce.class_id,
    count(distinct ce.student_id)::integer as class_size
  from public.class_enrollments ce
  where ce.class_id is not null
    and (ce.end_date is null or ce.end_date >= current_date)
  group by ce.institution_id, ce.class_id
),
marks_base as (
  select
    c.institution_id,
    c.academic_year,
    ge.class_id,
    ge.subject_id,
    ge.eval_kind,
    ge.id as evaluation_id,
    ge.eval_date::date as eval_date,
    coalesce(nullif(ge.scale, 0), 20)::numeric as scale,
    coalesce(nullif(ge.coeff, 0), 1)::numeric as coeff,
    m.student_id,
    case
      when m.mark_20 is not null then m.mark_20::numeric
      when m.raw_score is not null and coalesce(nullif(ge.scale, 0), 20) > 0 then (m.raw_score::numeric / coalesce(nullif(ge.scale, 0), 20)::numeric) * 20
      else null
    end as mark_20
  from public.grade_evaluations ge
  join public.classes c on c.id = ge.class_id
  join public.grade_flat_marks m on m.evaluation_id = ge.id
  where coalesce(ge.is_published, false) = true
),
marks_period as (
  select mb.*, p.period_code, p.period_label, p.period_start, p.period_end, p.period_order
  from marks_base mb
  join periods p
    on p.institution_id = mb.institution_id
   and p.academic_year = mb.academic_year
   and mb.eval_date between p.period_start and p.period_end
  where mb.mark_20 is not null
),
student_period_subjects as (
  select
    institution_id,
    academic_year,
    period_code,
    class_id,
    student_id,
    subject_id,
    count(distinct evaluation_id)::integer as subject_evaluations_count,
    count(mark_20)::integer as subject_notes_count,
    round((sum(mark_20 * coeff) / nullif(sum(coeff), 0))::numeric, 2) as subject_avg_20
  from marks_period
  group by institution_id, academic_year, period_code, class_id, student_id, subject_id
),
student_period_grades as (
  select
    mp.institution_id,
    mp.academic_year,
    mp.period_code,
    max(mp.period_label) as period_label,
    max(mp.period_start) as period_start,
    max(mp.period_end) as period_end,
    max(mp.period_order) as period_order,
    mp.class_id,
    mp.student_id,
    count(distinct mp.evaluation_id)::integer as evaluations_count,
    count(mp.mark_20)::integer as notes_count,
    count(distinct mp.subject_id)::integer as subjects_evaluated_count,
    round(avg(mp.mark_20)::numeric, 2) as raw_avg_20,
    round((sum(mp.mark_20 * mp.coeff) / nullif(sum(mp.coeff), 0))::numeric, 2) as weighted_avg_20,
    min(sps.subject_avg_20) as weakest_subject_avg_20,
    count(*) filter (where sps.subject_avg_20 < 10)::integer as subjects_under_10_count,
    count(*) filter (where sps.subject_avg_20 < 8)::integer as subjects_under_8_count
  from marks_period mp
  left join student_period_subjects sps
    on sps.institution_id = mp.institution_id
   and sps.academic_year = mp.academic_year
   and sps.period_code = mp.period_code
   and sps.class_id = mp.class_id
   and sps.student_id = mp.student_id
   and sps.subject_id = mp.subject_id
  group by mp.institution_id, mp.academic_year, mp.period_code, mp.class_id, mp.student_id
),
eval_kind_stats as (
  select
    institution_id,
    academic_year,
    period_code,
    class_id,
    student_id,
    jsonb_object_agg(coalesce(nullif(eval_kind, ''), 'non_precise'), eval_count order by coalesce(nullif(eval_kind, ''), 'non_precise')) as eval_kinds_json
  from (
    select
      institution_id,
      academic_year,
      period_code,
      class_id,
      student_id,
      eval_kind,
      count(distinct evaluation_id)::integer as eval_count
    from marks_period
    group by institution_id, academic_year, period_code, class_id, student_id, eval_kind
  ) x
  group by institution_id, academic_year, period_code, class_id, student_id
),
attendance_period as (
  select
    ts.institution_id,
    c.academic_year,
    p.period_code,
    ts.class_id,
    am.student_id,
    count(distinct ts.id)::integer as attendance_sessions_count,
    count(*) filter (where lower(coalesce(am.status, '')) in ('absent', 'absence'))::integer as absences_count,
    round(coalesce(sum(coalesce(am.hours_absent, 0)), 0)::numeric, 2) as total_absent_hours,
    count(*) filter (
      where coalesce(am.minutes_late, 0) > 0
         or lower(coalesce(am.status, '')) in ('late', 'retard', 'retards')
    )::integer as lates_count,
    coalesce(sum(coalesce(am.minutes_late, 0)), 0)::integer as total_late_minutes
  from public.teacher_sessions ts
  join public.classes c on c.id = ts.class_id
  join periods p
    on p.institution_id = ts.institution_id
   and p.academic_year = c.academic_year
   and ts.started_at::date between p.period_start and p.period_end
  join public.attendance_marks am on am.session_id = ts.id
  group by ts.institution_id, c.academic_year, p.period_code, ts.class_id, am.student_id
),
conduct_period as (
  select
    sb.institution_id,
    sb.academic_year,
    p.period_code,
    sb.class_id,
    sb.student_id,
    count(cp.id)::integer as conduct_penalties_count,
    coalesce(sum(coalesce(cp.points, 0)), 0)::numeric as conduct_penalty_points
  from students_base sb
  join periods p
    on p.institution_id = sb.institution_id
   and p.academic_year = sb.academic_year
  left join public.conduct_penalties cp
    on cp.student_id = sb.student_id
   and cp.occurred_at::date between p.period_start and p.period_end
  group by sb.institution_id, sb.academic_year, p.period_code, sb.class_id, sb.student_id
),
parent_links as (
  select
    sg.student_id,
    count(*)::integer as guardian_links_count,
    count(*) filter (where coalesce(sg.notifications_enabled, true) = true)::integer as guardian_notifications_enabled_count
  from public.student_guardians sg
  group by sg.student_id
),
progression_class as (
  select
    a.class_id,
    c.institution_id,
    c.academic_year,
    count(distinct a.id)::integer as progressions_count,
    count(distinct pi.id)::integer as progression_items_count,
    count(distinct lc.item_id) filter (
      where lower(coalesce(lc.status, '')) in ('done', 'completed', 'complete', 'validated', 'termine', 'terminé')
    )::integer as progression_completed_items_count,
    round(
      case when count(distinct pi.id) > 0
        then (count(distinct lc.item_id) filter (where lower(coalesce(lc.status, '')) in ('done', 'completed', 'complete', 'validated', 'termine', 'terminé'))::numeric / count(distinct pi.id)::numeric) * 100
        else null
      end,
      2
    ) as progression_completion_percent
  from public.textbook_progression_class_assignments a
  join public.classes c on c.id = a.class_id
  left join public.textbook_progression_items pi on pi.progression_id = a.progression_id
  left join public.textbook_lesson_completions lc on lc.assignment_id = a.id and lc.item_id = pi.id
  where coalesce(a.is_active, true) = true
  group by a.class_id, c.institution_id, c.academic_year
)
select
  sb.institution_id,
  sb.academic_year,
  spg.period_code,
  spg.period_label,
  spg.period_start,
  spg.period_end,
  spg.period_order,
  sb.class_id,
  sb.student_id,
  sb.student_person_id,
  sb.enrollment_id,
  sb.class_level,
  cs.class_size,
  spg.evaluations_count,
  spg.notes_count,
  spg.subjects_evaluated_count,
  spg.raw_avg_20,
  spg.weighted_avg_20,
  spg.weakest_subject_avg_20,
  spg.subjects_under_10_count,
  spg.subjects_under_8_count,
  coalesce(ap.attendance_sessions_count, 0) as attendance_sessions_count,
  coalesce(ap.absences_count, 0) as absences_count,
  coalesce(ap.total_absent_hours, 0) as total_absent_hours,
  coalesce(ap.lates_count, 0) as lates_count,
  coalesce(ap.total_late_minutes, 0) as total_late_minutes,
  coalesce(cp.conduct_penalties_count, 0) as conduct_penalties_count,
  coalesce(cp.conduct_penalty_points, 0) as conduct_penalty_points,
  coalesce(pl.guardian_links_count, 0) as guardian_links_count,
  coalesce(pl.guardian_notifications_enabled_count, 0) as guardian_notifications_enabled_count,
  coalesce(pc.progressions_count, 0) as progressions_count,
  coalesce(pc.progression_items_count, 0) as progression_items_count,
  coalesce(pc.progression_completed_items_count, 0) as progression_completed_items_count,
  pc.progression_completion_percent,
  jsonb_build_object(
    'sample_kind', 'student_period',
    'class_level', sb.class_level,
    'class_size', cs.class_size,
    'gender_known', sb.gender is not null,
    'is_affecte', sb.is_affecte,
    'is_boarder', sb.is_boarder,
    'lifecycle_status', sb.lifecycle_status,
    'period_order', spg.period_order,
    'evaluations_count', spg.evaluations_count,
    'notes_count', spg.notes_count,
    'subjects_evaluated_count', spg.subjects_evaluated_count,
    'eval_kinds', coalesce(eks.eval_kinds_json, '{}'::jsonb),
    'raw_avg_20', spg.raw_avg_20,
    'weighted_avg_20', spg.weighted_avg_20,
    'weakest_subject_avg_20', spg.weakest_subject_avg_20,
    'subjects_under_10_count', spg.subjects_under_10_count,
    'subjects_under_8_count', spg.subjects_under_8_count,
    'attendance_sessions_count', coalesce(ap.attendance_sessions_count, 0),
    'absences_count', coalesce(ap.absences_count, 0),
    'total_absent_hours', coalesce(ap.total_absent_hours, 0),
    'lates_count', coalesce(ap.lates_count, 0),
    'total_late_minutes', coalesce(ap.total_late_minutes, 0),
    'conduct_penalties_count', coalesce(cp.conduct_penalties_count, 0),
    'conduct_penalty_points', coalesce(cp.conduct_penalty_points, 0),
    'guardian_links_count', coalesce(pl.guardian_links_count, 0),
    'guardian_notifications_enabled_count', coalesce(pl.guardian_notifications_enabled_count, 0),
    'progressions_count', coalesce(pc.progressions_count, 0),
    'progression_items_count', coalesce(pc.progression_items_count, 0),
    'progression_completed_items_count', coalesce(pc.progression_completed_items_count, 0),
    'progression_completion_percent', pc.progression_completion_percent
  ) as features_json,
  jsonb_build_object(
    'source', 'mon_cahier_existing_data',
    'uses_names', false,
    'uses_parent_phone', false,
    'uses_manual_ai_actions', false,
    'generated_by', 'mon_cahier_ai_v38_auto_training_dataset'
  ) as source_json
from students_base sb
join student_period_grades spg
  on spg.institution_id = sb.institution_id
 and spg.academic_year = sb.academic_year
 and spg.class_id = sb.class_id
 and spg.student_id = sb.student_id
left join class_sizes cs on cs.institution_id = sb.institution_id and cs.class_id = sb.class_id
left join eval_kind_stats eks
  on eks.institution_id = spg.institution_id
 and eks.academic_year = spg.academic_year
 and eks.period_code = spg.period_code
 and eks.class_id = spg.class_id
 and eks.student_id = spg.student_id
left join attendance_period ap
  on ap.institution_id = spg.institution_id
 and ap.academic_year = spg.academic_year
 and ap.period_code = spg.period_code
 and ap.class_id = spg.class_id
 and ap.student_id = spg.student_id
left join conduct_period cp
  on cp.institution_id = spg.institution_id
 and cp.academic_year = spg.academic_year
 and cp.period_code = spg.period_code
 and cp.class_id = spg.class_id
 and cp.student_id = spg.student_id
left join parent_links pl on pl.student_id = sb.student_id
left join progression_class pc
  on pc.institution_id = sb.institution_id
 and pc.academic_year = sb.academic_year
 and pc.class_id = sb.class_id;

comment on view public.v_ai_student_period_feature_snapshots is
  'Mon Cahier IA v38 : snapshots automatiques élève+période issus des notes, évaluations, assiduité, conduite, progression, effectifs et liens parents. Aucune saisie IA manuelle.';

-- 3) Résultats réels associés : période suivante et décision annuelle si disponible.
create or replace view public.v_ai_student_period_training_dataset as
with snapshots as (
  select * from public.v_ai_student_period_feature_snapshots
),
next_period as (
  select
    s1.institution_id,
    s1.academic_year,
    s1.student_id,
    s1.class_id,
    s1.period_code,
    s2.period_code as next_period_code,
    s2.weighted_avg_20 as next_weighted_avg_20,
    s2.raw_avg_20 as next_raw_avg_20,
    s2.subjects_under_10_count as next_subjects_under_10_count,
    s2.subjects_under_8_count as next_subjects_under_8_count
  from snapshots s1
  left join snapshots s2
    on s2.institution_id = s1.institution_id
   and s2.academic_year = s1.academic_year
   and s2.student_id = s1.student_id
   and s2.period_order = s1.period_order + 1
),
decisions as (
  select
    d.institution_id,
    d.academic_year,
    d.student_id,
    d.decision_type,
    d.decision_label,
    d.is_repeater_next_year,
    d.decided_at
  from public.student_year_decisions d
  where d.decision_type is not null
    and d.decision_type <> 'pending'
)
select
  s.institution_id,
  s.academic_year,
  s.period_code,
  s.period_label,
  s.period_end as snapshot_date,
  s.class_id,
  s.student_id,
  s.student_person_id,
  s.enrollment_id,
  s.features_json,
  jsonb_build_object(
    'target_kind', 'next_period_or_annual_decision',
    'next_period_code', np.next_period_code,
    'next_weighted_avg_20', np.next_weighted_avg_20,
    'next_raw_avg_20', np.next_raw_avg_20,
    'delta_weighted_avg_20', case
      when np.next_weighted_avg_20 is null or s.weighted_avg_20 is null then null
      else round((np.next_weighted_avg_20 - s.weighted_avg_20)::numeric, 2)
    end,
    'improved_next_period', case
      when np.next_weighted_avg_20 is null or s.weighted_avg_20 is null then null
      else np.next_weighted_avg_20 > s.weighted_avg_20
    end,
    'still_under_10_next_period', case
      when np.next_weighted_avg_20 is null then null
      else np.next_weighted_avg_20 < 10
    end,
    'next_subjects_under_10_count', np.next_subjects_under_10_count,
    'next_subjects_under_8_count', np.next_subjects_under_8_count,
    'annual_decision_type', d.decision_type,
    'annual_decision_label', d.decision_label,
    'is_repeater_next_year', d.is_repeater_next_year
  ) as label_json,
  case
    when np.next_period_code is not null or d.decision_type is not null then 'ready'
    else 'pending'
  end as label_status,
  case
    when np.next_period_code is not null or d.decision_type is not null then true
    else false
  end as is_usable,
  case
    when np.next_period_code is not null or d.decision_type is not null then null
    else 'label_pending_next_period_or_decision'
  end as exclusion_reason,
  s.source_json || jsonb_build_object(
    'label_source', case
      when np.next_period_code is not null and d.decision_type is not null then 'next_period_and_annual_decision'
      when np.next_period_code is not null then 'next_period'
      when d.decision_type is not null then 'annual_decision'
      else 'pending'
    end
  ) as source_json
from snapshots s
left join next_period np
  on np.institution_id = s.institution_id
 and np.academic_year = s.academic_year
 and np.student_id = s.student_id
 and np.class_id = s.class_id
 and np.period_code = s.period_code
left join decisions d
  on d.institution_id = s.institution_id
 and d.academic_year = s.academic_year
 and d.student_id = s.student_id;

comment on view public.v_ai_student_period_training_dataset is
  'Mon Cahier IA v38 : dataset prêt à injecter dans ai_training_samples. Les lignes sans résultat connu restent pending.';

-- 4) Fonction de reconstruction automatique : aucun suivi manuel des actions IA.
create or replace function public.mon_cahier_ai_rebuild_training_samples(
  p_institution_id uuid,
  p_academic_year text,
  p_model_key text default 'mon_cahier_ai_pedagogy'
)
returns table (
  rows_total integer,
  rows_ready integer,
  rows_pending integer
)
language plpgsql
security definer
as $$
begin
  insert into public.ai_training_samples (
    institution_id,
    academic_year,
    snapshot_date,
    class_id,
    student_id,
    enrollment_id,
    model_key,
    features_json,
    label_json,
    is_usable,
    exclusion_reason,
    sample_kind,
    period_code,
    period_label,
    target_kind,
    label_status,
    source_json,
    created_at
  )
  select
    d.institution_id,
    d.academic_year,
    d.snapshot_date,
    d.class_id,
    d.student_id,
    d.enrollment_id,
    p_model_key,
    d.features_json,
    d.label_json,
    d.is_usable,
    d.exclusion_reason,
    'student_period',
    d.period_code,
    d.period_label,
    'next_period_or_annual_decision',
    d.label_status,
    d.source_json,
    now()
  from public.v_ai_student_period_training_dataset d
  where d.institution_id = p_institution_id
    and d.academic_year = p_academic_year
  on conflict (institution_id, academic_year, snapshot_date, class_id, student_id, model_key)
  do update set
    features_json = excluded.features_json,
    label_json = excluded.label_json,
    is_usable = excluded.is_usable,
    exclusion_reason = excluded.exclusion_reason,
    sample_kind = excluded.sample_kind,
    period_code = excluded.period_code,
    period_label = excluded.period_label,
    target_kind = excluded.target_kind,
    label_status = excluded.label_status,
    source_json = excluded.source_json;

  return query
  select
    count(*)::integer as rows_total,
    count(*) filter (where label_status = 'ready' and is_usable)::integer as rows_ready,
    count(*) filter (where label_status <> 'ready' or not is_usable)::integer as rows_pending
  from public.ai_training_samples
  where institution_id = p_institution_id
    and academic_year = p_academic_year
    and model_key = p_model_key
    and sample_kind = 'student_period';
end;
$$;

comment on function public.mon_cahier_ai_rebuild_training_samples(uuid, text, text) is
  'Reconstruit ai_training_samples automatiquement à partir des données naturelles de Mon Cahier : notes, évaluations, assiduité, conduite, progression, effectifs, liens parents, décisions annuelles si disponibles.';

commit;
