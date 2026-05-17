# Paiement en ligne — Phase 3A

## Décision métier

Le nom affiché aux parents n'est pas libre.

Mon Cahier impose le nom officiel du moyen de paiement afin d'éviter toute confusion :

- Orange Money
- Wave
- MTN Mobile Money

L'établissement configure uniquement les informations de son compte marchand :

- activation pour les parents ;
- environnement test ou production ;
- code marchand / identifiant opérateur si fourni ;
- numéro marchand si fourni ;
- clés techniques API uniquement si l'opérateur les fournit.

## Règle stratégique

Nexa Digital SARL ne reçoit pas les frais scolaires.
Chaque établissement encaisse directement sur son propre compte marchand Mobile Money.
Mon Cahier assure seulement le déclenchement, le suivi, la réconciliation, le reçu et les notifications.
