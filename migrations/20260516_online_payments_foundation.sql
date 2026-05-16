-- Mon Cahier - Paiement en ligne Mobile Money
-- Étape 1 : fondation sécurisée sans modifier le paiement physique existant.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS finance;

CREATE TABLE IF NOT EXISTS finance.institution_payment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  provider text NOT NULL,
  display_name text,
  merchant_id text,
  merchant_phone text,
  environment text NOT NULL DEFAULT 'test',
  is_active boolean NOT NULL DEFAULT false,
  public_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT institution_payment_accounts_provider_chk
    CHECK (provider IN ('orange_money', 'wave', 'mtn_momo', 'mock')),
  CONSTRAINT institution_payment_accounts_environment_chk
    CHECK (environment IN ('test', 'production')),
  CONSTRAINT institution_payment_accounts_unique
    UNIQUE (school_id, provider, environment)
);

CREATE INDEX IF NOT EXISTS idx_institution_payment_accounts_school_active
  ON finance.institution_payment_accounts (school_id, is_active);

CREATE TABLE IF NOT EXISTS finance.online_payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  student_charge_id uuid NOT NULL REFERENCES finance.student_charges(id) ON DELETE RESTRICT,
  account_id uuid REFERENCES finance.institution_payment_accounts(id) ON DELETE SET NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'XOF',
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'initiated',
  payer_name text,
  payer_phone text,
  client_reference text NOT NULL DEFAULT ('MC-' || replace(gen_random_uuid()::text, '-', '')),
  provider_reference text,
  provider_transaction_id text,
  checkout_url text,
  receipt_id uuid REFERENCES finance.receipts(id) ON DELETE SET NULL,
  error_message text,
  raw_provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  confirmed_at timestamptz,
  failed_at timestamptz,
  CONSTRAINT online_payment_intents_provider_chk
    CHECK (provider IN ('orange_money', 'wave', 'mtn_momo', 'mock')),
  CONSTRAINT online_payment_intents_status_chk
    CHECK (status IN ('initiated', 'pending', 'succeeded', 'failed', 'cancelled', 'expired')),
  CONSTRAINT online_payment_intents_client_reference_unique UNIQUE (client_reference)
);

CREATE INDEX IF NOT EXISTS idx_online_payment_intents_school_created
  ON finance.online_payment_intents (school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_online_payment_intents_student_created
  ON finance.online_payment_intents (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_online_payment_intents_status
  ON finance.online_payment_intents (status);

CREATE UNIQUE INDEX IF NOT EXISTS online_payment_intents_provider_reference_unique
  ON finance.online_payment_intents (provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS online_payment_intents_provider_transaction_unique
  ON finance.online_payment_intents (provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS online_payment_intents_receipt_unique
  ON finance.online_payment_intents (receipt_id)
  WHERE receipt_id IS NOT NULL;

COMMIT;
