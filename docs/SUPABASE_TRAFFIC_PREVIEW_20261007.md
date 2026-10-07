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
