-- LOT 4A — le client serveur Supabase utilise le rôle service_role pour
-- enrichir les snapshots et lire les versions courantes.
-- Les écritures restent réservées aux triggers / RPC SECURITY DEFINER.

GRANT SELECT ON TABLE public.relay_entity_versions TO service_role;
GRANT SELECT ON TABLE public.relay_entity_history TO service_role;
