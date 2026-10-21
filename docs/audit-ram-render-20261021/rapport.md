# Mon Cahier — audit RAM Render du 21 octobre 2026

**Statut : correction isolée, aucun déploiement effectué.** Le service `mon-cahier-test` est bien la production de `www.mon-cahier.com`. Aucune modification de service, de domaine, de DNS, de secret ou de donnée scolaire n’a été faite.

## Résultat et limite principale

Le candidat à 288 Mio de heap termine entre **394 et 412 Mio de RSS après 6 000 requêtes locales**, contre **581 Mio pour la référence**, sur le même scénario synthétique. **La dernière compilation termine à 412 Mio, avec un pic système de 414,9 Mio : l’objectif d’une tenue systématique sous 400 Mio n’est pas validé.** Un essai supplémentaire de 18 000 requêtes avait fini à 397 Mio, avec un maximum système de 399,2 Mio.

**Ce résultat n’est pas une mesure après déploiement sur Render.** Il concerne un processus Node local, sans processus npm parent, avec une base HTTP fictive. Il ne certifie ni la RAM totale du conteneur Render ni la capacité réelle à servir plusieurs établissements à 7 h 30.

Le candidat conserve un coût CPU supplémentaire. Il mérite une mise en production surveillée uniquement après accord ; il ne permet pas de promettre une optimisation sans aucun impact sur les performances.

## Production observée en lecture seule

- Service : `srv-dbc291on74is73f4692g`, région Frankfurt, forfait `free`, une instance.
- Déploiement actif confirmé : `dep-dbc3uirbc2fs73b7675g`, statut `live`, commit `b2cad91258062d993151af890605d6de9bf51bdc`, terminé à 04 h 31 UTC/Abidjan.
- Branche active : `migration-render-test-20261021`. **Auto-déploiement activé sur cette branche : fusionner la PR peut déclencher un déploiement.**
- Node des logs de build : **22.23.3** ; Next des logs d’exécution : **15.5.27**. Ces versions ont été réutilisées localement.
- Plafond Render mesuré : environ **512 Mio**. La pointe initiale était de **472,7 Mio**. Entre 06 h 00 et 06 h 24, la pointe atteint **485,2 Mio** ; dernière valeur à 06 h 24 : **482,0 Mio**. Marge minimale observée : environ **26,8 Mio**.
- CPU sur cette dernière fenêtre : **0,043 à 0,063 cœur**, pour une limite affichée de **0,15 cœur** par l’API du service.
- Aucun événement `server_failed`, `server_restarted` ou `service_suspended` renvoyé par la requête filtrée. Cela n’exclut pas un événement non exposé ou une mise en veille du forfait gratuit. Plusieurs identifiants d’instance sont présents dans les métriques.
- Les séries de latence HTTP et de nombre de requêtes sont vides dans le connecteur pour la fenêtre demandée. Les logs contiennent notamment des `class-roster` réussis en **2,6 à 4,9 secondes**, et des erreurs de jeton de renouvellement. Ils ne donnent pas une décomposition RSS/heap du processus actif.

Les valeurs brutes sont dans [production-metrics.json](production-metrics.json). Les métriques du conteneur Render et la RSS du processus local sont volontairement distinguées.

## Causes démontrées et points examinés

