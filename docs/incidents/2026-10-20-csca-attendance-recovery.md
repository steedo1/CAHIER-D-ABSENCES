# CSCA — synchronisation et clôture des appels : correctif proposé

Date : 20 octobre 2026. **Version de revue, non fusionnée, non déployée en production.**

## Référence vérifiée

- Dépôt : `steedo1/CAHIER-D-ABSENCES`.
- Branche cible : `reprise-propre-5418ce7-20260729`.
- Commit réellement déployé et point de départ : `8b7cddc1d9fc90347639b0e48fa881700c64f40a`.
- Déploiement Vercel inspecté : `dpl_ACfrC1owXyQhCmCjMp94U8g3xvy4`, `READY`, `target: production`.
- Branche du correctif : `fix/csca-attendance-recovery-20261020`.
- Supabase : `nnxgxxktjvgnnbcedmvv`. Toutes les consultations pendant cette intervention sont des lectures. Aucune DDL, migration, clôture manuelle ou modification des présences n'a été exécutée.

## Preuves de l'incident

Séance `79223412-a6e3-5d62-8164-6093d125d7f5`, 1A, M. BROU BONI ARMEL, 19/10/2026, 10:15–11:10. Échéance automatique : **11:12 UTC**, identique à l'heure ivoirienne.

Dernière lecture effectuée pendant l'audit :

| Fait | Valeur |
|---|---|
| État | `open` |
| Fin | `NULL` |
| Démarrage réel | 19/10 à 10:31:11.371 |
| Création cloud de la séance | 19/10 à 14:33:48.117737 |
| Capture du dernier appel reçu | 19/10 à 11:12:00 |
| Opération reçue | `mvf5ns5p_392q106gmol` |
| Empreinte du reçu | `6d661d2891649f83d041adc0c39123d7` |
| Réception du dernier appel | 19/10 à 14:33:50.199563 |
| Exceptions élèves conservées | 1 absence |

Le 20/10, la séance de PERE HANS ADJOBI en 1A est capturée à **07:20:06.176**, créée dans le cloud à **07:55:16.166102** : environ **35 min 10 s** entre capture et réception. L'API ne pouvait pas observer cet appel pendant cette attente.

Les quatre lignes de la tablette proviennent du diagnostic fourni. Nous n'avons pas extrait leurs corps JSON réels depuis l'appareil : leur identité de contenu devra être vérifiée par la réconciliation, jamais présumée.

## Causes démontrées dans le code

1. **Verrou circulaire appel → fermeture.** Le SQL `apply_relay_attendance_call_v2` refuse une capture identique sous un autre identifiant (`attendance_operation_ambiguous`). La réconciliation v2 exigeait une séance déjà fermée avant de comparer le contenu d'une opération ayant un autre identifiant. L'outbox, à juste titre, retenait sa fermeture tant que l'appel était bloqué. Chaque côté attendait l'autre.
2. **Référence mal interprétée.** Sans UUID nu dans le corps, `client:<UUID cloud>` était systématiquement traité comme un identifiant d'ouverture à transformer en un nouvel UUID déterministe. La véritable séance ne pouvait alors pas être retrouvée.
3. **Ancienne séance restaurée.** `isTeacherSessionLocallyFinalized` consultait uniquement le journal de cycle de vie. Les fermetures Cloud-only déjà sécurisées dans l'outbox n'étaient pas reconnues par ce garde-fou. Une réponse cloud encore `open` pouvait donc restaurer une séance localement terminée et provoquer une nouvelle finalisation au réveil.
4. **Surveillance trop affirmative.** La matrice traduisait l'absence de réception par une carte rouge `OFF` et « aucun appel commencé ». Cette conclusion ne peut pas être tirée lorsque le téléphone est hors ligne ou que la transmission attend.

Le calcul de l'échéance dans `attendance-auto-close.ts` et sa surveillance dans `useAttendanceAutoClose.ts` possédaient déjà le bon principe : fin officielle + 2 minutes et vérification au réveil. Ils n'ont pas été réécrits.

## Correctif retenu

