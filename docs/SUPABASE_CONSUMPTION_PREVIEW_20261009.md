# Réduction de la consommation Supabase — recette Preview

Base vérifiée le 9 octobre 2026 : branche de production `reprise-propre-5418ce7-20260729`, commit `d89a461e2184de5c29629201cb7a765a738c1f85`, déploiement `dpl_48YAnnnvjieVFmxbiWuPYYcU8RZt` sur `www.mon-cahier.com`.

La PR #89 du 7 octobre est encore draft et non fusionnée : ses optimisations ne sont pas en production. Cette reprise conserve son nom de branche `codex/supabase-traffic-production-20261006`, intègre exactement la production vérifiée et conserve ses correctifs récents, y compris les preuves de fin d'appel et la préparation PWA. Aucun correctif Finance supplémentaire.

## Causes et corrections

1. **Sessions serveur réinjectées et validations multiples.** Les anciennes copies de tokens alimentaient `setSession()` systématiquement, avec des cookies serveur distincts du stockage navigateur. Les corrections de la première passe sont conservées : stockage `mca-auth-v1` commun, renouvellement persisté dans le middleware, clients mutualisés pendant le rendu, une vérification `getUser()` par client de requête. Les profils/rôles sont mutualisés seulement dans la requête, sans TTL d'autorisation entre requêtes. Les dix sélections invalides de `profiles.role` restent corrigées. Les causes détaillées figurent dans le [rapport du 7 octobre](SUPABASE_TRAFFIC_PREVIEW_20261007.md).
2. **Récupération classe même lorsque tout est confirmé.** `ClassDeviceSyncGuard` déclenchait `repairClassDeviceSyncV2()` toutes les cinq secondes ; cette fonction chargeait systématiquement les classes et leur contexte Cloud avant de vérifier les journaux. Elle consulte désormais localement la file, les journaux durables, l'ouverture et le dernier reçu. Lorsque rien n'attend et que la préparation locale existe, elle n'effectue aucun appel HTTP. Une préparation absente, un journal en erreur, une opération durable non confirmée ou un reçu incomplet conserve la récupération. La reprise manuelle force une découverte fraîche.
3. **Lectures de séances dans une boucle.** Le handler de réconciliation consultait `teacher_sessions` une fois par opération. Il regroupe maintenant les identifiants dans une lecture fraîche pour la requête entière, limitée au même établissement et à la même classe. L'identité, l'accès classe, le créateur, les matières, la fermeture et les preuves d'appel restent vérifiés. Aucun cache de séance, d'absence ou de reçu entre requêtes.
4. **Colonne d'établissement inexistante.** Les journaux montrent 133 HTTP 400 sur `select=id,name,short_name`. Le schéma réel possède `acronym`, pas `short_name`. Le lecteur de métadonnées classe demande désormais `id,name,acronym`. Le nom affiché reste prioritaire ; les politiques relais sont toujours lues séparément et les tokens ne sont jamais accordés en cas d'échec de leur contrôle.
5. **Reprises en panne trop fréquentes.** La garde classe applique un délai de 10, 20, 40 puis 60 secondes lorsqu'aucun progrès n'est possible. Un événement réseau réel ou la reprise manuelle permet une nouvelle tentative immédiate ; la file n'est jamais supprimée. Une erreur de découverte HTTP, notamment 402, est propagée pour déclencher ce délai. Le probe de synchronisation ne considère plus les 402/429 comme un Cloud utilisable. Il partage une sonde récente pendant 15 secondes en succès et applique un délai progressif borné à 60 secondes en erreur ; reconnexion et changement de connexion utilisateur réinitialisent cette sonde. Ce résultat ne valide aucune identité : les API de mutation continuent à la vérifier.
6. **Relais local pendant une panne.** L'agent actif conserve sa cadence normale (15 secondes par défaut) en succès. Si toutes les réponses utiles sont en erreur réseau/402/429/5xx, il attend progressivement jusqu'à 120 secondes ; une institution joignable conserve la cadence normale et la reprise manuelle reste immédiate. Les exécutions restent exclusives. Cette correction de transport nécessitera la mise à jour du relais installé ; Vercel ne distribue pas le binaire local. Aucun mode de saisie des notes offline ni activation de LOT3/LOT4 n'a été ajouté.
7. **Lectures de rôle simultanées dans le navigateur.** Sidebar de secours et provider de capacité relais partagent désormais un appel `/api/auth/role` lorsqu'ils le demandent simultanément pour le même utilisateur. Aucun résultat n'est conservé après la requête. Le provider ignore une réponse d'un ancien utilisateur après changement de session.

