# Réduction de la mémoire native — 5 novembre 2026

Le service de production `mon-cahier-test` a subi deux arrêts OOM le 5 novembre à 15:35:34 et 17:50:48 UTC, avec une limite de 512 Mio. La série Render échantillonnée à cinq minutes atteint 499,2 Mio à 17:45. La version active avant correction est `123a2d97402062403b66262544a4d0a8f766c886`.

## Changement

- Ajouter `src/instrumentation.ts`, à côté de `src/app`, là où Next 15 cherche réellement son instrumentation. La compilation précédente n'avait pas de `.next/server/instrumentation.js` et les journaux de production ne contenaient aucun relevé `[runtime-memory]`.
- Limiter le cache natif Sharp/libvips à 8 MB, 32 opérations et zéro fichier ouvert, avec un thread par image. Le cache natif est distinct du heap V8 et du cache HTTP. Les paramètres n'altèrent pas les images ni les règles de fraîcheur des données.
- Activer les relevés mémoire existants toutes les cinq minutes, et y inclure la version Node. Les relevés contiennent uniquement des mesures techniques et l'identifiant de version.
- Configurer sur le service Render existant `NODE_OPTIONS=--max-semi-space-size=4` et `MALLOC_ARENA_MAX=2`. La commande de démarrage existante conserve `--max-old-space-size=288`; le heap total V8 devient 300 Mio au lieu de 336 Mio. La commande de build garde son propre `NODE_OPTIONS=--max-old-space-size=4096`.
- Le service reste configuré manuellement. Aucun Blueprint ni changement de plan n'est requis. Les autres variables doivent être conservées par une mise à jour en fusion, sans remplacement de la collection.

## Validation locale

32 tests ciblés réussis : images réelles, budget V8, présence du module d'instrumentation compilé, caches de référence, client service partagé, health/release, verrous et dispatch push/SMS, QR et traitements par lots.

Compilation de production finale et contrôle TypeScript réussis avec Node 22.23.4, Next 15.5.28 et identifiants fictifs. Aucun accès à la base de production pendant ces essais.

Banc identique : 6 000 requêtes à concurrence 8, 20 classes et 1 200 élèves synthétiques, pages publiques, authentification, listes classe/prof/admin, accès refusés, modules scolaires et optimiseur d'image. Toutes les réponses et tous les effectifs attendus sont vérifiés. Le nouveau banc vérifie également que les paramètres Sharp et la télémétrie démarrent réellement.

| Mesure | Référence 123a2d97 | Correctif |
| --- | ---: | ---: |
| Node à l'exécution | v22.23.4 | v22.23.4 |
| Next | 15.5.28 | 15.5.28 |
| Pic RSS système du serveur | 421.0 Mio | 363.7 Mio |
| RSS après charge | 418.0 Mio | 360.6 Mio |
| p95 HTTP local | 75.2 ms | 100.1 ms |
| CPU processus total | 37.2 s | 49.1 s |
| Limite totale du heap V8 | 336 Mio | 300 Mio |

Le budget plus petit augmente le travail de collecte mémoire et le temps CPU sur ce banc. La référence a été compilée avec Node 24 et le correctif avec Node 22 ; les deux serveurs sont exécutés avec Node 22.23.4. Les chiffres sont indicatifs, issus d'un essai court, et ne sont pas des mesures du conteneur Render. Ils ne prouvent ni une fuite précise ni la disparition définitive de tous les OOM sous une journée réelle d'activité.

## Vérification de production

Après fusion, vérifier la branche et le commit, appliquer uniquement les deux variables non secrètes en fusion, puis suivre le nouveau déploiement jusqu'à `live`. Vérifier les pages publiques, les accès protégés sans session, les journaux `[runtime-image-memory]` et `[runtime-memory]` (release déployée et heap de 300 Mio), les métriques et les événements d'échec sur la nouvelle fenêtre.

Références : documentation Next sur l'instrumentation (https://nextjs.org/docs/15/app/guides/instrumentation), API Sharp (https://sharp.pixelplumbing.com/api-utility/), performance Sharp (https://sharp.pixelplumbing.com/performance/), options V8 de Node (https://nodejs.org/download/release/v22.4.0/docs/api/cli.html).
