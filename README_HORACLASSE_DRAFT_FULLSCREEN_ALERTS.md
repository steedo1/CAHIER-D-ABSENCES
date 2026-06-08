# HoraClasse — Brouillon plein écran + alertes visibles

Ce patch améliore uniquement l'interface de l'éditeur de brouillon HoraClasse.

## Ce qui change

- Retrait de la colonne permanente "Séances non placées" à droite.
- La grille utilise maintenant toute la largeur disponible.
- Les séances non placées restent accessibles via le bouton `Non placés`.
- Les diagnostics/alertes sont visibles au-dessus de la grille.
- Un panneau `Voir toutes les alertes` permet d'ouvrir la liste complète.
- Rouge = conflit bloquant.
- Orange = avertissement à vérifier.

## Fichier modifié

- `src/modules/montage-emploi-du-temps/components/MontageDraftEditor.tsx`

Aucune modification BDD ni publication officielle n'est introduite dans ce patch.