Le cache de références de la première passe reste limité à classes (3 s) et institutions (15 s), 200 entrées, isolation par URL/en-têtes et invalidation avant/après écriture. Les champs et filtres d'identité, téléphones, secrets et `settings_json` sont explicitement exclus. Profils, rôles, séances, notes, QR et requêtes annulables ne sont pas mis en cache par ce mécanisme.

## Mesures réelles avant cette reprise

Fenêtre **9 octobre 2026, 17:00–18:00 UTC / Abidjan**, journal `edge_logs` du projet `nnxgxxktjvgnnbcedmvv`. Ce sont les compteurs bruts du projet, qui peut recevoir du trafic de production et de plusieurs Previews. Ils ne distinguent pas un utilisateur ou une version d'application et ne représentent pas une charge reproductible.

| Endpoint/table | Avant / h | Après réel / h | Réduction réelle |
|---|---:|---:|---:|
| `/auth/v1/user` GET | 2 569 | À relever après recette | Non mesurée |
| `/auth/v1/token` POST | 17, dont 1 HTTP 400 | À relever | Non mesurée |
| `profiles` GET | 487, dont 11 HTTP 400 | À relever | Non mesurée |
| `user_roles` GET | 1 815 | À relever | Non mesurée |
| `classes` GET | 1 473 | À relever | Non mesurée |
| `institutions` GET | 526, dont 133 HTTP 400 | À relever | Non mesurée |
| `relay_sync_devices` GET | 978 | À relever | Non mesurée |
| `relay_sync_devices` PATCH | 229 | À relever | Non mesurée |
| `teacher_sessions` GET | 1 838 | À relever | Non mesurée |
| `bulletin_qr_codes` GET | 0 sur cette fenêtre | À relever lors de consultation | Non mesurée |
| `bulletin_qr_codes` POST | 0 | À confirmer : 0 INSERT inutile | Non mesurée |
| Total projet, toutes méthodes/endpoints | 14 019 | À relever | Non mesurée |
| HTTP 200 | 13 641 | À relever | Non mesurée |
| HTTP 400 | 145 | À relever | Non mesurée |
| HTTP 402 | 0 | À relever | Non mesurée |
| HTTP 429 | 0 | À relever | Non mesurée |

Sur les 24 heures précédentes, des 402 sont visibles avant 13:00 ; le pic observé ensuite atteint 49 151 requêtes dans l'heure de 13:00. Aucune nouvelle requête QR n'est introduite et le correctif `v_tardy_minutes` n'est pas modifié. L'absence de consultation QR dans cette fenêtre ne prouve pas son fonctionnement : ce parcours doit faire partie de la recette.

Le quota ayant déclenché le passage Pro n'est pas identifié par ces journaux. Le nombre de requêtes n'est pas une mesure de la facture ; les tailles `content_length` sont incomplètes pour les réponses en flux. Aucune économie financière ni réduction horaire après correction n'est présentée comme acquise. L'utilisateur a choisi de réaliser lui-même la recette authentifiée ; ces mesures devront être complétées ensuite.

## Comparaison contrôlée du code, distincte du trafic réel

Même fixture exécutée sur une copie isolée de la production `d89a461e` et sur cette branche, réponses HTTP/BDD simulées :

| Scénario | Production | Preview | Résultat fonctionnel |
|---|---:|---:|---|
| 720 cycles de garde sans travail en attente | 720 appels HTTP | 0 | File vide, aucune suppression |
| 20 preuves de séances dans une requête | 20 lectures de séances | 1 | 20 preuves reconnues des deux côtés |
| 20 demandes simultanées de rôle pour le même utilisateur | — | 1 appel HTTP | Réponses indépendantes, prochain appel relu |

