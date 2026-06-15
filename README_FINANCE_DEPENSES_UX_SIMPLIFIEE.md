# Finance — Dépenses : interface simplifiée

Ce patch simplifie l'écran `Admin > Finance > Dépenses`.

## Changements

- La saisie d'une dépense devient l'action principale de la page.
- Le formulaire de création d'un poste budgétaire passe dans un bloc ouvrable/fermable.
- Les catégories de dépense sont retirées de l'écran principal, car elles étaient facultatives et rendaient l'interface confuse lorsqu'aucune catégorie n'existait.
- Les sélecteurs `Sans catégorie` / `Aucune catégorie liée` ne s'affichent plus.
- La liste des postes budgétaires devient un tableau compact avec hauteur limitée et défilement interne.
- Les montants prévus restent modifiables directement dans le tableau.
- Les dépenses peuvent toujours être saisies avec ou sans poste budgétaire.

## Fichier modifié

- `src/app/admin/finance/expenses/page.tsx`

## À tester

1. Ouvrir `Admin > Finance > Dépenses`.
2. Vérifier que les cartes du haut affichent toujours le budget, le consommé et le disponible.
3. Saisir une dépense rattachée à un poste.
4. Saisir une dépense libre.
5. Modifier le montant prévu d'un poste budgétaire dans le tableau.
6. Vérifier que les catégories n'encombrent plus l'écran principal.
