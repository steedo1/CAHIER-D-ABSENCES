# Import budget dépenses CSCA 2026-2027

Ce patch ajoute un script SQL d'import automatique des postes budgétaires de dépenses CSCA dans l'année scolaire **2026-2027**.

## Ordre d'exécution

1. Exécuter d'abord :

```sql
sql/finance_expense_budgets_v1.sql
```

2. Exécuter ensuite :

```sql
sql/seed_csca_expense_budget_2026_2027.sql
```

## Notes importantes

- Le script cible automatiquement l'établissement CSCA via `code_unique = 'csca'`, un nom contenant `CSCA`, ou un nom contenant `Catholique` et `Aboisso`.
- L'année scolaire utilisée dans Mon Cahier est **2026-2027**.
- Les montants imprimés sont importés comme montants budgétaires.
- Les corrections manuscrites visibles sont conservées dans `notes` pour vérification.
- Le script est idempotent : tu peux le relancer sans créer de doublons pour les lignes déjà importées par ce script.
- Ne pas exécuter l'ancien script `seed_csca_expense_budget_2025_2026.sql` pour ce besoin.


Note v2 : le script exige strictement l'année scolaire 2026-2027 et ne bascule plus vers 2025-2026.