1. **Chargement du compilateur au démarrage.** Dans Next 15.5.27, `next.config.ts` passe par `next/dist/build/next-config-ts/transpile-config.js`, qui charge TypeScript et SWC. La sonde les retrouve dans le processus de référence. Avec un fichier `.mjs` équivalent, ces deux modules ne sont plus chargés. Sur le premier scénario identique, la RSS au repos passe de **386,6 à 319,5 Mio**. Il s’agit d’un coût d’outillage évitable, indépendant des données scolaires.
2. **Budget V8 et ramassage mémoire.** Un plafond de 4096 Mio ne réserve pas immédiatement 4 Gio, mais permet une croissance du heap incompatible avec un conteneur de 512 Mio. Les essais identiques montrent que les budgets de 256, 288 et 320 Mio déclenchent davantage de collecte et réduisent la RSS. Ils augmentent aussi le travail CPU. Le budget de 288 Mio est le compromis retenu pour examen.
3. **Portée de `NODE_OPTIONS`.** Le service expose `npm ci && npm run build` et `npm run start`, sans séparation visible dans ces commandes. Le connecteur ne fournit pas la valeur actuelle de `NODE_OPTIONS` : sa présence effective à 4096 en production **reste à confirmer**. Le nouveau démarrage propose un argument Node explicite ; le test conserve `NODE_OPTIONS=...4096` et vérifie un heap total V8 limité à **336 Mio**, correspondant à 288 Mio d’old space plus les autres espaces V8. Ce n’est pas une limite RSS.
4. **Caches.** Le cache Next par défaut de 50 Mio reste inchangé. Le cache Supabase de référence, ses TTL et sa déduplication restent inchangés. Les caches de contexte serveur utilisent notamment des `WeakMap` ou la portée de requête. Aucun cache d’élèves, de notes ou d’autorisations supplémentaire n’est introduit.
5. **PWA et périodicité.** Les temporisateurs de préparation et de reprise examinés sont des effets navigateur, avec nettoyage ; ils ne constituent pas un ordonnanceur Node permanent. Les préparations utilisent déjà des limites de concurrence, souvent quatre chargements. Leurs requêtes peuvent provoquer des pointes serveur, mais IndexedDB et le cache navigateur ne sont pas la RAM du serveur. Les crons externes restent inchangés.
6. **Risque de volume restant.** `/api/admin/students` peut charger jusqu’à 50 000 inscriptions et 5 000 classes dans une requête ; le moniteur d’appels agrège plusieurs tables et établissements. Les exports, PDF et traitements de documents peuvent charger des dépendances et buffers supplémentaires. Le scénario testé avec 1 200 élèves n’est pas une validation de ces volumes maximaux.
7. **Fuite mémoire.** Aucun mécanisme de fuite n’est démontré par cet audit. Une RSS croissante ne suffit pas à prouver une fuite. L’essai court de 18 000 requêtes est compatible avec un fonctionnement sous le budget choisi ; il ne remplace pas une observation sur plusieurs journées.

## Corrections proposées

- Remplacer `next.config.ts` par `next.config.mjs`, en conservant les mêmes options applicatives.
- Documenter dans `render.yaml` un build à **4096 Mio**, limité à la commande de compilation, et un démarrage Node direct avec un old space de **288 Mio**. **Ce fichier ne modifie pas le service déjà configuré manuellement.**
- Éviter un processus npm parent dans la commande de démarrage proposée. Les mesures candidates utilisent ce démarrage Node direct ; aucun gain spécifique du parent npm n’est chiffré.
- Fournir une sonde locale et un banc reproductible. Ils ne sont chargés ni par `npm start` ni par l’application en production. Aucun endpoint de diagnostic public n’est ajouté.
- Désactiver le déploiement Vercel de la seule nouvelle branche d’audit dans `vercel.json`.

**Écarté :** le mode standalone n’a pas donné de gain RAM supplémentaire convaincant sur ce scénario. Il n’est pas activé dans la correction finale. Aucun cache n’a été supprimé pour déplacer la charge vers Supabase.

## Mesures comparables avant/après

Même Node, même Next, même code scolaire compilé, huit requêtes simultanées, **6 000 requêtes**, école fictive de **20 classes et 1 200 élèves**. Les réponses classe et enseignant contiennent chacune 60 élèves ; la réponse administration contient 1 200 élèves. Les principales API scolaires sont aussi chargées anonymement avant le test, sans écriture. La base fictive refuse les opérations réseau autres que GET/HEAD.

