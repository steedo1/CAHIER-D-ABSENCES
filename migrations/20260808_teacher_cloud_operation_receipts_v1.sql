-- Mon Cahier — reçus idempotents des écritures Cloud directes du professeur.
-- Permet de réconcilier une réponse réseau perdue sans renvoyer aveuglément l'appel.

CREATE TABLE IF NOT EXISTS public.teacher_cloud_operation_receipts (
  operation_id text PRIMARY KEY,
  institution_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  operation_type text NOT NULL CHECK (operation_type IN ('teacher_attendance.bulk')),
  session_id uuid REFERENCES public.teacher_sessions(id) ON DELETE SET NULL,
  payload_fingerprint text NOT NULL CHECK (char_length(payload_fingerprint) = 64),
  state text NOT NULL DEFAULT 'processing'
    CHECK (state IN ('processing', 'retryable', 'acknowledged', 'blocked', 'conflict')),
  error_code text,
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS teacher_cloud_operation_receipts_actor_time_idx
  ON public.teacher_cloud_operation_receipts(actor_user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS teacher_cloud_operation_receipts_institution_state_idx
  ON public.teacher_cloud_operation_receipts(institution_id, state, updated_at DESC);

ALTER TABLE public.teacher_cloud_operation_receipts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.teacher_cloud_operation_receipts IS
  'Reçus idempotents des écritures Cloud directes du professeur, interrogés avant toute reprise après réponse réseau perdue.';
