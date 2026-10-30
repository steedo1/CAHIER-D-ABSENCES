# Optimisation Supabase / Render — 30 octobre 2026

## Base de production et périmètre

- Service Render `mon-cahier-test` (`srv-dbc291on74is73f4692g`), branche `migration-render-test-20261021`, déploiement manuel.
- Commit initial réellement `live` : `5d47cb7728671c252587b7360d709247ac2daee7`, déploiement `dep-dbhn5rlg1s2s73agjirg`.
- Correctifs récents conservés : aperçu des bulletins sans PNG QR serveur, moyennes directes par trimestre, barèmes primaire, listes arabes, DESPS, module IA payant.
- Les PR anciennes encore ouvertes ont été inventoriées. Aucune fusion de travaux étrangers à cette optimisation.
- Reprise à 15:37 UTC : production désormais sur `7f5003e07732fd15d0245f41483940e6031c1bd1` (PR #263/#264, sous-matières, conduite, tri alphabétique). Les corrections sont rebasées sans conflit sur ce commit ; ces évolutions sont intégralement conservées. Les mesures matinales ci-dessous restent étiquetées avec leur ancienne fenêtre.
- Aucun changement SQL, de données, de calcul scolaire, d'abonnement, de Spend Cap ou de configuration Render.

## Mesures avant intervention

Journaux Supabase : fenêtre exacte **29 octobre 08:00 UTC → 30 octobre 08:00 UTC**.

| Endpoint / méthode | Requêtes |
| --- | ---: |
| GET user_roles | 2 776 |
| GET auth/v1/user | 2 572 |
| GET profiles | 1 700 |
| GET institutions | 1 138 |
| GET classes | 1 039 |
| GET relay_sync_devices | 963 |
| PATCH notifications_queue | 541 |
| GET academic_years | 530 |

Fenêtre plus récente **30 octobre 07:00 → 08:00 UTC** : 347 requêtes HTTP au total. Parmi elles : auth/user 87, user_roles 87, profiles 42, relay_sync_devices 41, institutions 21 ; aucune erreur HTTP sur les endpoints listés pour cette heure. Durées moyennes Supabase : auth/user 68,2 ms ; user_roles 69,6 ms ; profiles 85,1 ms ; relay_sync_devices 47,2 ms ; institutions 74,7 ms.

Render sur la même heure : échantillons RAM 281 116 670, 303 030 270 et 325 963 780 octets (instances différentes), soit environ 268–311 Mio. Les séries CPU, latence HTTP et nombre de requêtes sont vides dans l'API disponible. Bande passante : points de série à 07:00 = 2,4316149 MB et 08:00 = 1,4452963 MB ; ne pas les présenter comme un débit continu ni les extrapoler au mois. Aucun journal de niveau `error` renvoyé sur cette heure.

Les 16,199 Go d'egress et 1,049 Go de cached egress sont les relevés de facturation fournis par le propriétaire, pour le 9 octobre–9 novembre. Ils ne correspondent pas à une mesure effectuée par cette intervention. Les journaux ne renseignent pas `Content-Length` pour la majorité des réponses utiles : il est impossible d'attribuer honnêtement les 16 Go aux seuls nombres de requêtes ci-dessus. Le plus gros `settings_json` d'établissement est de 33 908 octets, sans preuve que ce champ domine le trafic.

## Causes confirmées et corrections

1. **Relais désactivé seulement côté navigateur.** La découverte serveur de capacité, le contexte compte classe et les informations de préparation enseignant continuaient à lire `relay_sync_devices`. Ils respectent désormais le même drapeau global de désactivation avant la requête. Les politiques de présence/GPS, identités, horaires et journaux PWA restent conservés.
2. **Préparation périodique sur les écrans cloud.** L'administration interrogeait le rôle avant de constater qu'elle n'avait rien à préparer. Les espaces admin/super/fondateur/parent court-circuitent cette tâche avant tout réseau. Le worker indépendant de livraison des présences reste actif.
3. **Compteurs de menu en onglet masqué.** Les compteurs de demandes d'absence/publication fonctionnent désormais uniquement en ligne et écran visible, sans chevauchement, avec délai de 15 secondes, reprise et attente progressive sur erreur. Intervalle normal conservé à 2 minutes. Aucune modification du suivi de présence ou des opérations de paiement/publication.
4. **Réveils du fournisseur de capacité relais.** Le chargement initial de l'établissement reste présent ; les réveils focus/online supplémentaires sont inutiles lorsque le relais est globalement désactivé et sont supprimés.
5. **Déduplication d'authentification incomplète.** `React.cache` ne mutualise pas les appels dans les Route Handlers. Réutilisation par objet cookies propre à la requête via WeakMap, modes lecture/écriture séparés. `getUser`, rôles et profils restent frais entre requêtes : aucun cache global des autorisations, aucune identité déduite de cookies non vérifiés.
6. **Import photos sans préparation ni limite du lot navigateur.** Compression séquentielle native du navigateur, JPG/JPEG/PNG, côté long maximal 1 024 pixels, cible indicative 180 Kio, qualité JPEG bornée. Conservation du nom de base (matricule/nom), des proportions, des petites images et repli du décodage sur anciens téléphones. Envoi par lots de 10 et compte rendu des succès partiels. Aucune dépendance ou conversion d'image serveur ajoutée.
7. **Photos identiques retéléchargées.** Cache serveur uniquement après vérification fraîche de l'utilisateur, de l'élève et des droits. Clé établissement/élève/chemin/date de photo, durée 60 secondes, plafond 8 Mio, 1 Mio par photo, 200 entrées et 100 requêtes en cours. Erreurs et fichiers sans version non mis en cache. Réponses navigateur toujours `private, no-store`.

Les 541 PATCH de notifications correspondent à des mises à jour ciblées par identifiant, avec au plus trois occurrences par requête identique dans les principaux exemples examinés. Aucun élément n'a établi une boucle infinie sur cette fenêtre ; les accusés de livraison push/SMS n'ont pas été supprimés.

## Comparaisons contrôlées

| Scénario identique | Ancien code | Nouveau code |
| --- | ---: | ---: |
| Administration visible pendant 8 h simulées : appels de rôle de la préparation | 481 | 0 |
| Même photo autorisée lue 20 fois en moins de 60 s : téléchargements Storage | 20 | 1 |
| 20 demandes concurrentes de client serveur dans une requête hors RSC : clients / vérifications | 20 / 20 | 1 / 1 |
| Découverte relais avec désactivation globale | requête en base | 0 requête |

Ces mesures sont des tests reproductibles, pas une économie mensuelle observée. Les tests photo vérifient aussi le refus après retrait des droits malgré un fichier en cache.

Compression Chromium sur images **synthétiques**, 2 400 × 3 200 → 768 × 1 024 : JPEG 1 981 396 → 17 144 octets ; PNG 1 673 570 → 16 442 octets. Les photos réelles, plus détaillées, auront un résultat différent. La cible 100–200 Ko reste indicative : la qualité minimale est préservée plutôt que forcer toute image sous un plafond arbitraire.

## Validation et limites

- TypeScript et compilation Next.js de production réussis avec les variables de test isolées ; dépendances applicatives inchangées.
- Cloud/PWA : 450 tests réussis ; multi-cycles : 364 ; Parent Connect : 91 ; finance/moyennes/QR ciblés : 45 ; IA : 43 ; DESPS : 11.
- Tests additionnels : déduplication de client hors RSC, cache photo borné/expiration/erreurs/isolement/révocation, compteurs masqués/hors ligne/reprise/absence de chevauchement, zéro lecture relais et compression dans Chromium.
- Parcours navigateur existants : saisie/publication/bulletins admin et correspondant, liste arabe bilingue, listes primaire paysage et secondaire portrait exécutés avec données synthétiques, sans toucher aux comptes ou notes de production.
- Deux limites locales ont été **reproduites sur le commit de production initial**, dans un worktree distinct avec le même environnement : trois variantes du test de pagination de bulletin dépassent une page dans Chromium portable 133 ; le test de rejet d'un upload de signature de carte génère un `ReadableStream already closed` asynchrone sous Node 24. Les assertions métier des cartes passent. Ces échecs ne sont pas masqués ni attribués aux corrections ; les contrôles GitHub utilisent leur navigateur habituel.
- Le navigateur portable et ses dépendances restent uniquement dans l'environnement de test ; aucune nouvelle dépendance de production.

## Risques existants et observation après livraison

Les advisors Supabase signalent notamment **47 tables publiques sans RLS**, dont profils/rôles, et 32 vues SECURITY DEFINER. Ces avertissements sont antérieurs aux corrections. L'accès réel dépend aussi des GRANT et des contrôles serveur ; le simple décompte ne prouve pas une exposition de toutes les tables. Une activation globale de RLS sans audit des usages risquerait de bloquer la production : aucune politique n'a été changée dans cette livraison. Référence : https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public

Après passage du nouveau déploiement à `live`, vérifier domaine officiel, réponses protégées sans session, marqueur du commit, journaux Render et métriques sur une fenêtre explicitement datée. Les parcours authentifiés ont été validés en environnement isolé ; cela ne remplace pas une observation de tous les établissements sur une journée d'activité. Les anciennes PWA peuvent continuer à émettre l'ancien trafic jusqu'à leur mise à jour normale.

La baisse de requêtes ne prouve pas à elle seule que l'egress passera sous 5 Go/mois. Comparer ensuite des fenêtres de durée et d'activité comparables, ainsi que les catégories de facturation Supabase. Aucune baisse d'abonnement recommandée sur la seule base de ces tests.

Retour arrière : redéployer le commit précédant cette livraison `7f5003e07732fd15d0245f41483940e6031c1bd1` ou annuler uniquement la PR d'optimisation et déployer la branche. Ne pas revenir au commit matinal, qui ferait perdre les évolutions de matrice et de conduite livrées entre-temps. Aucun changement de schéma à inverser, aucune donnée à restaurer.