| Configuration locale | RSS après charge | Pic RSS échantillonné | p95 HTTP local | CPU total du processus |
|---|---:|---:|---:|---:|
| Référence `.ts`, heap 4096 | 581,5 Mio | 584,2 Mio | 51,9 ms | 25,1 s |
| `.mjs`, heap 4096 | 543,3 Mio | 544,7 Mio | 62,2 ms | 28,5 s |
| `.mjs`, heap 256, deux essais | 362,2–367,9 Mio | 364,6–369,1 Mio | 63,5–64,9 ms | 34,7–35,3 s |
| **`.mjs`, heap 288, candidat** | **394,0 Mio** | **395,4 Mio** | **63,2 ms** | **32,0 s** |
| `.mjs`, heap 320 | 402,7 Mio | 412,4 Mio | 64,5 ms | 32,6 s |

Le candidat économise environ **169 à 187 Mio / 29 à 32 %** après charge par rapport à la référence de ce scénario. Son CPU total augmente d’environ **26 à 28 %** ; par rapport au `.mjs` non limité, le supplément est d’environ **11 à 12 %**. Le p95 augmente d’environ 11 à 12 ms par rapport à la référence. Ces mesures courtes sont sensibles au GC et à la machine locale ; aucune équivalence avec le CPU gratuit Render n’est revendiquée. Le budget 288 est préféré au 256 pour conserver davantage de heap aux traitements scolaires, même si la cible indicative de 400 Mio n’est pas systématiquement atteinte.

L’essai supplémentaire à 288 Mio envoie **18 000 requêtes**, dure environ **52 secondes de charge** puis dix secondes de repos, et termine à **397,0 Mio**. Le maximum RSS renvoyé par le système est **399,2 Mio**, le heap utilisé final est **186,7 Mio**, et tous les statuts et effectifs attendus sont vérifiés. Ce test ne couvre pas une journée d’exploitation, la génération de tous les exports ni les accès réels à Supabase.


La compilation finale, sans mode standalone, a également été relancée sur 6 000 requêtes : RSS finale **412.1 Mio**, maximum système **414.9 Mio**, p95 **63.5 ms**, réponses attendues vérifiées.

Les échantillons à 500 ms, les détails de heap/mémoire externe/ArrayBuffers, les temps par route et les compteurs réseau fictifs sont dans [local-measurements.json](local-measurements.json). Les pics échantillonnés ne garantissent pas l’absence d’une pointe entre deux mesures ; seul l’essai final dispose aussi du maximum RSS du système.

## Validation et impact Supabase

- Installation reproductible par `npm ci`, sans modification du lockfile ni des versions de dépendances.
- Compilation finale propre : **réussie**, avec vérification TypeScript par Next. Les avertissements déjà présents sur les exports `runtime`/`dynamic` du webhook Orange subsistent ; aucun nouveau blocage de compilation.
- `npm run typecheck` réussi avec un heap d’outillage de 4096 Mio. Une première tentative sans ce budget avait épuisé le heap de l’outil local ; ce n’était pas une panne du serveur Render.
- ESLint des nouveaux fichiers : réussi après correction des règles propres au préchargement CommonJS.
- Suite multicycle : **315 cas validés**, en combinant la passe initiale et la réexécution du fichier historique après récupération du commit Git manquant ; réexécution ciblée : 26/26.
- Suite appels, comptes classe, PWA, hors ligne et consommation Supabase : **448/454 cas validés** après récupération du second commit historique manquant ; réexécution hors ligne : 25/25.
- Les **six échecs restants ont été reproduits sur un worktree intact de `b2cad912`** : sonde 2G/saveData, trois cas d’identifiants de classe, une assertion de code QR et une politique de démarrage sans Cloud. Ce sont des tests déjà en échec, pas six incidents de production démontrés. Aucun test n’a été supprimé ou affaibli.
- Aucun changement dans `src/`, `public/`, SQL ou les dépendances : authentification, appels, clôture, synchronisation, relais, PWA, notes, formules et bulletins conservent leur code.
- **Zéro requête de test vers le Supabase de production.** Les mêmes routes gardent leurs mêmes vérifications et requêtes. Les compteurs de la base fictive sont conservés ; leur faible variation suit les expirations de TTL pendant des durées de test différentes. Aucune optimisation réseau existante n’est désactivée.

