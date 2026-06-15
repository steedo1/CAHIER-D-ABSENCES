# Patch — Modification des montants Dépenses & Budget

Ce patch ajoute la possibilité de corriger les montants après création dans le module Finance > Dépenses :

- modification du montant prévu d'un poste budgétaire ;
- modification du montant d'une dépense déjà enregistrée ;
- recalcul automatique du consommé, disponible, dépassement et des totaux après mise à jour.

Aucune migration SQL n'est nécessaire si les tables `finance.expense_budget_lines` et `finance.expenses` possèdent déjà les colonnes `planned_amount`, `amount` et `updated_at`.

## Application rapide

```powershell
cd C:\Projects\CAHIER-D-ABSENCES

Remove-Item -Recurse -Force "$env:TEMP\mc_patch_finance_depenses_edit_amounts" -ErrorAction SilentlyContinue
Expand-Archive -Force "$env:USERPROFILE\Downloads\fix_finance_depenses_edit_amounts_patch.zip" "$env:TEMP\mc_patch_finance_depenses_edit_amounts"

Copy-Item -Recurse -Force "$env:TEMP\mc_patch_finance_depenses_edit_amounts\src\*" ".\src\"
Copy-Item -Force "$env:TEMP\mc_patch_finance_depenses_edit_amounts\README_FIX_FINANCE_DEPENSES_MODIFICATION_MONTANTS.md" ".\README_FIX_FINANCE_DEPENSES_MODIFICATION_MONTANTS.md"

git diff -- src/app/admin/finance/expenses/page.tsx
npm run build
```

## Commit

```powershell
git add src/app/admin/finance/expenses/page.tsx README_FIX_FINANCE_DEPENSES_MODIFICATION_MONTANTS.md

git commit -m "Permet la modification des montants depenses et budgets"

git push
```
