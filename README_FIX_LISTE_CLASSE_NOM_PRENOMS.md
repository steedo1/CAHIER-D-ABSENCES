# Correction ordre Nom + prénoms — Liste de classe

Ce patch corrige l'affichage des élèves dans `Organisation scolaire > Liste des classes`.

## Changements

- L'interface affiche désormais `NOM Prénoms` au lieu de `Prénoms NOM` ou `NOM, Prénoms`.
- Le PDF imprimé affiche `NOM Prénoms` sans virgule entre le nom et les prénoms.
- Les nouveaux élèves inscrits depuis la liste de classe reçoivent aussi un `full_name` construit dans l'ordre `NOM Prénoms`.

## Fichiers modifiés

- `src/app/admin/classes/liste/[id]/page.tsx`
- `src/app/api/admin/classes/[id]/roster/route.ts`
