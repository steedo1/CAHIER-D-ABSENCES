# Phase 4E — Correction génération reçu paiement en ligne

## Objet

Correction ciblée du service de génération de reçu après confirmation d’un paiement en ligne.

## Problème constaté

La confirmation passait correctement, mais la génération du reçu échouait avec :

```text
column v_charge_balances.academic_year does not exist
```

## Correction

Le service ne lit plus `academic_year` depuis `finance.v_charge_balances`.
L’année scolaire est récupérée depuis la classe liée au paiement, comme dans le flux d’encaissement physique.

## Résultat attendu

- cliquer sur `Générer le reçu` pour une intention `Confirmé sans reçu` doit créer le reçu ;
- le reçu doit apparaître dans la finance ;
- le reste dû doit diminuer ;
- l’intention doit devenir confirmée avec reçu ;
- aucun doublon ne doit être créé si l’action est rejouée.

Redeploy check: phase 4E active.
