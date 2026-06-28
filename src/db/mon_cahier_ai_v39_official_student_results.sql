-- src/db/mon_cahier_ai_v39_official_student_results.sql
-- Mon Cahier IA v39 — Résultats officiels élèves et décisions annuelles persistés
-- Objectif : ne plus laisser les résultats importants seulement dans le PDF du bulletin.
-- Principe : T1/T2/T3 sont enregistrés en base, puis la décision annuelle est calculée/persistée
--            sans saisie manuelle supplémentaire pour l'administration.
-- Migration additive : ne supprime aucune donnée existante.

begin;

create extension if not exists pgcrypto;

-- 1) Résultat officiel d'un élève pour une période : T1, T2, T3, etc.
create table if not exists public.student_period_results (
  id uuid primary key default gen_random_uuid(),
  student_person_id uuid null references public.student_persons(id) on delete set null,
  student_id uuid not null references public.students(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  academic_year text not null,
  class_id uuid null references public.classes(id) on delete set null,
  enrollment_id uuid null references public.class_enrollments(id) on delete set null,
  period_id uuid null references public.grade_periods(id) on delete set null,
  period_code text not null,
  period_label text null,
  period_start date null,
  period_end date null,
  period_order integer null,
  class_size integer null,
  general_avg_20 numeric(6,2) null,
  general_rank integer null,
  evaluations_count integer not null default 0,
  notes_count integer not null default 0,
  subjects_evaluated_count integer not null default 0,
  subjects_under_10_count integer not null default 0,
  subjects_under_8_count integer not null default 0,
  absences_count integer not null default 0,
  lates_count integer not null default 0,
  total_absent_hours numeric(8,2) not null default 0,
  total_late_minutes integer not null default 0,
  conduct_penalties_count integer not null default 0,
  conduct_penalty_points numeric(8,2) not null default 0,
  status text not null default 'computed',
  source text not null default 'auto_from_existing_school_data',
  computed_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, student_id, academic_year, period_code)
);

-- 2) Résultat officiel par matière et par période.
create table if not exists public.student_subject_period_results (
  id uuid primary key default gen_random_uuid(),
  student_period_result_id uuid null references public.student_period_results(id) on delete cascade,
  student_person_id uuid null references public.student_persons(id) on delete set null,
  student_id uuid not null references public.students(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  academic_year text not null,
  class_id uuid null references public.classes(id) on delete set null,
  enrollment_id uuid null references public.class_enrollments(id) on delete set null,
  period_id uuid null references public.grade_periods(id) on delete set null,
  period_code text not null,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  subject_name text null,
  avg_score_20 numeric(6,2) null,
  subject_rank integer null,
  evaluations_count integer not null default 0,
  notes_count integer not null default 0,
  coeff_sum numeric(8,2) null,
  status text not null default 'computed',
  source text not null default 'auto_from_existing_school_data',
  computed_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (institution_id, student_id, academic_year, period_code, subject_id)
);

-- 3) Enrichir les décisions annuelles v37 pour garder la moyenne annuelle officielle.
alter table public.student_year_decisions add column if not exists annual_avg_20 numeric(6,2) null;
alter table public.student_year_decisions add column if not exists annual_rank integer null;
alter table public.student_year_decisions add column if not exists annual_status text null;
alter table public.student_year_decisions add column if not exists periods_expected integer null;
alter table public.student_year_decisions add column if not exists periods_covered integer null;
alter table public.student_year_decisions add column if not exists computed_from_results_at timestamptz null;

create index if not exists idx_student_period_results_school_period
  on public.student_period_results(institution_id, academic_year, period_code, class_id);

create index if not exists idx_student_period_results_student_year
  on public.student_period_results(student_id, academic_year, period_order);

create index if not exists idx_student_subject_period_results_school_period
  on public.student_subject_period_results(institution_id, academic_year, period_code, subject_id);

create index if not exists idx_student_year_decisions_annual_status
  on public.student_year_decisions(institution_id, academic_year, annual_status, decision_type);

