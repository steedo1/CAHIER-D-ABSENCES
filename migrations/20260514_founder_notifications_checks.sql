-- Mon Cahier — Vérifications non destructives pour notifications fondateur
-- Ce script ne modifie aucune donnée. Il sert seulement à vérifier que la base est prête.

SELECT enumlabel
FROM pg_enum
WHERE enumtypid = 'public.user_role'::regtype
ORDER BY enumsortorder;

SELECT
  conname,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.user_roles'::regclass
  AND conname ILIKE '%role%';

SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'notifications_queue'
  AND column_name = 'profile_id';

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_notifications_queue_profile_pending',
    'idx_user_roles_founder_institution',
    'idx_user_roles_finance_manager_institution'
  )
ORDER BY indexname;
