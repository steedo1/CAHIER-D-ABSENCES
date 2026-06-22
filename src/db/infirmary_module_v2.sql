-- =========================================================
-- Mon Cahier - Module Infirmerie V2
-- Ajoute le constat de sante et le repos/conge eventuel sur les billets d'infirmerie.
-- A executer une seule fois dans Supabase SQL Editor.
-- =========================================================

begin;

alter table public.infirmary_visits
  add column if not exists condition_description text,
  add column if not exists rest_start_date date,
  add column if not exists rest_end_date date,
  add column if not exists rest_days integer;

comment on column public.infirmary_visits.condition_description is
  'Ce dont souffre l''enfant ou constat utile saisi sur le billet d''infirmerie.';

comment on column public.infirmary_visits.rest_start_date is
  'Date de debut du repos ou conge accorde, si applicable.';

comment on column public.infirmary_visits.rest_end_date is
  'Date de fin du repos ou conge accorde, si applicable.';

comment on column public.infirmary_visits.rest_days is
  'Nombre de jours de repos ou conge calcule inclusivement entre debut et fin.';

commit;
