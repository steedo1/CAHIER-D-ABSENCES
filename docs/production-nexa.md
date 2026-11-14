# Production Nexa

## Parcours

- **Administration → Cartes scolaires**. Choisir l’année et les élèves, vérifier les aperçus recto verso, enregistrer une préparation ou commander les cartes. La préparation et la commande utilisent l’identité unique de l’élève dans l’établissement et l’année. Une commande ouverte portant sur la même sélection est réutilisée.
- **Production Nexa**. Choisir l’établissement et l’année puis utiliser les filtres des cartes ou ouvrir une commande. Générer au format PVC (85,6 × 54 mm, deux pages par élève) ou A4 recto verso. Les commandes peuvent être déclarées prêtes lorsque tous leurs élèves sont couverts par une archive de la commande. Le PDF peut être téléchargé et transmis par le responsable. Prévoir un essai à taille réelle chez le fabricant.
- **Super-administration → Production Nexa**. Créer un compte et lui remettre ses identifiants initiaux par un canal privé. Le périmètre peut viser tous les établissements, y compris les futurs, ou une liste explicite. Cette page sert aussi à désactiver, révoquer et consulter le journal.

## Accès et données

Le rôle d’authentification `nexa_production` est réservé aux comptes internes sans profil scolaire. Il n’est pas associé à un rôle PostgreSQL utilisable par PostgREST. Le serveur contrôle le statut, l’établissement et les autorisations à chaque opération. Les quatre permissions couvrent la lecture, les commandes, la production et le téléchargement. Le super-administrateur peut intervenir sur tous les établissements.

Le fichier complet est assemblé sur le poste de production. Les photos sont signées uniquement pour le lot demandé. Le ticket d’archivage est nominatif, limité à vingt minutes et lié à l’établissement, l’année, la sélection et la version. Les aperçus d’établissement sont deux JPEG de 480 pixels de large avec un filigrane intégré. Les éléments officiels du PDF final sont pris dans la configuration validée de chaque établissement. À EPC, un élève des deux enseignements conserve une seule carte et les deux classes. Son verso utilise les visuels arabes configurés. Une carte français uniquement utilise les visuels français présents en configuration.

Le bucket `nexa-production-cards` est privé. Les téléchargements passent par le serveur, sans URL publique ni lien signé pour le PDF. Un même lot est réutilisé depuis les archives jusqu’à une régénération explicite. La révision du lot crée un fichier distinct et conserve la version précédente. Si le transfert d'un PDF réussit avant une interruption de l'enregistrement SQL, la reprise compare son empreinte avant d'écrire les métadonnées. Les archives reçoivent une date de revue à 24 mois. Cette date sert à organiser la conservation, sans suppression automatique. Valider la durée et la procédure de revue avant d’utiliser des dossiers réels. Les fichiers sans métadonnées après une reprise abandonnée doivent être rapprochés lors de la revue de stockage.

## Recette avant mise en production

1. Exécuter la migration `20261114190251_production_nexa.sql` sur un projet Supabase de recette. Vérifier que `storage.objects` applique le refus par défaut aux rôles navigateur pour les fichiers privés. La migration conserve les droits serveur et retire aux rôles navigateur l’ancien RPC `fn_upsert_role`, qui pouvait attribuer des rôles sans contrôle interne.
2. Pointer l’application de recette vers ce projet isolé avec `SCHOOL_CARDS_ENABLED=true`. Configurer l’origine publique de recette dans `NEXT_PUBLIC_APP_URL` ou `SCHOOL_CARD_PUBLIC_ORIGIN`. Utiliser la clé service habituelle de **recette** pour signer les tickets internes. Les domaines de logo externes non reconnus peuvent rester visibles dans le document de production si leur CORS l’autorise. L’aperçu serveur reprend les logos intégrés et les images des origines approuvées.
3. Utiliser un compte de chaque type pour essayer les API directes, les commandes, la désactivation et les téléchargements. Pour EPC, contrôler visuellement une carte française, une carte arabe et une carte bilingue dans le PDF et sur un tirage PVC. Vérifier l’authenticité du visuel de signature française enregistré avant utilisation sur des cartes réelles.
4. Sur un lot représentatif, relever la taille totale des photos lues, des PDF archivés et des téléchargements ainsi que le pic mémoire du service. Comparer le volume estimé sur un mois au quota du projet. Le test navigateur mesure un lot fictif et ne peut pas établir le coût hébergé.

`npm run test:school-cards` lance les tests de routes, de rendu, de stockage et de migration. Le workflow GitHub « School cards isolated verification » ajoute un parcours Chromium et une recette sur Supabase local.