Les 720 cycles représentent une heure de cadence de cinq secondes, mais ce test n'est pas un relevé Supabase par heure. La comparaison a aussi confirmé que les refus d'accès ou une erreur BDD ne produisent aucune preuve positive.

## Validations

- 25/25 tests ciblés réussis : consommation, SDK réel de session avec réseau simulé, cookies, déduplication, isolation, cache de références et preuves de fin d'appel.
- Suite complète : **472 tests, 453 réussis, 19 échecs, aucun ignoré**. Les mêmes 19 échecs ont été reproduits sur une copie du commit exact de production : 18 dans le double de BDD de `student-transfer-regression.test.mjs`, 1 assertion de forme du wrapper dans `relay-grade-versioned-routing.test.mjs`. Les noms d'échecs ont été comparés et sont identiques.
- Typecheck local réussi ; build et contrôles CI finaux sont référencés dans la PR avec le commit et sa Preview.
- Lint des fichiers modifiés, y compris les nouveaux tests : **0 erreur, 1 avertissement existant** (`req` inutilisé dans la route slots). Lint global lancé : 136 erreurs/332 avertissements dans des fichiers inchangés, confirmé par comparaison avec la base.
- `npm audit --omit=dev` : **0 vulnérabilité** sur les versions de la production actuelle. `package.json` et le lockfile sont inchangés par cette reprise.
- La CI exécute désormais les tests dédiés à la consommation et les tests de session/cache dans le gate offline existant ; les contrôles relais, paie et notes Cloud-only restent en place.

Relance ciblée :

```sh
node --test test/supabase-consumption-regression.test.mjs test/supabase-server-auth-dedupe.test.mjs test/supabase-reference-fetch.test.mjs test/class-device-completion-proof.test.mjs
```

## Fichiers supplémentaires de cette reprise

`src/lib/class-device-access-server.ts`, `src/app/api/class/sync/reconcile-v2/route.ts`, `src/lib/class-device-sync-reconcile-v2.ts`, `src/app/class/ClassDeviceSyncGuard.tsx`, `src/lib/attendance-network.ts`, `src/app/providers.tsx`, `src/lib/auth/role-client.ts`, `src/components/RelayCapabilityProvider.tsx`, `src/app/admin/ui/shell.tsx`, `src/lib/supabase-reference-fetch.ts`, `desktop/relay/src/cloud-sync-grade-v4-safe.mts`, `test/supabase-consumption-regression.test.mjs`, `.github/workflows/offline-go-live.yml` et ce rapport. Les autres fichiers de la PR sont inventoriés dans le rapport du 7 octobre.

## Recette et risques avant fusion

1. Connexions admin, enseignant, compte classe et parent ; navigation rapide, rafraîchissement et déconnexion/reconnexion. Vérifier aussi un changement de rôle avec les comptes de recette : aucun droit ne doit survivre côté API à sa suppression.
2. Navigation admin classes, enseignants, EDT/HoraClasse, notes/registres, bulletins, QR, finance/reçus, internat, renforcement, vacation et paie. Les modules Finance et les calculs métier n'ont pas été modifiés.
3. Sur une classe de recette : démarrage d'appel, absences/retards, fin avec dernier reçu confirmé et cours suivant. Tester réseau normal, connexion lente, offline, retour online, PWA, avec et sans relais. Vérifier aussi les anciens journaux en attente et le bouton de reprise manuelle.
4. Laisser un compte classe ouvert sans action pendant une heure ; comparer son trafic à une session avec actions métier, noter les autres Previews actives et relever les endpoints/status du tableau. Conserver la session pendant un cycle d'expiration du token.
5. Pour vérifier le nouveau backoff du relais réel, installer le build correspondant sur le relais de recette. Une panne peut retarder la prochaine tentative automatique de 60 s sur le téléphone ou 120 s sur le relais ; la reprise manuelle contourne le délai. Les données en attente restent durables.

Aucune écriture de données Supabase, migration, `db push`, changement RLS ou modification de paramètres de facturation n'a été effectué. Les requêtes SQL ont uniquement lu le schéma et des statistiques. La production ne doit être fusionnée/promue qu'après validation de la Preview par l'utilisateur.
