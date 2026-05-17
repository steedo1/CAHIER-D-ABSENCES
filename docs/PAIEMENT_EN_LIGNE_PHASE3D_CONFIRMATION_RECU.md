# Paiement en ligne — Phase 3D

Objectif : préparer la confirmation opérateur sans encombrer l’admin.

## Règle produit

- Le parent initie le paiement.
- L’opérateur Mobile Money confirme le paiement.
- Mon Cahier crée automatiquement le reçu officiel après confirmation.
- L’admin consulte seulement l’historique.
- Aucun bouton admin de validation, d’annulation ou d’expiration manuelle.
- Nexa Digital SARL n’encaisse pas les frais scolaires.

## Ce qui est ajouté

1. Sécurisation anti-doublon des reçus issus du paiement en ligne.
2. Service de confirmation idempotent : si le webhook arrive deux fois, il ne doit pas créer deux reçus.
3. Route technique de test `/api/payments/webhooks/internal-test` désactivée par défaut.
4. Le parent voit le numéro du reçu quand le paiement est confirmé.

## SQL à exécuter

Exécuter :

`migrations/20260517_online_payment_receipt_idempotency.sql`

Cette migration ajoute un index unique partiel sur les références de reçu `ONLINE-*`.

## Route technique de test

La route `/api/payments/webhooks/internal-test` sert seulement à simuler une confirmation opérateur avant Orange réel.

Elle est désactivée par défaut.

Pour l’activer temporairement en environnement de test :

```env
ONLINE_PAYMENTS_INTERNAL_TEST_CONFIRM_ENABLED=1
ONLINE_PAYMENTS_INTERNAL_TEST_SECRET=un-secret-temporaire
```

Puis appeler en POST :

```json
{
  "intent_id": "UUID_DE_L_INTENTION"
}
```

Avec l’en-tête :

```text
x-mon-cahier-payment-test-secret: un-secret-temporaire
```

## Important

Cette route ne doit pas être utilisée comme validation manuelle par l’administration. Elle sert uniquement au test technique avant branchement Orange Money réel.