- Preuve d'un doublon par **capture identique et empreinte de la totalité du payload canonique**, présents compris, ainsi que les absences, retards et commentaires. Même identifiant seul insuffisant. Les fractions de seconde PostgreSQL sont conservées dans la comparaison.
- Sérialisation de l'empreinte identique au `jsonb::text` PostgreSQL utilisé par la fonction existante ; comparaison vérifiée sur PostgreSQL et dans une base de test isolée. Aucune modification de la fonction SQL.
- La preuve peut confirmer un appel d'une séance **encore ouverte**. Elle accuse réception du doublon ; elle ne le réapplique pas, ne renvoie pas de notification et ne modifie aucune présence.
- Résolution d'un alias UUID uniquement dans l'établissement, la classe et le créateur autorisés. Les références d'ouverture à UUID continuent à fonctionner. Si les deux interprétations désignent deux séances autorisées distinctes, aucun choix n'est deviné.
- Enregistrement du mapping d'une référence prouvée même si sa fermeture attend encore. La fermeture est ensuite envoyée par son circuit existant, après confirmation de tous les appels de cette séance.
- Une reprise ciblée d'une ancienne opération `attendance_operation_ambiguous` ou `session_closed` est possible par la page ou le service worker, **une seule fois par ligne après mise à jour**. Elle conserve l'identifiant, l'heure et les marques. Une différence réelle conserve le conflit ; les autres erreurs 409 restent bloquantes.
- Conservation locale de l'association entre opération reconnue et reçu cloud avant retrait de la ligne acquittée. Une panne de stockage conserve l'opération en attente. Les journaux durables existants sont confirmés, pas purgés.
- Prise en compte des fermetures déjà présentes dans l'outbox par le garde-fou de restauration, pour les comptes classe et les téléphones enseignants.
- Réconciliation par lots de 100 pour respecter la limite de l'API et éviter un blocage permanent des grandes files.
- Matrice : affichage neutre **« NON REÇU »**, sans clignotement rouge, avec consigne de vérifier la synchronisation. Les vrais démarrages et les preuves du relais gardent leur priorité. L'API cloud expose aussi `reception_status` (`received`, `started`, `unconfirmed`) sans modifier ses statuts historiques.
- Nouvelle release du service worker ; schéma IndexedDB et noms des caches conservés.

Les autorisations, contrôles d'inscription, vérification de présence des enseignants, règles de conflit et séparation entre établissements restent applicables. Aucune condition CSCA spécifique n'est introduite.

## Traitement des quatre opérations de 1A

| Opération locale | Traitement sûr après validation et installation |
|---|---|
| Fermeture `mvf5ns69_mocuckc4m8o` | Reste conservée jusqu'à confirmation des appels liés ; envoi de l'heure de fin déjà enregistrée dans son corps. |
| Appel bloqué `mvfcuheg_gxid7kcdeu6` | Résoudre l'alias vers la séance autorisée ; comparer sa capture et son empreinte au reçu cloud. Accuser réception uniquement si égalité exacte, sans réapplication. Sinon conserver le conflit. |
| Appel `mvgc9i1l_qcfjyzbky5n` créé le 20/10 | Même vérification, sur la séance du **19/10**. La date de création de l'opération ne change ni le jour du cours ni l'heure de capture. Une correction différente demeure protégée. |
| Fermeture `mvgc9i2e_y4j6tk2j7tt` | Après confirmation des appels, le circuit existant reconnaît la fermeture déjà appliquée de façon idempotente. La simulation n'effectue qu'une seule écriture de clôture. |

Il n'y a aucun script SQL de « réparation » à lancer en production. Les corps réels seront confrontés aux reçus au retour de la tablette. Ne pas effacer les données du site, désinstaller la PWA ou supprimer les lignes de diagnostic pour débloquer l'écran.

## Fichiers

Code modifié :

