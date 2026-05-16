# Paiement en ligne Mobile Money - Mon Cahier

## Ce correctif ajoute

- `finance.institution_payment_accounts` : configuration Mobile Money par établissement.
- `finance.online_payment_intents` : intention de paiement avant confirmation du fournisseur.
- Page parent : `/parents/payments`.
- APIs parent : options, initiation, statut.
- Service serveur commun pour créer le reçu officiel après confirmation.
- Webhook mock de test désactivé par défaut.

## Règle importante

Un reçu officiel n'est créé qu'après confirmation du fournisseur Mobile Money.
Un clic sur “Payer maintenant” crée seulement une intention de paiement.

## Activation test interne facultative

Après exécution de la migration, pour tester sans vrai opérateur, remplacer `<SCHOOL_ID>` par l'id de l'établissement :

```sql
INSERT INTO finance.institution_payment_accounts (
  school_id,
  provider,
  display_name,
  environment,
  is_active
)
VALUES (
  '<SCHOOL_ID>'::uuid,
  'mock',
  'Test interne Mobile Money',
  'test',
  true
)
ON CONFLICT (school_id, provider, environment)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  is_active = true,
  updated_at = now();
```

Le webhook mock nécessite aussi `ONLINE_PAYMENTS_MOCK_ENABLED=1`.
