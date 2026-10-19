# Cahier de notes primaire — livraison PR 173

Branche cible : `reprise-propre-5418ce7-20260729`. Branche de travail : `feature/primaire-evenements-20261019`.

## Fonctionnement livré

- Le calendrier existant des paramètres couvre les établissements primaires français et franco-arabes, du CP1 au CM2. Chaque événement possède une identité stable, un libellé libre, une nature, une date, des niveaux et des enseignements. Deux évaluations internes peuvent porter le même libellé.
- Le maître choisit classe, discipline et événement dans son cahier. Le serveur applique la date programmée et le barème enregistré. Le devoir conserve une date libre. Les événements ne demandent aucune période ; les anciennes compositions liées aux périodes restent consultables.
- Une matière commune possède des évaluations distinctes par enseignement. Les élèves, colonnes de notes, barèmes, effectifs, rangs et résultats suivent l'enseignement sélectionné. Les changements de sélection annulent les chargements obsolètes.
- La publication officielle conserve les snapshots existants et leurs versions. Publication directe franco-arabe et notifications parents conservées ; la politique de validation des écoles classiques demeure applicable.
- Chaque événement autorisé produit son bulletin avec les modèles primaires existants : logo, coordonnées, identité de l'élève, maître, direction, disciplines notées et rangs. Les matières non notées sont omises ; zéro reste une note.
- Le bulletin de passage CP1–CM1 inclut le récapitulatif officiel annuel. Moyenne annuelle = (moyenne des compositions ordinaires + 2 × moyenne de passage) / 3, sur le même barème. Devoirs, évaluations internes et examens blancs sont exclus. Une composition manquante, une publication incohérente ou des colonnes en double empêchent de fabriquer un résultat annuel.
- Le CM2 reçoit ses bulletins d'événements et d'examens blancs, sans composition de passage ni formule CP1–CM1.

## Texte officiel consulté

Le recueil [Circulaires DPFC 2026–2027](https://dpfc-ci.net/dpfc/2027/textes_officiels/Circulaires%20DPFC%202026%20-%202027.pdf), relié par la [page officielle DPFC](https://dpfc-ci.net/?page_id=4855), contient une circulaire du 11 septembre 2026. Ses deux premières pages confirment la pondération 1 / 2 du primaire, l'admission à partir de 5/10 et l'avis du Conseil des maîtres requis en dessous. Aucun redoublement automatique n'est déduit sous ce seuil. Les dates d'événements restent configurées par l'établissement ; aucun calendrier d'école privée n'est imposé comme calendrier ministériel.

## Sécurité et conservation

Aucune migration, DDL, nouvelle table, modification d'enum, `db push` ou mutation de données réelles pendant la recette. Catalogue stocké dans les paramètres existants, contrôle des rôles et de l'établissement, révision et écriture conditionnelle pour éviter l'écrasement concurrent des paramètres. Les événements déjà utilisés conservent leur identité pédagogique et leur date. Les créations concurrentes réutilisent la même évaluation et la clé primaire existante empêche les doublons. Chargements des bulletins par lots, sans requête par élève ; index et validations d'événement calculés une fois par enseignement.

Le secondaire historique, le CSCA, les livrets préscolaires, les listes de classe de la PR 171 et les modules finance/absences/HoraClasse/Parent Connect ne sont pas refondus par cette livraison.

## Vérifications reproductibles

```sh
npm ci
NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck
npm run test:primary-events
npm run test:multicycle
npx playwright install chromium
npm run test:primary-events:browser
npm run build
```

- Tests intégrés : tous les niveaux, matières communes, enseignements doubles, école française, dates serveur, échelles /10, /20 et /50, élève d'un seul enseignement, zéros, publication, queue de notifications, paramètres concurrents et création simultanée.
- Parcours Chromium : véritable éditeur du calendrier, véritable cahier de notes, enregistrement/publication et véritable écran Correspondant Fichier avec le sélecteur d'événement et le modèle primaire.
- PDF : deux élèves, trois présentations, avec et sans récapitulatif de passage, exactement deux pages A4 par fichier et aucune perte du logo ou des signatures. Inspection visuelle de la présentation bilingue annuelle.
- Régression : calculs et rendu secondaire historique, CSCA, périodes, droits, matières/sous-matières, préscolaire et autres parcours couverts par `test:multicycle`.

La recette utilise des identités et notes fictives en mémoire. Elle ne constitue pas une saisie réelle dans l'EPC. L'établissement doit enregistrer ses dates et les barèmes de ses matières avant les premières compositions ; aucune note ou date réelle n'est inventée pour la mise en service.

## Compatibilité vérifiée sur le schéma réel

Lecture seule de Supabase : `grading_period_id` est nullable ; `grade_evaluations.scale` est limité historiquement à 5, 10, 20, 40 ou 60. Pour un barème primaire de 50, le titre primaire existant porte le barème réel et la colonne contrainte reçoit une valeur compatible. Les points restent stockés tels que saisis, y compris 37,25/50 ; les APIs, les snapshots officiels, les moyennes et l'espace parent utilisent 50. Aucun coefficient ni aucune note n'est détourné pour stocker le barème.

Le déclencheur SQL historique produit aussi des notifications à l'échelle de toute la classe. Pour les événements primaires, ces messages sont conservés avec un statut d'erreur technique et remplacés par les messages des seuls snapshots officiels. Un garde au dispatch couvre la lecture concurrente du déclencheur, sans modifier son SQL. Les appareils Parent Connect liés au matricule restent notifiés même sans compte tuteur séparé. Les messages des autres modules et du secondaire suivent leur parcours existant.
