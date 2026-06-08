# Patch HoraClasse — Brouillon modifiable avant publication

Ce patch ajoute un éditeur de brouillon HoraClasse sans publier automatiquement l'emploi du temps.

## Ajouts principaux

- Nouvelle page : `/admin/montage-emploi-du-temps/projets/[id]/editor`.
- Nouvelle API : `/api/admin/montage-emploi-du-temps/projects/[id]/draft`.
- Modification d'un brouillon par clic dans une case vide.
- Déplacement d'une séance par glisser-déposer.
- Placement des blocs non placés par glisser-déposer.
- Retrait d'une séance vers la liste des non placés.
- Suppression manuelle d'une séance.
- Recalcul automatique des diagnostics après chaque modification.
- Passage automatique du projet en `ready` uniquement si aucune anomalie bloquante et aucun bloc non placé ne restent.
- Publication toujours volontaire via le bouton Publier.

## Règle de sécurité

Le patch ne modifie pas les tables officielles d'emploi du temps pendant l'édition. Les corrections sont sauvegardées dans `montage_timetable_projects.engine_result`.
La publication officielle reste gérée par la route existante `/api/admin/montage-emploi-du-temps/publish`.
