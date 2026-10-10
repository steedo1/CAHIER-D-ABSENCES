# Optimisation Supabase — Preview à valider

Base exclusive : branche de production `reprise-propre-5418ce7-20260729`, commit `1cce7140161cacee5e32b9beb042b64abc8113be`, déploiement Vercel `dpl_9nDR3Uk1SGbPkDe41qCVeydVQgLg`. Vérifiée sur le domaine `www.mon-cahier.com` à la reprise le 7 octobre 2026.

## Causes établies

- Les 429 observés sont des POST `/auth/v1/token?grant_type=refresh_token`, issus de `supabase-ssr/0.7.0 createServerClient`, avec `over_request_rate_limit`. Le helper serveur réinjectait les copies HttpOnly via `setSession()` à chaque création de client. Avec un access token expiré, cela déclenchait un renouvellement ; les clients en lecture seule n'enregistraient pas les nouveaux cookies. Le serveur utilisait une clé de stockage différente du navigateur (`mca-auth-v1`), et continuait donc à repartir de copies anciennes. Quatre routes reproduisaient indépendamment la même logique. Ce mécanisme explique les renouvellements répétés ; la disparition complète des 429 reste à confirmer sur une session réelle.
- Les GET `profiles` en 400 sélectionnent `id,role,institution_id`. Le schéma réel ne contient pas `profiles.role` : les rôles sont dans `user_roles`. Dix sélections dans neuf routes ont été corrigées, en conservant les listes de rôles propres à chaque opération et le contrôle d'établissement.

## Corrections

- Même stockage de session côté navigateur et serveur ; priorité aux cookies SDK, y compris découpés, sur les anciennes copies de tokens.
- Renouvellement et persistance dans le middleware, avec propagation des nouveaux cookies à la requête rendue et à la réponse navigateur. `getSession()` n'est utilisé que pour le transport de session ; les handlers continuent à vérifier `getUser()` et leurs autorisations.
- Suppression de `setSession()` systématique et des quatre implémentations serveur indépendantes. Le `setSession()` navigateur au moment de la connexion reste nécessaire et est conservé.
- Une vérification utilisateur par client de requête, y compris pour les appels simultanés. Mutualisation des clients pendant un rendu React serveur.
- Profils et rôles mutualisés par client de requête, sans cache d'autorisation entre requêtes. Les changements de rôle sont donc relus à la requête suivante.
- Cache serveur limité aux métadonnées de classes et d'établissement déjà lues par le client administratif existant : 3 secondes pour classes, 15 secondes pour institutions, 200 entrées maximum. Requêtes explicitement scoped, clés distinctes par URL et en-têtes ; erreurs, rôles, profils, QR, écritures, requêtes annulables et champs sensibles exclus. Toute écriture par ce client invalide le cache avant et après exécution. Une écriture par un autre client est visible au plus tard à l'expiration du court délai.
- Déconnexion : purge des cookies SDK découpés en plus des cookies historiques. Aucune suppression des données offline préparées.

Aucune opération d'écriture Supabase, migration, modification RLS ou donnée métier n'a été réalisée pour cette passe. Le client administratif préexistant n'est pas employé pour valider l'identité ; les autorisations restent contrôlées côté serveur.

## Mesures de référence

Fenêtre Supabase : 6 octobre 2026, **01:45:21–02:45:21 UTC** (Abidjan). Compteurs du journal `edge_logs`, avec ingestion différée possible. Les chiffres de cette fenêtre ne sont pas ceux du relevé fourni initialement.

| Endpoint | Avant / heure | Après / heure |
|---|---:|---:|
| `/auth/v1/token` POST | 836, dont 49 HTTP 429 | À mesurer pendant la recette |
| `/auth/v1/user` GET | 2 036 | À mesurer |
| `profiles` GET | 2 430, dont 20 HTTP 400 | À mesurer |
| `user_roles` GET | 1 743 | À mesurer |
| `classes` GET | 1 368 | À mesurer |
| `institutions` GET | 1 228 | À mesurer |
| `bulletin_qr_codes` GET | 121 | À mesurer |
| `bulletin_qr_codes` POST | 0 | À vérifier : toujours 0 insertion inutile |

Les compteurs après correction ne peuvent pas être établis à partir du trafic de production puisque cette branche n'y est pas promue. L'utilisateur a choisi de réaliser lui-même la recette réelle de la Preview. Aucun chiffre après n'est présenté comme mesuré tant que cette recette n'a pas eu lieu.

Tests contrôlés : vingt contrôles simultanés sur un même client produisent une vérification utilisateur, une lecture profil et une lecture des rôles. Le SDK réel renouvelle une session expirée une fois, sauvegarde les cookies, puis n'effectue aucun renouvellement supplémentaire sur la navigation suivante. Vingt lectures identiques de références sont mutualisées en une seule requête. Ces résultats de tests ne sont pas des mesures de trafic par heure.

## Recette réelle avant toute fusion/promotion

