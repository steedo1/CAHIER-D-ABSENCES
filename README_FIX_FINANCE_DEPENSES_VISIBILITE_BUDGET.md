# Fix visibilité budget dépenses

Ce patch corrige l’affichage des postes budgétaires de dépenses dans Admin > Finance > Dépenses.

Cause probable : les lignes existent bien en base, mais la lecture de la nouvelle table finance.expense_budget_lines via le client Supabase session peut être bloquée par les règles/politiques RLS ou permissions.

Correction : après vérification de l’accès finance, la page utilise le client service role côté serveur pour lire les catégories, postes budgétaires et dépenses. Les actions d’écriture utilisaient déjà le client service role.

Fichier modifié :
- src/app/admin/finance/expenses/page.tsx
