# Livraison en production — 25 octobre 2026

Fusion et déploiement de la PR 228 explicitement approuvés par le propriétaire.

- PR fusionnée : https://github.com/steedo1/CAHIER-D-ABSENCES/pull/228 .
- Commit déployé : `34e72bc45e0a603fcdfb710795acd69587f107cd`.
- Branche de production : `migration-render-test-20261021`.
- Service officiel : `srv-dbc291on74is73f4692g`, `mon-cahier-test`, domaine https://www.mon-cahier.com/ .
- Déploiement : `dep-dbf857t9fdbs73963o50`, déclenché à 22:28:47 UTC, terminé et confirmé `live` à 22:33:10 UTC.
- Le contenu du commit de fusion est identique à celui de la branche validée `7504fc10…` ; ce dernier ne diffère du code CI `c48511a9…` que par les preuves et le rapport.
- Aucun changement de plan, variable d’environnement, secret QR, migration SQL, élève, inscription ou signature.

## Contrôles après mise en ligne

La page cartes a été rechargée sur le domaine officiel avec la session autorisée CSCA. Les 527 élèves sont chargés. L’image d’armoiries est visible et entièrement décodée (`naturalWidth=280`). Le QR de la carte utilisée avant le déploiement est resté identique et un nouveau contrôle public explicite a confirmé **Carte valide**.

Le PDF individuel a été généré puis régénéré sans message d’erreur. Le QR de la réimpression reste le même. Une attestation réelle a été demandée pour un seul élève ; sa nouvelle fenêtre de document s’est ouverte et l’interface n’affiche aucune erreur.

La lecture des documents `blob:` est interdite par le navigateur de contrôle : le contenu de l’attestation réelle n’a pas été inspecté, aucun contournement n’a été tenté. Son générateur, le nouvel emblème, la pagination et les signatures ont été vérifiés sur les PDF fictifs du CI déjà référencé. Les tentatives de capture de l’en-tête de production ont échoué ou produit un cadrage inutilisable ; aucune capture de production ni donnée personnelle réelle n’est jointe à ce rapport.

Les journaux Render ne contiennent aucun message de niveau erreur sur l’intervalle 22:33–22:38 UTC. Cinq relevés de la nouvelle instance `c7bhn` donnent un maximum de **306,8 Mio sur 512 Mio** ; dernier relevé vers 304,3 Mio. Ce sont des mesures ponctuelles, pas une garantie pour toute charge future ni une comparaison statistique avant/après. Les valeurs brutes sont dans `deployment.json`.

Les résultats précédents restent valides : 21 tests cartes/emblème, 353 tests scolaires, 438 tests PWA, contrôles A4 et intégration Supabase locale réels réussis ; 10/10 QR du PDF A4 décodés indépendamment. L’emblème n’ajoute aucun endpoint d’image ni appel Supabase. Les fichiers PDF sont produits dans le navigateur. La police est réutilisée entre les lots.

La caméra d’un téléphone et l’imprimante physique ne sont pas accessibles ici : ces essais matériels restent à confirmer par l’établissement. Les 81 photos, 12 matricules et 5 dates de naissance absents repérés au CSCA restent des données à compléter ; ils ne sont pas modifiés par cette livraison.

## Retour arrière

Point de retour : `910cf81422d7f349faa0cc2becea2aa3cb90fcdc`, ancien déploiement `dep-dbf243om7kps73fg8170`. En cas d’incident, restaurer cet artefact compatible si disponible ou reconstruire ce commit, puis vérifier son état `live`. Préserver les changements éventuels postérieurs.

Aucun retour arrière de base, suppression de tables, effacement de signatures ou rotation de clé QR n’est requis. La procédure n’a pas été exécutée puisqu’aucun incident n’a été constaté. L’auto-déploiement reste désactivé.