1. Ouvrir la Preview et se connecter ; vérifier la redirection et le rôle affiché.
2. Naviguer entre tableau de bord admin, classes, profil, listes, notes, bulletins et paramètres. Vérifier que le rôle et l'établissement sont corrects.
3. Tester changement de rôle/page avec les comptes prévus ; un rôle retiré doit être refusé côté API dès la requête suivante.
4. Charger les classes, modifier une référence dans un environnement de test, puis vérifier sa mise à jour rapide.
5. Ouvrir le cahier d'appel avec puis sans relais, préparer les données PWA, passer hors connexion, puis reconnecter et vérifier la synchronisation sur une classe de test.
6. Vérifier surveillance des appels admin, EDT, enseignants, notes, bulletins, parents, finance et paie ; les tests automatisés couvrent les contrats existants, la recette confirme les parcours réels.
7. Garder une session active pendant au moins un cycle d'expiration du token ; noter début/fin UTC. Vérifier déconnexion/reconnexion et l'absence de cookies SDK résiduels.
8. Relever les sept endpoints ci-dessus sur une fenêtre comparable, distinguer la Preview du trafic concurrent de production autant que les journaux le permettent, et confirmer 0 HTTP 429 token, 0 HTTP 400 profiles répétitif et 0 INSERT QR inutile.

La fusion et la promotion doivent attendre cette validation.

## Validation automatisée et limites

- Build Vercel réussi pour le code `80b81953306812af9659264bc81d1e393533c5fe` : [Preview](https://cahier-d-absences-pro-ces5d0g52-ange-aristide-kouadios-projects.vercel.app). Contrôle HTTP : `/login` 200, `/manifest.webmanifest` 200, `/api/admin/settings` sans session 401. Il s'agit de contrôles HTTP, pas d'une recette navigateur authentifiée.
- TypeScript : `tsc --noEmit --incremental false` réussi ; le job CI « Web offline critical » confirme aussi le typage et les régressions offline.
- Suite complète `node --test --test-concurrency=4 test/*.test.mjs` : **382 tests, 363 réussis, 19 échecs, aucun ignoré**. Les 19 échecs sont reproduits sur la base de production exacte, dans `student-transfer-regression.test.mjs` (18, double de base ne gérant pas `lifecycle_status.eq.active`) et `relay-grade-versioned-routing.test.mjs` (1, assertion de forme du wrapper V4). Comparaison sur une copie isolée du commit de production : 31 tests de ces deux fichiers, 12 réussis, les mêmes 19 échecs. Le test historique d'authentification a été adapté au helper commun : il exige toujours une identité vérifiée et des rôles lus côté service, sans exiger la réinjection répétitive de session supprimée.
- Les huit tests dédiés à cette passe vérifient déduplication, renouvellement avec le SDK installé, persistance, cookies découpés, isolement des établissements, invalidation, erreurs et course entre lecture/écriture.
- `npm run lint` lancé sur tout le dépôt : échec, avec des problèmes hors périmètre dans des composants et chargeurs de tests existants. Les deux erreurs de chargeurs ajoutés dans cette passe ont été corrigées. Lint de tous les fichiers sources modifiés : **0 erreur, 1 avertissement existant** (`req` inutilisé dans `institution/slots`).
- [CI du code vérifié](https://github.com/steedo1/CAHIER-D-ABSENCES/actions/runs/37652817700) : contrat de release, typage/régressions web offline, transaction de suppression élève dans une base CI éphémère, vérification complète du relais et audit des dépendances relais réussis.
- **Blocage du gate de release : audit des dépendances web**. Il signale 7 vulnérabilités de production (2 modérées, 4 élevées, 1 critique), notamment dans Next, Sharp, Axios et xmldom. `package.json` et `package-lock.json` sont identiques à la base de production : aucune dépendance n'a été ajoutée ou mise à niveau par cette optimisation. Ce gate reste rouge ; la résolution des vulnérabilités et sa validation sont nécessaires avant une release. Aucun contournement du gate n'a été effectué.

La branche est livrée en [PR draft #89](https://github.com/steedo1/CAHIER-D-ABSENCES/pull/89). La PR référence le commit final et sa Preview. La recette authentifiée, la mesure après correction et les vérifications métier réelles restent à effectuer par l'utilisateur, selon son choix. Ni fusion ni promotion en production.

## Fichiers concernés

- Session : `middleware.ts`, `src/middleware.ts`, `src/lib/supabase-server.ts`, `src/lib/auth/session-cookies.ts`, `src/lib/auth/session-middleware.ts`.
- Contexte de requête et références : `src/lib/auth/server-context.ts`, `src/lib/supabase-reference-fetch.ts`, `src/lib/supabaseAdmin.ts`, `src/app/api/admin/_helpers/getMyInstitution.ts`, `src/app/api/admin/_helpers/institutionAccess.ts`, `src/app/api/admin/classes/route.ts`, `src/app/admin/layout.tsx`, `src/app/api/auth/role/route.ts`.
- Guards corrigés : les sept routes sous `src/app/api/admin/institution/` (`route.ts`, `settings`, `periods`, `slots`, `subject-components`, `bulletin-subject-groups`, `bulletin-subject-structure`), `src/app/api/admin/rapport-f/settings/route.ts`, `src/app/api/admin/offline/relay-devices/route.ts`.
- Clients unifiés/déconnexion : `src/app/redirect/route.ts`, `src/app/api/admin/users/route.ts`, `src/app/api/admin/users/reset-password/route.ts`, `src/app/api/admin/password/route.ts`, `src/app/api/auth/sync/route.ts`, `src/app/api/auth/signout/route.ts`.
- Tests et rapport : `test/supabase-server-auth-dedupe.test.mjs`, `test/supabase-reference-fetch.test.mjs`, `test/file-correspondent-parent-fields.test.mjs`, ce document.
