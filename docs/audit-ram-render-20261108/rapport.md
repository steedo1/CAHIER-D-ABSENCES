# RAM Render — chargement des modules à la demande, 8 novembre 2026

Le service de production `mon-cahier-test` (`srv-dbc291on74is73f4692g`, workspace `tea-dbc1ns9srm7s739bitug`) dispose de 512 Mio. Render signale un événement `oomKilled` enregistré à 10:23:44 UTC sur l’ancienne instance `qfmk4` (version e7f085bc). Ses journaux montrent un redémarrage vers 09:15 ; l’heure de l’événement ne doit pas être assimilée à celle de la panne. La version active au début de l’intervention est eb1b54b8.

## Cause mesurée et correction

Next 15.5.28 active par défaut `experimental.preloadEntriesOnStart`. Son `unstable_preloadEntries()` parcourt toutes les entrées pages/API et exécute leurs modules, même sans requête utilisateur. La charge initiale mesurée de cette application atteint environ 313 Mio au repos.

`next.config.mjs` désactive ce préchargement. Les modules sont chargés lors du premier accès. Les règles métier, le middleware, les cookies, les caches HTTP et de référence, les limites V8 et Sharp, la configuration du service et la base de données ne sont pas modifiés.

Documentation officielle : https://nextjs.org/docs/15/app/guides/memory-usage#preloading-entries . Vérification complémentaire dans le code de la dépendance installée : `next/dist/server/next-server.js` et `config-shared.js`.

Le banc attend désormais la fin de l’enregistrement asynchrone de l’instrumentation après le message Ready. Le compteur technique des entrées effectivement chargées permet d’asserter : zéro entrée app avant la première requête, puis 21 après le scénario.

## Validation

Deux compilations de production avec vérification TypeScript réussies, sur Node 24.22.1. Les deux serveurs comparés tournent sur Node 22.23.4 et Next 15.5.28, avec old-space 288 Mio, semi-space 4 Mio et MALLOC_ARENA_MAX=2.

Même banc : 6 000 requêtes, concurrence 8, 20 classes et 1 200 élèves synthétiques. Accueil, connexion, ressources PWA, pages protégées, listes classe/prof/admin, modules scolaires et traitement d’image. Tous les statuts HTTP et les effectifs attendus sont vérifiés. La fixture Supabase est locale et refuse toute écriture métier.

| Mesure | Référence | Correctif |
| --- | ---: | ---: |
| RSS au repos, médiane | 313,2 Mio | 107,1 Mio |
| Pic RSS système | 365,3 Mio | 178,2 Mio |
| Dernier RSS | 290,0 Mio | 144,2 Mio |
| CPU processus total | 39,6 s | 30,5 s |
| Latence HTTP p95 locale | 70,8 ms | 62,1 ms |

37/37 tests ciblés réussis : mémoire native, instrumentation compilée, déduplication auth/profils/rôles, isolation d’établissement, accès hors ligne, redirections publiques, dispatch et caches. Trois tests fonctionnels supplémentaires couvrent directement le middleware : accès sans session, restriction du grant hors ligne au rôle/appareil/expiration, renouvellement d’une session expirée et propagation des cookies privés. Lint ciblé et `git diff --check` réussis.

Une exécution exploratoire du fichier existant `parent-portal-access.test.mjs` échoue déjà sur la référence eb1b54b8 dans deux assertions (signature de normalisation et identifiant de notification). Ces échecs précèdent cette correction ; le fichier et le module parents ne sont pas modifiés ici.

## Limites et vérification en production

Ce test court et synthétique ne prouve pas la disparition de tout OOM sous une journée réelle ou lors de tous les exports PDF. Un premier accès à un module peut être plus lent. Les modules chargés restent en mémoire : si toutes les pages sont utilisées, leur empreinte peut finir par rejoindre celle du préchargement. Le correctif évite la réservation systématique pour les modules inutilisés ; il ne constitue pas une preuve de fuite mémoire résolue.

Après fusion : déployer la branche existante, attendre le statut live, vérifier accueil/connexion/health/accès refusés, le commit servi, les relevés RAM et l’absence de nouvel événement de panne dans cette fenêtre. Le plan reste Free et aucun nouveau service n’est créé.
