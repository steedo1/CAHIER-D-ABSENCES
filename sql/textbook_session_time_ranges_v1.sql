-- =========================================================
-- Mon Cahier - Cahier de texte : plages horaires des séances
-- Objectif : remplacer la saisie libre de durée par une plage horaire
-- harmonisée (créneau établissement ou plage personnalisée).
-- Script idempotent : ne supprime aucune donnée existante.
-- =========================================================

begin;

alter table public.textbook_lesson_sessions
  add column if not exists session_period_id uuid;

alter table public.textbook_lesson_sessions
  add column if not exists session_period_label text;

alter table public.textbook_lesson_sessions
  add column if not exists session_start_time time;

alter table public.textbook_lesson_sessions
  add column if not exists session_end_time time;

create index if not exists idx_textbook_sessions_time_range
  on public.textbook_lesson_sessions (institution_id, session_date, session_start_time, session_end_time);

comment on column public.textbook_lesson_sessions.session_period_id is
  'Créneau horaire choisi depuis les plages de l’établissement, si disponible.';

comment on column public.textbook_lesson_sessions.session_period_label is
  'Libellé lisible du créneau choisi ou mention Plage personnalisée.';

comment on column public.textbook_lesson_sessions.session_start_time is
  'Heure de début réelle de la séance renseignée dans le cahier de texte.';

comment on column public.textbook_lesson_sessions.session_end_time is
  'Heure de fin réelle de la séance renseignée dans le cahier de texte.';

commit;

select
  'textbook_session_time_ranges_v1_ok' as check_name,
  count(*) as seances_existantes
from public.textbook_lesson_sessions;
