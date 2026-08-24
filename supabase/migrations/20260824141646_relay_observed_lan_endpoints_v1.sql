-- Mon Cahier — endpoints LAN observés et publiés automatiquement par le relais.
-- La colonne appartient à l'identité Cloud déjà authentifiée du PC relais.

ALTER TABLE public.relay_sync_devices
  ADD COLUMN IF NOT EXISTS observed_lan_urls text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS observed_lan_at timestamptz;

ALTER TABLE public.relay_sync_devices
  DROP CONSTRAINT IF EXISTS relay_sync_devices_observed_lan_urls_limit;

ALTER TABLE public.relay_sync_devices
  ADD CONSTRAINT relay_sync_devices_observed_lan_urls_limit
  CHECK (cardinality(observed_lan_urls) <= 8);

COMMENT ON COLUMN public.relay_sync_devices.observed_lan_urls IS
  'Endpoints HTTP LAN auto-déclarés par ce relais authentifié (.local puis IPv4 privées).';
COMMENT ON COLUMN public.relay_sync_devices.observed_lan_at IS
  'Dernière publication réussie des endpoints LAN par ce relais.';

-- La table est déjà protégée par RLS. Ces métadonnées restent réservées au
-- service Cloud : les clients professeur/classe les reçoivent seulement via
-- leurs routes métier authentifiées et sans accès direct Data API.
REVOKE ALL ON TABLE public.relay_sync_devices FROM anon, authenticated;
