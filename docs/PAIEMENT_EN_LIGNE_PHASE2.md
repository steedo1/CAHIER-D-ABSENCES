# Mon Cahier — Paiement en ligne Phase 2

Objectif : permettre à chaque établissement de configurer ses propres comptes Mobile Money, sans que Nexa Digital SARL encaisse les frais scolaires.

## Modèle retenu

- Chaque établissement encaisse directement son argent.
- Mon Cahier ne reçoit pas les fonds.
- Mon Cahier fournit uniquement la plateforme technique : choix du frais, intention de paiement, confirmation fournisseur, reçu officiel, historique et notifications.

## Fichiers ajoutés

- `src/app/admin/finance/online-payments/page.tsx`
- `src/app/api/admin/finance/online-payment-accounts/route.ts`

## Fichier modifié

- `src/app/admin/finance/page.tsx`

Ajout d’une carte “Paiement en ligne” dans le tableau de bord Finance.

## Page ajoutée

- `/admin/finance/online-payments`

Cette page permet à l’établissement de configurer :

- Orange Money
- Wave Business
- MTN Mobile Money

Champs disponibles :

- activation du moyen de paiement ;
- environnement test ou production ;
- nom affiché aux parents ;
- identifiant marchand ;
- numéro marchand ;
- clés techniques API si l’opérateur les fournit.

Les clés API sont enregistrées côté serveur dans `finance.institution_payment_accounts.secret_config` et ne sont pas renvoyées au navigateur.

## Important

Cette phase configure les comptes par établissement. Le branchement réel Orange/Wave/MTN côté fournisseur sera fait ensuite, avec les identifiants officiels remis par chaque opérateur.
