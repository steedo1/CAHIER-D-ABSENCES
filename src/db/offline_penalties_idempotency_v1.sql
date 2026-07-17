-- Mon Cahier — Lot 0 hors ligne
-- Empêche qu'un même lot de sanctions soit créé deux fois lorsque la réponse
-- réseau est coupée après l'enregistrement serveur puis rejouée par l'appareil.

begin;

alter table public.conduct_penalties
  add column if not exists client_action_id text;

comment on column public.conduct_penalties.client_action_id is
  'Identifiant stable de l''opération cliente utilisé pour la déduplication hors ligne.';

create unique index if not exists conduct_penalties_client_action_student_uidx
  on public.conduct_penalties (client_action_id, student_id);

commit;

notify pgrst, 'reload schema';
