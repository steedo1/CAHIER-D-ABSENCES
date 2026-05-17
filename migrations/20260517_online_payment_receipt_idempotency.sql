-- Mon Cahier - Paiement en ligne
-- Phase 3D : sécurisation anti-doublon des reçus créés depuis une intention en ligne.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS receipts_online_payment_reference_unique
  ON finance.receipts (school_id, reference_no)
  WHERE reference_no IS NOT NULL AND reference_no LIKE 'ONLINE-%';

COMMIT;
