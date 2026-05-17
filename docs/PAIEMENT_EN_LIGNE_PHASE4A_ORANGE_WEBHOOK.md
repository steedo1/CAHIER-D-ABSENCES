# Mon Cahier — Paiement en ligne — Phase 4A

## Objectif

Préparer proprement la réception des confirmations Orange Money, sans encore imposer la configuration Orange Developer.

Cette phase ajoute :

- l’URL technique `/api/payments/webhooks/orange_money` ;
- l’alias `/api/payments/webhooks/orange` ;
- la recherche sécurisée de l’intention par `intent_id`, `client_reference` ou référence opérateur ;
- la confirmation automatique du paiement uniquement si Orange renvoie un statut de succès ;
- la création du reçu officiel via le service finance déjà mis en place ;
- l’échec ou l’annulation automatique si l’opérateur renvoie un statut négatif ;
- aucun bouton admin et aucune validation manuelle.

## Règle métier conservée

Nexa Digital SARL n’encaisse pas les frais scolaires.
Chaque établissement encaisse directement via son propre compte marchand Mobile Money.
Mon Cahier déclenche, suit, reçoit la confirmation, crée le reçu et conserve l’historique.

## URLs à garder

Webhook Orange Money :

```txt
https://www.mon-cahier.com/api/payments/webhooks/orange_money
```

Alias compatible :

```txt
https://www.mon-cahier.com/api/payments/webhooks/orange
```

Retour parent :

```txt
https://www.mon-cahier.com/parents/payments
```

## Important

Cette phase ne branche pas encore l’appel réel Orange Money.
Elle prépare seulement la route qui recevra la confirmation Orange quand l’intégration réelle sera activée.

Le reçu officiel n’est créé que si la notification reçue indique un paiement réussi.
