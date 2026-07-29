-- Mon Cahier — Lot 1A du mode hors ligne
-- Authentification dédiée des relais et reçus idempotents des opérations locales.

CREATE TABLE IF NOT EXISTS public.relay_sync_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Relais principal',
  token_hash text NOT NULL UNIQUE CHECK (char_length(token_hash) = 64),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, id)
);

CREATE INDEX IF NOT EXISTS relay_sync_devices_institution_active_idx
  ON public.relay_sync_devices(institution_id, is_active, revoked_at);

CREATE TABLE IF NOT EXISTS public.relay_sync_operation_receipts (
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  operation_id text NOT NULL,
  device_id uuid NOT NULL REFERENCES public.relay_sync_devices(id) ON DELETE RESTRICT,
  payload_fingerprint text NOT NULL CHECK (char_length(payload_fingerprint) = 64),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  state text NOT NULL DEFAULT 'processing'
    CHECK (state IN ('processing', 'retryable', 'acknowledged', 'blocked', 'conflict')),
  error_code text,
  cloud_entity_id text,
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (institution_id, operation_id)
);

CREATE INDEX IF NOT EXISTS relay_sync_operation_receipts_device_time_idx
  ON public.relay_sync_operation_receipts(device_id, received_at DESC);

CREATE INDEX IF NOT EXISTS relay_sync_operation_receipts_state_idx
  ON public.relay_sync_operation_receipts(institution_id, state, updated_at DESC);

ALTER TABLE public.relay_sync_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.relay_sync_operation_receipts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.relay_sync_devices IS
  'Identités révocables des PC relais Mon Cahier. Le jeton brut n’est jamais stocké.';
COMMENT ON TABLE public.relay_sync_operation_receipts IS
  'Journal idempotent Cloud des opérations produites hors ligne par les relais.';
