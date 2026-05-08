# Module Montage emploi du temps

Ce module prépare l’intégration du moteur de montage intelligent dans Mon Cahier.

Principe de sécurité :

1. Mon Cahier reste l’application principale.
2. Les données officielles existantes ne sont pas modifiées pendant la génération.
3. Le module charge d’abord les classes, enseignants, matières, créneaux et affectations.
4. La génération devra produire un brouillon.
5. La publication vers les emplois du temps officiels ne sera activée qu’après validation.

Nom interface : Montage emploi du temps
Route admin : /admin/montage-emploi-du-temps
API bootstrap : /api/admin/montage-emploi-du-temps/bootstrap
