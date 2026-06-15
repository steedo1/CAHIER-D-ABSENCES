# Nettoyage notes techniques budget dépenses CSCA

Ce patch ajoute un script SQL de nettoyage pour retirer de l'interface les notes techniques issues de l'import automatique :

- Import photo CSCA 2026-2027
- source: Page 1 / Suite
- clé: csca-2026-2027-...
- annotations manuscrites de vérification

Le script ne modifie pas les comptes, libellés, montants, dépenses ou rattachements. Il met seulement `notes = NULL` sur les postes budgétaires CSCA 2026-2027 importés.

## À exécuter dans Supabase SQL Editor

```sql
sql/clean_csca_expense_budget_notes_2026_2027.sql
```

## Après exécution

Rafraîchir la page :

Admin > Finance > Dépenses

Les textes techniques ne doivent plus apparaître.
