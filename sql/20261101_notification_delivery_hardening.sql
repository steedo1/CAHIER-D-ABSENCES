-- Mon Cahier: atomically claim due notifications without polling 400 rows per channel.
-- Only the server-side service_role can execute this RPC. Historical records are not replayed.
ALTER TYPE public.notification_status ADD VALUE IF NOT EXISTS 'skipped';

CREATE OR REPLACE FUNCTION public.claim_notification_dispatch_batch(
  p_channel text,
  p_limit integer DEFAULT 25,
  p_lease_seconds integer DEFAULT 300
)
RETURNS SETOF public.notifications_queue
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH due AS MATERIALIZED (
    SELECT q.id
    FROM public.notifications_queue AS q
    WHERE q.status = 'pending'::public.notification_status
      AND q.channels ? p_channel
      AND COALESCE(q.send_after, q.created_at) <= now()
      AND p_channel IN ('push', 'sms')
    ORDER BY COALESCE(q.send_after, q.created_at), q.created_at
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 50)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notifications_queue AS q
  SET send_after = now() + make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 300), 60), 900))
  FROM due
  WHERE q.id = due.id
  RETURNING q.*;
$$;

REVOKE ALL ON FUNCTION public.claim_notification_dispatch_batch(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_dispatch_batch(text, integer, integer) TO service_role;

-- One SMS request per queue item and phone, even when two workers overlap or Render restarts.
-- Unknown outcomes must be reviewed: never resend a possibly charged SMS automatically.
CREATE TABLE IF NOT EXISTS public.notification_sms_attempts (
  queue_id uuid NOT NULL REFERENCES public.notifications_queue(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  state text NOT NULL DEFAULT 'attempting'
    CHECK (state IN ('attempting', 'accepted', 'unknown')),
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  orange_resource_id text,
  last_error text,
  PRIMARY KEY (queue_id, phone_e164)
);
ALTER TABLE public.notification_sms_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notification_sms_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.notification_sms_attempts TO service_role;

COMMENT ON TABLE public.notification_sms_attempts IS 'SMS anti-doublon: un destinataire et un evenement, pas de renvoi automatique apres issue incertaine.';
