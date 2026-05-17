# Phase 4B — Sécurisation du webhook Orange Money

Objectif : empêcher toute confirmation de paiement sans preuve technique.

## Règle appliquée

Une notification Orange Money ne peut confirmer un paiement que si le compte marchand de l’établissement possède un secret webhook configuré, ou si un secret global serveur est défini.

Le webhook accepte :

- un secret exact dans un header sécurisé ;
- un secret exact dans le paramètre `secret` de l’URL de notification ;
- une signature HMAC SHA-256 du corps brut, si l’opérateur fournit ce mécanisme.

## Champs possibles côté compte établissement

Dans `secret_config`, on peut utiliser l’un de ces noms :

- `webhook_secret`
- `orange_webhook_secret`
- `webpay_webhook_secret`

En secours serveur, on peut utiliser :

```env
ORANGE_MONEY_WEBPAY_WEBHOOK_SECRET=secret-long-et-aleatoire
```

## Sécurité

- Aucun reçu officiel n’est créé sans secret/signature valide.
- Un webhook sans référence connue est refusé.
- Un webhook avec référence connue mais sans secret configuré est refusé.
- L’admin ne valide rien manuellement.
- Le parent ne reçoit un reçu qu’après confirmation technique authentifiée.

## Test attendu

1. Créer une intention de paiement Orange Money côté parent.
2. Appeler le webhook sans secret avec l’`intent_id` : réponse attendue `403`.
3. Configurer un `webhook_secret` dans le compte marchand.
4. Appeler le webhook avec `secret=<valeur>` et `status=success` : le paiement peut être confirmé et le reçu généré.

## Important

Avant Orange Developer, cette étape vérifie seulement que la porte d’entrée des confirmations opérateur est sécurisée.