## 512 Mio peuvent-ils suffire ?

**C’est plausible pour les usages courants testés, mais pas encore validé pour plusieurs établissements en production.** La dernière compilation laisse environ 100 Mio sous 512 dans le processus local ; le conteneur réel peut consommer davantage. Des écoles beaucoup plus grandes, des imports/exports simultanés ou de lourds PDF peuvent dépasser cette marge. Je ne garantis donc pas la tenue durable à 512 Mio sur la seule base de ces essais.

Le forfait **gratuit** a en outre une limite indépendante de la RAM : mise en veille après quinze minutes sans trafic et redémarrage d’environ une minute, avec une page de chargement Render. Render déconseille ce forfait en production. Une baisse de RAM ne supprime pas ce comportement.

La première option payante Render à examiner est **Starter / `0.5c-512mb`, 7 $/mois**, avec 512 Mo et davantage de CPU, sans les limitations de veille du gratuit. Elle ne fournit pas davantage de RAM : la marge doit être confirmée après déploiement contrôlé. Si la charge réelle dépasse régulièrement environ 430 Mio, si le CPU ou les temps de réponse se dégradent, ou si les exports manquent de heap, la plus petite offre Render avec davantage de RAM est **`1c-2g`, 25 $/mois, 2 Go**. Aucune offre payante n’a été créée ou activée.

## Déploiement et retour arrière — uniquement après accord

1. Examiner la PR et choisir un créneau compatible avec les appels. Ne pas fusionner avant accord : la branche cible est auto-déployée.
2. Après autorisation, coordonner le commit `.mjs` et les commandes proposées, en évitant un déploiement automatique intermédiaire avec une combinaison différente. Ne pas créer un nouveau Blueprint à partir du fichier documentaire.
3. Build proposé : `npm ci && NODE_OPTIONS=--max-old-space-size=4096 npm run build`.
4. Démarrage proposé : `node --max-old-space-size=288 node_modules/next/dist/bin/next start --hostname 0.0.0.0`.
5. Vérifier une connexion réelle classe, enseignant et administration ; listes, emplois du temps, appel/synchronisation/clôture, notes et bulletin ; installation et reprise PWA. Ne pas fabriquer ni modifier de données scolaires pour le test.
6. Comparer la mémoire totale Render, le CPU et les réponses sur une fenêtre comparable incluant les appels de 7 h 30. Les métriques RSS/heap actives restent à instrumenter si un diagnostic plus fin devient nécessaire ; la sonde de banc ne doit pas être exposée publiquement.
7. Conserver le déploiement actuel `b2cad912` et ses commandes comme référence de retour. Un rollback de code seul ne restaure pas forcément les commandes de service : rétablir aussi le démarrage initial `npm run start` et la commande de build initiale si le candidat est retiré. Ne changer ni DNS, ni domaine, ni données.

## Sources et reproduction

- [Configuration Next 15](https://nextjs.org/docs/15/app/api-reference/config/next-config-js), et code installé `node_modules/next/dist/build/next-config-ts/transpile-config.js`.
- [Options Node 22](https://nodejs.org/download/release/v22.23.0/docs/api/cli.html), notamment old space et priorité des arguments de ligne de commande sur `NODE_OPTIONS`.
- [Limites Render gratuit](https://render.com/docs/free), [plans](https://render.com/docs/compute-plans), [tarifs](https://render.com/pricing), [déploiements](https://render.com/docs/deploys).
- Banc : `scripts/measure-runtime-memory.mjs`, sonde `scripts/runtime-memory-probe.cjs`, données fictives `scripts/memory-school-fixture.mjs`.

Exemple après une compilation locale avec les URL et clés fictives du banc : `MON_CAHIER_BENCH_HEAP_MIB=288 node scripts/measure-runtime-memory.mjs candidate /tmp/ram-candidate.json 6000 8 next school`. Le serveur de test écoute uniquement sur `127.0.0.1:3137`, la base fictive sur `127.0.0.1:54321`. Utiliser Node 22.23.3 pour reproduire les versions de cette comparaison.
