# Fiabilité des appels CSCA — 7 octobre 2026

## Constat vérifié en production

Projet Supabase `nnxgxxktjvgnnbcedmvv`, CSCA. Investigation en lecture seule ; aucune présence ni séance réelle n’a été modifiée.

La production Vercel examinée correspond au commit `1cce7140161cacee5e32b9beb042b64abc8113be` de `reprise-propre-5418ce7-20260729`. La correction part de ce commit.

La 4e2 possède trois séances le 7 octobre avec une réception des données élèves en base. Une réception a eu lieu environ 43 minutes après la clôture. Sur les sept jours examinés, 8 de ses 19 séances n’ont pas de reçu élèves ; ces huit séances n’ont pas non plus d’exception de présence enregistrée. Cela concorde avec le défaut identifié, sans prouver que tous les élèves étaient présents. Les anciens appels sans reçu restent affichés comme non confirmés.

Les lignes d’`attendance_marks` représentent des exceptions : leur absence n’est pas une preuve d’envoi. Le reçu `relay_attendance_session_causality.updated_at` est utilisé séparément des horaires enseignants.

## Corrections

- L’appel final contient toute la liste chargée, y compris les élèves présents sans modification. Un élève d’un ancien cours ne peut pas entrer dans le nouveau lot.
- Une liste vide ou encore en chargement ne peut pas certifier un appel. La séance reste affichée si le stockage local échoue.
- Le téléphone de classe persiste le lot et la clôture avant de libérer l’écran. Le réseau est repris en arrière-plan ; une clôture attend tous les lots élèves de la même séance, même quand leurs références locales et serveur diffèrent.
- Les délais réseau couvrent le corps de la réponse, et pas seulement ses en-têtes. Une connexion interrompue ne peut pas garder l’écran ou le rejeu en attente indéfiniment.
- Une correction conserve une requête déjà tentée, son identifiant et son contenu. Elle reçoit un nouvel identifiant et suit la première requête.
- La suppression de la file et la confirmation du journal durable sont une même transaction IndexedDB. Une écriture provenant d’un ancien brouillon ne peut pas annuler cette confirmation. Le service worker partage le verrou de rejeu de la page et regroupe ses réveils simultanés.
- Les nouvelles ouvertures de téléphones de classe conservent le contexte nécessaire à leur reprise : créneau, heure du clic, durée et cours manuel éventuel. Le rejeu conserve la route et la référence de séance de classe.
- Le contrôle admin affiche distinctement les séances reçues, les appels élèves confirmés et les réceptions à confirmer. Une source sans reçus ne certifie pas les appels.

Le worker et l’application portent la même release `2026-10-07-attendance-complete-ack-v2`. Le schéma IndexedDB et la version des caches de données restent compatibles ; les appels locaux sont conservés.

## Preuves automatisées

`test/csca-attendance-reliability.test.mjs` exécute les fonctions de fermeture, les stockages IndexedDB, le rejeu de page et le worker. Il couvre une réponse dont le corps s’arrête, une confirmation perdue, une correction pendant l’envoi, les références de séance mixtes, le redémarrage, une liste indisponible et un échec d’écriture.

`test/offline-attendance-admin-e2e.test.mjs` vérifie les deux cas « tous présents » et « absents/retards » : hors connexion → indisponibilité serveur → reprise → confirmation perdue après acceptation → rejeu idempotent → reçu et clôture visibles via la vraie route de contrôle admin, avec un serveur et une base simulés. Il ne s’agit pas d’un appel écrit dans la base de production.

Ces régressions sont incluses dans `Offline Go-Live Gate`. Les résultats de compilation, de tests et du déploiement doivent être rattachés au commit exact de la PR.

La suite locale complète passe 193 tests. Le premier commit de correction passe aussi le contrôle TypeScript et les tests hors ligne, le contrôle complet du relais et le build Vercel. Le contrôle de publication a ensuite nécessité les versions correctives de dépendances : Next.js 15.5.27, Sharp 0.35.5, Axios 1.20.0, xmldom 0.8.15, source-map-js 1.2.2, fflate 0.8.3 et qs 6.16.0 dans le verrou. L’audit de production du verrou mis à jour signale zéro vulnérabilité. Le gate et le build sont relancés avec ces dépendances.

Versions correctives minimales documentées par les éditeurs : [Next.js 15.5.24](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36) et [Sharp 0.35.5](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w).

## Vérification terrain à terminer

Un test sur une tablette ou un téléphone du CSCA reste nécessaire pour vérifier le navigateur installé, son stockage et ses caches réels. Le navigateur accessible à l’agent demande une connexion à l’application ; aucun parcours admin authentifié réel n’a été certifié.

Sur un cours autorisé, préparer les données avec Internet, couper Internet, faire et terminer l’appel, fermer puis rouvrir l’application, rétablir Internet et vérifier que le compteur d’attente descend à zéro. Contrôler ensuite la même séance dans le dashboard admin : horaire du clic conservé, réception élèves confirmée, clôture reçue. Répéter avec tous les élèves présents et avec une absence ou un retard. Une absence de confirmation doit rester visible et ne doit pas conduire à effacer les données de l’appareil.

Ne pas vider les caches, désinstaller la PWA ni réinitialiser les téléphones qui contiennent encore des appels en attente.