- `src/lib/server/attendance-receipt-proof.ts` : preuve canonique exacte.
- `src/app/api/class/sync/reconcile-v2/route.ts` : preuve ouverte, références et métadonnées du reçu.
- `src/app/api/teacher/attendance/bulk/route.ts` : reconnaissance d'un doublon après les contrôles existants.
- `src/lib/class-device-sync-reconcile-v2.ts` : mappings prouvés, traces des acquittements et lots bornés.
- `src/lib/offline.ts` et `public/moncahier-sw.js` : reprise ciblée et association atomique d'un reçu lors de l'acquittement.
- `src/lib/teacher-session-lifecycle-delivery.ts` : garde-fou de restauration des fins déjà en file.
- `src/lib/admin-attendance-monitor.ts`, `src/app/admin/absences/appels-matrice/page.tsx`, `src/app/api/admin/attendance/monitor/route.ts` : présentation honnête des réceptions inconnues.
- `src/lib/offline-release.ts` : release du worker.

Audités sans modification : calcul et hook de clôture, pages classe et enseignant, route de fermeture classe et lecture/fusion du relais. Aucun module financier, de notes ou de bulletins n'a été modifié.

Tests ajoutés/adaptés : `attendance-1a-recovery.test.mjs`, `teacher-attendance-bulk-offline-route.test.mjs`, mocks de réconciliation et deux contrats de présentation/restauration. Workflow dédié : `.github/workflows/attendance-recovery.yml`.

## Validation technique

- Suite ciblée du workflow : **105 tests réussis, 0 échec**.
- Suite élargie : **408 tests, 399 réussis, 9 échecs**. Les neuf mêmes échecs ont été reproduits sur un worktree propre du commit de production, avant le correctif : 394 tests, 385 réussis, 9 échecs. Ils ne sont pas masqués ni modifiés pour obtenir du vert.
- Quatre échecs historiques nécessitent des objets Git anciens absents de ce clone local (tests de cache/authentification). Trois autres concernent les identifiants/comptes classe, un une attente de politique d'ouverture et un une attente de disponibilité de sonde réseau. Leurs implémentations n'ont pas été changées ici.
- Compilation de production Next.js et vérification TypeScript : réalisées avec configuration Supabase **factice**, sans identifiants de production. Avertissements préexistants sur Supabase/Edge et les exports de routes Orange conservés.
- `git diff --check` : sans erreur.

| Scénario demandé | Vérification |
|---|---|
| Ouverture puis fin hors ligne | Tests existants de file ordonnée et cycle classe/enseignant |
| Appel reçu, fin bloquée | Simulation des quatre lignes de 1A, avec routes réelles et IndexedDB simulé |
| Même capture, identifiants différents | Preuve d'égalité et rejet des contenus différents ; SQL réel en base isolée |
| `client:<UUID serveur>` | Résolution autorisée, refus hors tenant/créateur et refus d'ambiguïté |
| Anciennes opérations au redémarrage | Garde-fou sur les fins de l'outbox et simulation des quatre lignes ; 105 anciens appels en lots |
| 409 puis réconciliation | Reprise de page et worker, un seul essai de preuve, conservation d'un conflit non prouvé |
| Synchronisation plusieurs heures après | Identifiant, capture et fin initiaux conservés ; réception réelle tardive confirmée en lecture |
| Cours suivant avec ancien conflit | File indépendante synchronisable, ancienne opération conservée |
| Appareil suspendu | Minuterie simulée et reprise focus/pageshow/visibilité, heure d'échéance initiale conservée |
| Fin manuelle avant échéance | Tests du verrou partagé et annulation de la minuterie |
| Téléphones professeurs et classe | Route bulk exécutée pour les deux identités ; tests existants de finalisation |
| Avec/sans relais | Tests des circuits relais, cloud, outbox, cache et fusion de surveillance |

**Limite matérielle explicite :** aucun test n'a été effectué sur la tablette Android physique. Quand Android tue complètement la PWA, aucun JavaScript de cette application ne peut garantir une exécution à la seconde prévue. À sa reprise, la finalisation doit garder l'heure théorique fin + 2 minutes et transmettre les données conservées. La recette réelle ci-dessous reste nécessaire ; ce rapport ne prétend pas prouver un déclenchement en arrière-plan d'une application arrêtée par le système.

## Complément : consultation et modification des emplois du temps

À la demande d'Ange Aristide, la livraison inclut une correction ciblée dans Organisation scolaire → Emploi du temps → Saisie manuelle.