-- Triggers updated_at si la fonction v37 existe.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mon_cahier_touch_updated_at'
  ) then
    drop trigger if exists trg_student_period_results_touch_updated_at on public.student_period_results;
    create trigger trg_student_period_results_touch_updated_at
    before update on public.student_period_results
    for each row execute function public.mon_cahier_touch_updated_at();

    drop trigger if exists trg_student_subject_period_results_touch_updated_at on public.student_subject_period_results;
    create trigger trg_student_subject_period_results_touch_updated_at
    before update on public.student_subject_period_results
    for each row execute function public.mon_cahier_touch_updated_at();
  end if;
end $$;

comment on table public.student_period_results is
  'Résultats officiels persistés par élève et période. Sert de socle stable pour bulletins, audits et IA.';
comment on table public.student_subject_period_results is
  'Résultats officiels persistés par matière, élève et période. Sert de socle stable pour remédiation et dataset IA.';
comment on column public.student_year_decisions.annual_avg_20 is
  'Moyenne annuelle officielle calculée depuis student_period_results, pas seulement affichée dans le PDF.';

-- Normalisation légère pour reconnaître 3e / Terminale sans dépendre du front.
create or replace function public.mon_cahier_ai_v39_normalize_token(p_value text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    lower(translate(coalesce(p_value, ''),
      'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿ',
      'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyy'
    )),
    '[^a-z0-9]+',
    '',
    'g'
  );
$$;

create or replace function public.mon_cahier_ai_v39_is_third_grade(
  p_level text,
  p_label text,
  p_code text,
  p_track text
)
returns boolean
language sql
immutable
as $$
  select public.mon_cahier_ai_v39_normalize_token(concat_ws(' ', p_level, p_label, p_code, p_track)) ~ '(^|[^a-z0-9])?3e|troisieme';
$$;

create or replace function public.mon_cahier_ai_v39_is_terminale(
  p_level text,
  p_label text,
  p_code text,
  p_track text
)
returns boolean
language sql
immutable
as $$
  select public.mon_cahier_ai_v39_normalize_token(concat_ws(' ', p_level, p_label, p_code, p_track)) like 'tle%'
      or public.mon_cahier_ai_v39_normalize_token(concat_ws(' ', p_level, p_label, p_code, p_track)) like '%terminale%';
$$;

create or replace function public.mon_cahier_ai_v39_decision_from_official_result(
  p_annual_avg numeric,
  p_level text,
  p_label text,
  p_code text,
  p_track text,
  p_is_affecte boolean,
  p_is_repeater boolean
)
returns table (
  decision_type text,
  decision_label text,
  is_repeater_next_year boolean
)
language plpgsql
immutable
as $$
begin
  if p_annual_avg is null then
    decision_type := 'pending';
    decision_label := null;
    is_repeater_next_year := null;
    return next;
    return;
  end if;

  -- Classes d'examen : le bulletin affiche une décision conditionnelle liée à l'examen/orientation.
  if public.mon_cahier_ai_v39_is_third_grade(p_level, p_label, p_code, p_track) then
    decision_type := 'oriented';
    decision_label := case when coalesce(p_is_affecte, false) = true and coalesce(p_is_repeater, false) = false then 'RNO' else 'ENO' end;
    is_repeater_next_year := null;
    return next;
    return;
  end if;

  if public.mon_cahier_ai_v39_is_terminale(p_level, p_label, p_code, p_track) then
    decision_type := 'oriented';
    decision_label := case when coalesce(p_is_affecte, false) = true and coalesce(p_is_repeater, false) = false then 'REC' else 'EEC' end;
    is_repeater_next_year := null;
    return next;
    return;
  end if;

  if p_annual_avg >= 10 then
    decision_type := 'admitted';
    decision_label := 'ADMIS';
    is_repeater_next_year := false;
  elsif p_annual_avg >= 8.5 and coalesce(p_is_repeater, false) = false then
    decision_type := 'repeated';
    decision_label := 'REDOUBLE';
    is_repeater_next_year := true;
  else
    decision_type := 'excluded';
    decision_label := 'EXCLU';
    is_repeater_next_year := false;
  end if;

  return next;
end;
$$;

