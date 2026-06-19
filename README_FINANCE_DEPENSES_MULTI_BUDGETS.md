# Mon Cahier — Finance Dépenses : plusieurs budgets

## Objectif

Ce patch ajoute la notion de **budget / enveloppe budgétaire** au-dessus des postes budgétaires.

Une école peut maintenant avoir :

- un seul budget général ;
- plusieurs budgets : Budget École, Budget Internat, Cantine, Travaux, Projet, etc. ;
- des dépenses libres sans budget si elle n'a pas encore formalisé son budget.

La vue **Budget global** additionne automatiquement tous les budgets actifs de l'année scolaire.

## Fichiers modifiés/ajoutés

- `src/app/admin/finance/expenses/page.tsx`
- `sql/finance_expense_budgets_v2_multi_envelopes.sql`
- `src/db/finance_expense_budgets_v2_multi_envelopes.sql`

## SQL à exécuter

Dans Supabase SQL Editor, exécuter :

```sql
sql/finance_expense_budgets_v2_multi_envelopes.sql
```

Le script est idempotent : il ne supprime aucune donnée.

## Migration des données existantes

Les anciens postes budgétaires sans budget sont rattachés automatiquement à un budget.

Pour le CSCA / 2026-2027, les 72 postes existants sont rattachés à :

```text
Budget École
```

Quand un futur budget internat sera importé, il faudra créer/réutiliser une enveloppe :

```text
Budget Internat
```

puis rattacher les nouveaux postes à ce budget.

## Test attendu

Après SQL + patch :

- Finance > Dépenses affiche une section **Budgets de dépenses**.
- Le CSCA 2026-2027 affiche **Budget École** avec les postes existants.
- On peut créer un nouveau budget, par exemple **Budget Internat**.
- Un nouveau poste budgétaire doit choisir un budget.
- Une dépense peut être :
  - hors budget ;
  - rattachée à un budget sans poste précis ;
  - rattachée à un poste, qui reprend automatiquement son budget.