- Chaque case indique les matières, professeurs et classes, sans les remplacer par un nombre de « cours occupés » et sans masquer les autres professeurs pendant une modification.
- Un créneau peut être consulté avant de choisir une matière et un professeur. Le bouton « Modifier ce cours » charge le couple matière/professeur et les cases déjà enregistrées dans l'éditeur existant. Les changements nécessitent toujours « Enregistrer pour ce professeur ».
- Le panneau est disponible sur ordinateur et sur mobile. Il protège le brouillon quand on choisit un autre cours ; un chargement en cours, invalide ou échoué ne permet pas un enregistrement vide. Une réponse ancienne est ignorée après changement de périmètre.
- La route de lecture fournit les occupations du périmètre même sans filtre de classe. Les libellés d'un cours existant restent disponibles après la fin de son ancienne affectation. L'établissement, l'année active et les filtres pédagogiques restent appliqués. Les contrôles d'affectation de l'API d'enregistrement restent en place.
- Fichiers : `src/app/admin/import-emplois-du-temps/page.tsx`, `src/app/api/admin/timetables/meta/route.ts`, deux tests `test/timetable-course-{editor,meta}.test.mjs`, workflow ciblé complété.
- Résultat final du workflow combiné en local : **113 tests réussis sur 113**, compilation Next.js et TypeScript réussies.
- Vérification : tests d'interaction React avec transport isolé (consultation, déplacement, payload de sauvegarde, autres cours/classes préservés, erreur réseau et réponse tardive) et exécution de la route GET réelle sur données synthétiques (droits, périmètre, année, établissement, libellés).
- Limite : contrôle visuel Chromium non effectué dans cet environnement, le navigateur local étant indisponible. Le test physique sur téléphone/tablette reste à réaliser.
- Le test historique `printed roster puts the four blank note columns together at the far right` échoue aussi sur la base de production : il attend un balisage statique Note1–Note4 alors que la liste utilise déjà des colonnes dynamiques. Aucun fichier de liste de classe n'est modifié par ce complément.

La fusion et la livraison Vercel ont été explicitement autorisées dans la conversation du 20 octobre 2026, après ajout de cette correction. Aucun DDL ni correction SQL de données de production n'est prévu.

## Recette avant mise en production

1. Vérifier que la PR cible la branche de référence et comparer son point de départ au commit encore déployé. Si la production a changé, refaire le rapprochement et les tests sur cette nouvelle référence avant toute fusion.
2. Lancer le workflow `Attendance receipt and automatic close recovery`. Vérifier le détail des autres checks ; distinguer les échecs préexistants identifiés, sans les déclarer réussis.
3. Tester une version isolée avec des comptes et données de test : appel avec un absent, un retard et tous les autres présents ; couper le réseau, laisser passer l'échéance, verrouiller puis rouvrir. Vérifier fin + 2 minutes, contenu conservé et une seule clôture effective.
4. Reproduire une fin manuelle et un changement de cours ; relancer la PWA et vérifier qu'aucun ancien cours n'est rouvert et qu'aucune correction non confirmée n'est perdue.
5. Simuler un retard réseau et contrôler la matrice administrateur : « NON REÇU » tant qu'aucune source ne peut confirmer le démarrage ; démarrage visible dès qu'un fait cloud/relais est reçu. Aucun faux démarrage ne doit être inventé.
6. Tester au moins un établissement sans relais et un circuit avec relais. Vérifier des comptes distincts et le cloisonnement entre établissements.
7. **Après accord explicite seulement**, fusionner/déployer le commit validé. Sur la tablette 1A, obtenir la nouvelle release sans vider IndexedDB, puis lancer la synchronisation. Conserver le diagnostic initial et vérifier les quatre acquittements et les traces de rapprochement.
8. Contrôler en lecture : même séance du 19/10, absence intacte, heure de capture intacte, `submitted`, fin conforme à l'opération effectivement confirmée ; absence de nouvelle séance du 20/10 créée pour cet ancien appel.

Si les corps d'une opération réelle diffèrent du reçu, elle doit rester visible pour examen : ne pas la forcer, la dater à l'heure courante ou fermer la séance par SQL.

Le SHA du correctif, les résultats CI et le lien de PR figurent dans la livraison GitHub. L'autorisation de fusion et de livraison Vercel a été donnée par Ange Aristide le 20 octobre 2026.
