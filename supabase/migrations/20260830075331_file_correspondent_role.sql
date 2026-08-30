-- Profil établissement dédié au Correspondant fichier.
-- Le rôle reste distinct de admin afin de ne jamais hériter implicitement
-- des droits ou de la navigation complète de l'administration.

alter type public.user_role
  add value if not exists 'file_correspondent';

-- La contrainte historique énumère explicitement les rôles autorisés.
-- Comparaison en texte pour pouvoir déclarer la contrainte dans la même
-- migration que l'ajout de la nouvelle valeur enum.
alter table public.user_roles
  drop constraint if exists user_roles_role_check;

alter table public.user_roles
  add constraint user_roles_role_check
  check (
    role::text = any (
      array[
        'super_admin',
        'admin',
        'educator',
        'teacher',
        'parent',
        'student',
        'class_device',
        'drenaet_admin',
        'founder',
        'finance_manager',
        'infirmier',
        'file_correspondent'
      ]::text[]
    )
  );
