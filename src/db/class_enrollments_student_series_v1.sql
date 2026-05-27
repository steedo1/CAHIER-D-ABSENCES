-- Mon Cahier — classes communes A1/A2 : série officielle par élève inscrit
-- À exécuter une seule fois dans Supabase SQL Editor avant d'utiliser la colonne "Série" sur la liste de classe.

begin;

alter table public.class_enrollments
  add column if not exists official_track_code text null;

alter table public.class_enrollments
  drop constraint if exists class_enrollments_official_track_code_chk;

alter table public.class_enrollments
  add constraint class_enrollments_official_track_code_chk
  check (
    official_track_code is null
    or official_track_code in (
      '6eme', '5eme', '4eme', '3eme',
      '2ndeA', '2ndeC',
      '1ereA1', '1ereA2', '1ereC', '1ereD',
      'tleA1', 'tleA2', 'tleC', 'tleD'
    )
  );

comment on column public.class_enrollments.official_track_code is
  'Série officielle de l’élève pour cette inscription annuelle. Utile quand une même classe physique/liste regroupe A1 et A2.';

create index if not exists idx_class_enrollments_official_track_code
  on public.class_enrollments (official_track_code)
  where official_track_code is not null;

commit;
