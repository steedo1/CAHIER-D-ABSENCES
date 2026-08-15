begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.classes
  add column if not exists class_login_identifier text,
  add column if not exists class_login_identifier_key text generated always as (
    lower(regexp_replace(btrim(class_login_identifier), '[[:space:]]+', ' ', 'g'))
  ) stored,
  add column if not exists class_device_auth_user_id uuid;

comment on column public.classes.class_login_identifier is
  'Identifiant stable saisi par l''etablissement pour connecter l''appareil de classe. Ce n''est pas necessairement un numero de telephone.';
comment on column public.classes.class_login_identifier_key is
  'Cle normalisee generee pour l''unicite institutionnelle de class_login_identifier; la valeur affichee reste inchangee.';
comment on column public.classes.class_device_auth_user_id is
  'Lien canonique vers le compte Supabase Auth du terminal de classe; remplace progressivement la correspondance historique par telephone.';
comment on column public.classes.device_phone_e164 is
  'Telephone ou SIM facultatif de l''appareil de classe, distinct de son identifiant de connexion.';
comment on column public.classes.class_phone_e164 is
  'Identite telephonique historique des comptes-classe. Conservee uniquement pour compatibilite progressive.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.classes'::regclass
      and conname = 'classes_class_login_identifier_chk'
  ) then
    alter table public.classes
      add constraint classes_class_login_identifier_chk
      check (
        class_login_identifier is null
        or (
          char_length(btrim(class_login_identifier)) between 1 and 128
          and class_login_identifier !~ '[[:cntrl:]]'
        )
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.classes'::regclass
      and conname = 'classes_class_device_auth_user_id_fkey'
  ) then
    alter table public.classes
      add constraint classes_class_device_auth_user_id_fkey
      foreign key (class_device_auth_user_id)
      references auth.users(id)
      on delete set null
      not valid;
  end if;
end
$$;

-- Compatibilité progressive : l'ancien identifiant est recopié tel quel.
-- Aucune normalisation téléphonique ni suppression de zéro.
update public.classes
set class_login_identifier = class_phone_e164
where class_login_identifier is null
  and class_phone_e164 is not null;

-- Le lien Auth legacy n'est backfillé que si le compte possède déjà le rôle
-- class_device DANS LE MÊME ÉTABLISSEMENT. Les cas ambigus restent NULL.
update public.classes as c
set class_device_auth_user_id = u.id
from auth.users as u
join public.user_roles as ur
  on ur.profile_id = u.id
 and ur.role = 'class_device'
where c.class_device_auth_user_id is null
  and c.class_phone_e164 is not null
  and u.phone = c.class_phone_e164
  and ur.institution_id = c.institution_id;

create unique index if not exists classes_institution_login_identifier_key_uq
  on public.classes (institution_id, class_login_identifier_key)
  where class_login_identifier_key is not null;

-- Un compte Auth canonique de terminal ne doit jamais ouvrir plusieurs classes.
create unique index if not exists classes_class_device_auth_user_id_uq
  on public.classes (class_device_auth_user_id)
  where class_device_auth_user_id is not null;

alter table public.classes
  validate constraint classes_class_login_identifier_chk;

alter table public.classes
  validate constraint classes_class_device_auth_user_id_fkey;

commit;