-- Fonction centrale : reconstruit les résultats officiels persistés depuis les données déjà disponibles.
-- Elle ne demande aucune saisie IA et ne lit pas les plans de remédiation proposés.
create or replace function public.mon_cahier_rebuild_official_student_results(
  p_institution_id uuid,
  p_academic_year text
)
returns table (
  period_results_count integer,
  subject_results_count integer,
  year_decisions_count integer
)
language plpgsql
security definer
as $$
declare
  v_period_count integer := 0;
  v_subject_count integer := 0;
  v_decision_count integer := 0;
begin
  -- A) Résultats matière par période.
  with periods as (
    select
      gp.id as period_id,
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
    where gp.institution_id = p_institution_id
      and gp.academic_year = p_academic_year
      and gp.start_date is not null
      and gp.end_date is not null
  ),
  enrollments as (
    select
      s.id as student_id,
      s.student_person_id,
      s.institution_id,
      s.is_repeater,
      s.is_affecte,
      ce.id as enrollment_id,
      ce.class_id,
      c.academic_year,
      c.label as class_label,
      c.code as class_code,
      c.level as class_level,
      c.official_track_code
    from public.class_enrollments ce
    join public.students s on s.id = ce.student_id
    join public.classes c on c.id = ce.class_id
    where s.institution_id = p_institution_id
      and c.academic_year = p_academic_year
      and (ce.end_date is null or ce.end_date >= current_date)
  ),
  marks_base as (
    select
      e.student_id,
      e.student_person_id,
      e.institution_id,
      e.academic_year,
      e.enrollment_id,
      e.class_id,
      p.period_id,
      p.period_code,
      ge.subject_id,
      subj.name as subject_name,
      ge.id as evaluation_id,
      coalesce(nullif(ge.scale, 0), 20)::numeric as scale,
      coalesce(nullif(ge.coeff, 0), 1)::numeric as coeff,
      case
        when m.mark_20 is not null then m.mark_20::numeric
        when m.raw_score is not null and coalesce(nullif(ge.scale, 0), 20) > 0 then (m.raw_score::numeric / coalesce(nullif(ge.scale, 0), 20)::numeric) * 20
        else null
      end as mark_20
    from enrollments e
    join public.grade_evaluations ge on ge.class_id = e.class_id
    join periods p
      on p.institution_id = e.institution_id
     and p.academic_year = e.academic_year
     and ge.eval_date::date between p.period_start and p.period_end
    join public.grade_flat_marks m on m.evaluation_id = ge.id and m.student_id = e.student_id
    left join public.subjects subj on subj.id = ge.subject_id
    where coalesce(ge.is_published, false) = true
      and ge.subject_id is not null
  ),
  subject_calc as (
    select
      institution_id,
      academic_year,
      student_id,
      student_person_id,
      enrollment_id,
      class_id,
      period_id,
      period_code,
      subject_id,
      max(subject_name) as subject_name,
      round((sum(mark_20 * coeff) / nullif(sum(coeff), 0))::numeric, 2) as avg_score_20,
      count(distinct evaluation_id)::integer as evaluations_count,
      count(mark_20)::integer as notes_count,
      round(sum(coeff)::numeric, 2) as coeff_sum
    from marks_base
    where mark_20 is not null
    group by institution_id, academic_year, student_id, student_person_id, enrollment_id, class_id, period_id, period_code, subject_id
  ),
  subject_ranked as (
    select
      sc.*,
      rank() over (partition by institution_id, academic_year, class_id, period_code, subject_id order by avg_score_20 desc nulls last)::integer as subject_rank
    from subject_calc sc
  ),
  upserted as (
    insert into public.student_subject_period_results (
      student_person_id, student_id, institution_id, academic_year, class_id, enrollment_id,
      period_id, period_code, subject_id, subject_name, avg_score_20, subject_rank,
      evaluations_count, notes_count, coeff_sum, status, source, computed_at, metadata_json
    )
    select
      student_person_id, student_id, institution_id, academic_year, class_id, enrollment_id,
      period_id, period_code, subject_id, subject_name, avg_score_20, subject_rank,
      evaluations_count, notes_count, coeff_sum, 'computed', 'auto_from_published_evaluations', now(),
      jsonb_build_object('v', 39, 'uses_manual_ai_actions', false)
    from subject_ranked
    on conflict (institution_id, student_id, academic_year, period_code, subject_id)
    do update set
      student_person_id = excluded.student_person_id,
      class_id = excluded.class_id,
      enrollment_id = excluded.enrollment_id,
      period_id = excluded.period_id,
      subject_name = excluded.subject_name,
      avg_score_20 = excluded.avg_score_20,
      subject_rank = excluded.subject_rank,
      evaluations_count = excluded.evaluations_count,
      notes_count = excluded.notes_count,
      coeff_sum = excluded.coeff_sum,
      status = excluded.status,
      source = excluded.source,
      computed_at = now(),
      metadata_json = excluded.metadata_json,
      updated_at = now()
    returning 1
  )
  select count(*) into v_subject_count from upserted;

  -- B) Résultats généraux par période.
  with periods as (
    select
      gp.id as period_id,
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
    where gp.institution_id = p_institution_id
      and gp.academic_year = p_academic_year
      and gp.start_date is not null
      and gp.end_date is not null
  ),
  enrollments as (
    select
      s.id as student_id,
      s.student_person_id,
      s.institution_id,
      ce.id as enrollment_id,
      ce.class_id,
      c.academic_year
    from public.class_enrollments ce
    join public.students s on s.id = ce.student_id
    join public.classes c on c.id = ce.class_id
    where s.institution_id = p_institution_id
      and c.academic_year = p_academic_year
      and (ce.end_date is null or ce.end_date >= current_date)
  ),
  class_sizes as (
    select e.institution_id, e.class_id, count(distinct e.student_id)::integer as class_size
    from enrollments e
    group by e.institution_id, e.class_id
  ),
  per_student_period as (
    select
      sspr.institution_id,
      sspr.academic_year,
      sspr.student_id,
      sspr.student_person_id,
      sspr.enrollment_id,
      sspr.class_id,
      sspr.period_id,
      sspr.period_code,
      count(distinct sspr.subject_id)::integer as subjects_evaluated_count,
      sum(sspr.evaluations_count)::integer as evaluations_count,
      sum(sspr.notes_count)::integer as notes_count,
      round(avg(sspr.avg_score_20)::numeric, 2) as general_avg_20,
      count(*) filter (where sspr.avg_score_20 < 10)::integer as subjects_under_10_count,
      count(*) filter (where sspr.avg_score_20 < 8)::integer as subjects_under_8_count
    from public.student_subject_period_results sspr
    where sspr.institution_id = p_institution_id
      and sspr.academic_year = p_academic_year
      and sspr.avg_score_20 is not null
    group by sspr.institution_id, sspr.academic_year, sspr.student_id, sspr.student_person_id, sspr.enrollment_id, sspr.class_id, sspr.period_id, sspr.period_code
  ),
  attendance as (
    select
      ts.institution_id,
      c.academic_year,
      p.period_id,
      p.period_code,
      ts.class_id,
      am.student_id,
      count(*) filter (where lower(coalesce(am.status::text, '')) in ('absent', 'absence'))::integer as absences_count,
      round(coalesce(sum(coalesce(am.hours_absent, 0)), 0)::numeric, 2) as total_absent_hours,
      count(*) filter (where coalesce(am.minutes_late, 0) > 0 or lower(coalesce(am.status::text, '')) in ('late', 'retard', 'retards'))::integer as lates_count,
      coalesce(sum(coalesce(am.minutes_late, 0)), 0)::integer as total_late_minutes
    from public.teacher_sessions ts
    join public.classes c on c.id = ts.class_id
    join periods p on p.institution_id = ts.institution_id and p.academic_year = c.academic_year and ts.started_at::date between p.period_start and p.period_end
    join public.attendance_marks am on am.session_id = ts.id
    group by ts.institution_id, c.academic_year, p.period_id, p.period_code, ts.class_id, am.student_id
  ),
  conduct as (
    select
      e.institution_id,
      e.academic_year,
      p.period_id,
      p.period_code,
      e.class_id,
      e.student_id,
      count(cp.id)::integer as conduct_penalties_count,
      round(coalesce(sum(coalesce(cp.points, 0)), 0)::numeric, 2) as conduct_penalty_points
    from enrollments e
    join periods p on p.institution_id = e.institution_id and p.academic_year = e.academic_year
    left join public.conduct_penalties cp on cp.student_id = e.student_id and cp.occurred_at::date between p.period_start and p.period_end
    group by e.institution_id, e.academic_year, p.period_id, p.period_code, e.class_id, e.student_id
  ),
  ranked as (
    select
      psp.*,
      p.period_label,
      p.period_start,
      p.period_end,
      p.period_order,
      cs.class_size,
      coalesce(a.absences_count, 0) as absences_count,
      coalesce(a.lates_count, 0) as lates_count,
      coalesce(a.total_absent_hours, 0) as total_absent_hours,
      coalesce(a.total_late_minutes, 0) as total_late_minutes,
      coalesce(cd.conduct_penalties_count, 0) as conduct_penalties_count,
      coalesce(cd.conduct_penalty_points, 0) as conduct_penalty_points,
      rank() over (partition by psp.institution_id, psp.academic_year, psp.class_id, psp.period_code order by psp.general_avg_20 desc nulls last)::integer as general_rank
    from per_student_period psp
    join periods p on p.period_id = psp.period_id
    left join class_sizes cs on cs.institution_id = psp.institution_id and cs.class_id = psp.class_id
    left join attendance a on a.institution_id = psp.institution_id and a.academic_year = psp.academic_year and a.period_code = psp.period_code and a.class_id = psp.class_id and a.student_id = psp.student_id
    left join conduct cd on cd.institution_id = psp.institution_id and cd.academic_year = psp.academic_year and cd.period_code = psp.period_code and cd.class_id = psp.class_id and cd.student_id = psp.student_id
  ),
  upserted as (
    insert into public.student_period_results (
      student_person_id, student_id, institution_id, academic_year, class_id, enrollment_id,
      period_id, period_code, period_label, period_start, period_end, period_order,
      class_size, general_avg_20, general_rank, evaluations_count, notes_count,
      subjects_evaluated_count, subjects_under_10_count, subjects_under_8_count,
      absences_count, lates_count, total_absent_hours, total_late_minutes,
      conduct_penalties_count, conduct_penalty_points, status, source, computed_at, metadata_json
    )
    select
      student_person_id, student_id, institution_id, academic_year, class_id, enrollment_id,
      period_id, period_code, period_label, period_start, period_end, period_order,
      class_size, general_avg_20, general_rank, evaluations_count, notes_count,
      subjects_evaluated_count, subjects_under_10_count, subjects_under_8_count,
      absences_count, lates_count, total_absent_hours, total_late_minutes,
      conduct_penalties_count, conduct_penalty_points, 'computed', 'auto_from_student_subject_period_results', now(),
      jsonb_build_object('v', 39, 'uses_manual_ai_actions', false)
    from ranked
    on conflict (institution_id, student_id, academic_year, period_code)
    do update set
      student_person_id = excluded.student_person_id,
      class_id = excluded.class_id,
      enrollment_id = excluded.enrollment_id,
      period_id = excluded.period_id,
      period_label = excluded.period_label,
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      period_order = excluded.period_order,
      class_size = excluded.class_size,
      general_avg_20 = excluded.general_avg_20,
      general_rank = excluded.general_rank,
      evaluations_count = excluded.evaluations_count,
      notes_count = excluded.notes_count,
      subjects_evaluated_count = excluded.subjects_evaluated_count,
      subjects_under_10_count = excluded.subjects_under_10_count,
      subjects_under_8_count = excluded.subjects_under_8_count,
      absences_count = excluded.absences_count,
      lates_count = excluded.lates_count,
      total_absent_hours = excluded.total_absent_hours,
      total_late_minutes = excluded.total_late_minutes,
      conduct_penalties_count = excluded.conduct_penalties_count,
      conduct_penalty_points = excluded.conduct_penalty_points,
      status = excluded.status,
      source = excluded.source,
      computed_at = now(),
      metadata_json = excluded.metadata_json,
      updated_at = now()
    returning 1
  )
  select count(*) into v_period_count from upserted;

  -- C) Décisions annuelles officielles persistées en base.
  with period_counts as (
    select institution_id, academic_year, count(*)::integer as periods_expected
    from public.grade_periods
    where institution_id = p_institution_id
      and academic_year = p_academic_year
      and start_date is not null
      and end_date is not null
    group by institution_id, academic_year
  ),
  annual as (
    select
      spr.institution_id,
      spr.academic_year,
      spr.student_id,
      max(spr.student_person_id) as student_person_id,
      (array_agg(spr.class_id order by spr.period_order desc nulls last))[1] as current_class_id,
      round(avg(spr.general_avg_20)::numeric, 2) as annual_avg_20,
      count(*) filter (where spr.general_avg_20 is not null)::integer as periods_covered,
      max(pc.periods_expected)::integer as periods_expected
    from public.student_period_results spr
    left join period_counts pc on pc.institution_id = spr.institution_id and pc.academic_year = spr.academic_year
    where spr.institution_id = p_institution_id
      and spr.academic_year = p_academic_year
    group by spr.institution_id, spr.academic_year, spr.student_id
  ),
  annual_ranked as (
    select
      a.*,
      c.label as class_label,
      c.code as class_code,
      c.level as class_level,
      c.official_track_code,
      s.is_affecte,
      s.is_repeater,
      rank() over (partition by a.institution_id, a.academic_year, a.current_class_id order by a.annual_avg_20 desc nulls last)::integer as annual_rank
    from annual a
    join public.students s on s.id = a.student_id
    left join public.classes c on c.id = a.current_class_id
  ),
  decisions_calc as (
    select
      ar.*,
      d.decision_type,
      d.decision_label,
      d.is_repeater_next_year,
      case
        when ar.annual_avg_20 is null then 'pending'
        when coalesce(ar.periods_expected, 0) > 0 and ar.periods_covered >= ar.periods_expected then 'complete'
        when ar.periods_covered > 0 then 'partial'
        else 'pending'
      end as annual_status
    from annual_ranked ar
    cross join lateral public.mon_cahier_ai_v39_decision_from_official_result(
      ar.annual_avg_20,
      ar.class_level,
      ar.class_label,
      ar.class_code,
      ar.official_track_code,
      ar.is_affecte,
      ar.is_repeater
    ) d
  ),
  upserted as (
    insert into public.student_year_decisions (
      student_person_id, student_id, institution_id, academic_year, current_class_id,
      decision_type, decision_label, is_repeater_next_year, decided_at,
      annual_avg_20, annual_rank, annual_status, periods_expected, periods_covered,
      computed_from_results_at, metadata_json, created_at, updated_at
    )
    select
      student_person_id, student_id, institution_id, academic_year, current_class_id,
      decision_type, decision_label, is_repeater_next_year,
      case when decision_type <> 'pending' then now() else null end,
      annual_avg_20, annual_rank, annual_status, periods_expected, periods_covered,
      now(),
      jsonb_build_object(
        'source', 'computed_from_official_period_results',
        'v', 39,
        'uses_manual_ai_actions', false,
        'note', 'Décision calculée automatiquement depuis les résultats officiels persistés.'
      ),
      now(), now()
    from decisions_calc
    on conflict (institution_id, student_id, academic_year)
    do update set
      student_person_id = excluded.student_person_id,
      current_class_id = excluded.current_class_id,
      decision_type = excluded.decision_type,
      decision_label = excluded.decision_label,
      is_repeater_next_year = excluded.is_repeater_next_year,
      decided_at = excluded.decided_at,
      annual_avg_20 = excluded.annual_avg_20,
      annual_rank = excluded.annual_rank,
      annual_status = excluded.annual_status,
      periods_expected = excluded.periods_expected,
      periods_covered = excluded.periods_covered,
      computed_from_results_at = now(),
      metadata_json = excluded.metadata_json,
      updated_at = now()
    where public.student_year_decisions.decided_by is null
      and coalesce(public.student_year_decisions.metadata_json->>'source', '') <> 'manual'
    returning 1
  )
  select count(*) into v_decision_count from upserted;

  return query select v_period_count, v_subject_count, v_decision_count;
end;
$$;

comment on function public.mon_cahier_rebuild_official_student_results(uuid, text) is
  'Reconstruit et persiste les résultats officiels T1/T2/T3 et les décisions annuelles depuis les données scolaires existantes, sans charge admin et sans utiliser les actions IA proposées.';

commit;
