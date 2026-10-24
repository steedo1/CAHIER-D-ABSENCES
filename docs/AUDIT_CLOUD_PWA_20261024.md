# Mon Cahier — audit Cloud, PWA et « Autre cours »

Audit du 24 octobre 2026. Heures UTC, identiques à Africa/Abidjan.

## Conclusion et périmètre

La version de production contient plusieurs anomalies reproductibles. Il n'est donc pas justifié de déclarer l'ensemble du fonctionnement demandé « entièrement opérationnel ». Les correctifs sont proposés dans la [PR #224](https://github.com/steedo1/CAHIER-D-ABSENCES/pull/224), sans fusion, déploiement ni écriture dans les données scolaires réelles.

La validation du code et du laboratoire doit être distinguée d'une recette sur le téléphone du CSCA. Aucun accès au téléphone d'origine, à son IndexedDB ou à sa version de service worker n'a été fourni. Les séances et marques utilisées par les tests sont synthétiques.

## Versions réellement vérifiées

| Élément | Constat |
|---|---|
| Dépôt | `steedo1/CAHIER-D-ABSENCES` |
| Branche de production | `migration-render-test-20261021` |
| GitHub audité | `c68bae86eb4ae5d80840caca0b67ecf4044801b0`, revérifié après la reprise du travail |
| PR initiale | #223, fusionnée le 23/10 à 23:15:53 |
| Service officiel | `mon-cahier-test`, `srv-dbc291on74is73f4692g`, espace confirmé `My Workspace` |
| Déploiement réellement actif | `dep-dbdulcnavr4c739fmesg`, état `live`, même commit `c68bae86`, terminé le 23/10 à 23:19:35 |
| Déploiement automatique / previews | désactivés / désactivées lors de l'inspection |
| Branche corrective | `codex/audit-cloud-pwa-20261024` |
| Premier commit correctif | `0162e8ed66e84f4a1f06cd7c3e1499c7d1053e73` ; les contrôles finaux portent sur la révision indiquée dans la CI de la PR |
| Supabase | `nnxgxxktjvgnnbcedmvv`, interrogé en lecture seule |

Le domaine public a répondu lors de la consultation. Cela confirme son accessibilité, pas la réussite d'un appel authentifié. Aucun redéploiement n'a été déclenché pour l'audit.

## Résultats par fonctionnalité

Les statuts de cette table décrivent la production auditée. « Validée par tests » dans la dernière colonne concerne uniquement le correctif proposé.

| Fonctionnalité | Statut | Preuve et limite |
|---|---|---|
| Relais désactivé sur les nouveaux parcours | **VALIDÉE** dans le code et les tests ; **NON VÉRIFIÉE SUR APPAREIL** | `RELAY_LOCAL_DISABLED`, fournisseur de capacité, démarrage classe, préparation professeur/classe, synchronisation et déconnexion sont verrouillés. Une ancienne valeur locale ne réactive pas la capacité. |
| Journaux et reprise d'anciennes séances relayées | **VALIDÉE** pour la conservation et les tests ; **NON VÉRIFIÉE SUR APPAREIL** | Pas de purge, suppression de cache métier ou migration des opérations anciennes. Les chemins historiques restent présents. |
| Appel habituel commandé par l'EDT | **VALIDÉE** pour les cas automatisés ; **NON VÉRIFIÉE SUR APPAREIL** | Choix du créneau, de la matière et de l'enseignant testé. Le correctif impose aussi au serveur qu'une matière automatique figure réellement dans le créneau et que la durée provienne de l'établissement. |
| Interface sans « Cours prévu » | **VALIDÉE** dans le composant et les tests ; **NON VÉRIFIÉE SUR APPAREIL** | Un bouton « Autre cours » ; retour discret à l'appel normal ; choix explicite conservé tant qu'il reste valide. |
| Disciplines d'« Autre cours » dans une PWA | **ANOMALIE CONFIRMÉE** | Le service worker intercepte les requêtes sans `slot` provenant de `/class` et renvoie `items: []`, même avec `manual_course=1`. Correction testée avec le vrai code du worker, Cloud connecté et coupé. |
| « Autre cours » pendant / hors créneau | **VALIDÉE** au niveau API et composant, sous réserve de l'anomalie du worker ; **NON VÉRIFIÉE SUR APPAREIL** | La voie manuelle conserve l'heure réelle ; affectations datées et ambiguïtés contrôlées côté serveur. Elle n'écrit pas dans l'EDT. |
| Durée exceptionnelle | **ANOMALIE CONFIRMÉE** | Le serveur acceptait des valeurs dépassant la limite de l'UI ; le défaut pouvait dépendre de la durée du créneau. Correction : entier de 1 à 240 minutes ; défaut indépendant du créneau. |
| Clôture automatique exceptionnelle | **ANOMALIE CONFIRMÉE** | Un `period_id` pouvait faire gagner la fin de l'EDT sur la durée exceptionnelle. Le caractère exceptionnel est désormais persisté et restauré ; le calcul utilise cette durée et conserve la grâce existante de deux minutes. |
| Clôture manuelle / hors ligne | **VALIDÉE** par les tests de journalisation, d'ordre et de rejeu ; **NON VÉRIFIÉE SUR APPAREIL** | Les marques précèdent la clôture ; une marque bloquée empêche la clôture de la même séance. |
| Préparation « réussie » avec données manquantes | **ANOMALIE CONFIRMÉE** | Un roster malformé pouvait devenir une liste vide ; l'échec du chargement manuel était ignoré. La préparation refuse maintenant les élèves ou disciplines indispensables absents/incohérents, sans invalider brutalement l'ancien journal. |
| Horodatage des ouvertures anciennes | **ANOMALIE CONFIRMÉE** | Au-delà des 30 jours acceptés, le serveur pouvait substituer l'heure du rejeu. Le correctif répond 422 et conserve l'opération pour réconciliation ; une séance déjà reconnue par son ID déterministe reste récupérable. |
| ACK perdu puis cours suivant | **ANOMALIE CONFIRMÉE** | Le contrôle d'une autre séance ouverte pouvait empêcher de reconnaître une ouverture déjà appliquée et clôturée. Le correctif reconnaît d'abord l'opération existante, sans réécrire ses heures ou sa durée. |
| Deux ouvertures concurrentes | **ANOMALIE CONFIRMÉE** | Le contrôle HTTP suivi d'un INSERT n'était pas atomique. Les index existants ne protègent pas contre deux enseignants différents pour la même classe. Une fonction/trigger avec verrou transactionnel est proposée ; concurrence réelle vérifiée sur PostgreSQL local. |
| Deux cours successifs après une panne | **ANOMALIE CONFIRMÉE** | Le second pouvait rester définitivement bloqué par `class_session_already_open` pendant le rejeu par phases. Ce refus temporaire garde désormais l'opération en attente ; le worker continue à livrer/clôturer le premier et demande une reprise. |
| Sondage Cloud quand la file est vide | **ANOMALIE CONFIRMÉE** | Le réveil périodique pouvait sonder `/api/auth/role` toutes les 20 secondes sans rien à livrer. Le correctif vérifie d'abord les journaux locaux, y compris les anciens enregistrements sécurisés sur relais. |

### Autorisations

Les contrôles serveur du compte de classe et de son établissement sont conservés. « Autre cours » utilise les affectations valides au jour de la capture, y compris les dates de début et de fin. Une matière sans enseignant ou avec plusieurs enseignants actifs est refusée ; aucun remplaçant arbitraire n'est choisi. Les formations spécialisées gardent leur contrôle de programme/niveau. Les contrôles de présence des comptes enseignants ne sont pas contournés.

Le modèle actuel ne contient pas de nouveau calendrier d'autorisations horaires propre au bouton exceptionnel. L'audit ne prétend pas avoir validé une règle d'établissement qui ne serait pas configurée dans l'application.

## CSCA Aboisso — contrôle en lecture seule

Établissement `ee34ab2a-8033-4e0b-acf0-05979cce1697`, classe `3e1` de **2026–2027**, identifiant `cd8ae0a9-c8b1-434a-8d41-652fd9ebec84`. Une autre classe homonyme existe pour 2025–2026 ; elle n'a pas été confondue avec la classe courante.

Le contrôle retrouve **13 disciplines**, chacune avec **un enseignant actif unique** au 24/10 : Allemand, Anglais, EDHC, EPS, Français, Histoire-Géographie, Informatique, Latin, Mathématiques, Musique, Physique-Chimie, Religion et SVT. Les matières institutionnelles correspondantes sont actives.

Autres agrégats : 37 créneaux configurés dans l'établissement, 31 créneaux distincts utilisés par l'EDT de cette classe, 56 lignes d'inscription. Ce dernier nombre est un agrégat de table, pas une déclaration de validation de la liste active affichée sur un téléphone.

L'incident « Cloud connecté, discipline vide » reste explicable par le worker installé en production. Le blocage relais a été retiré du code des nouveaux parcours, mais l'état « téléphone prêt » doit être revérifié avec le worker effectivement installé et une préparation complète sur l'appareil.

## Opérations anciennes du 21 septembre

| Opération | Capture locale déclarée | Résultat serveur |
|---|---|---|
| `e103879b-f3f2-4c37-b252-5608eb1bdb77` | 21/09/2026 17:01:08 | aucune correspondance exacte dans les registres consultés |
| `efc05b91-76cc-49ce-ac21-55d5552c5193` | 21/09/2026 17:01:15 | aucune correspondance exacte dans les registres consultés |

Vérifications : `teacher_cloud_operation_receipts`, `relay_sync_operation_receipts`, `relay_entity_history`, `relay_entity_versions` et `relay_attendance_session_causality`. Aucune séance de la classe courante n'a été trouvée dans la fenêtre 16:45–17:15 ce jour-là. Deux séances Cloud existent ce matin-là, à 07:15 et 08:10 ; aucun lien avec les deux opérations n'est démontré. L'absence de reçu n'est pas une preuve qu'une opération n'a jamais été appliquée sous une ancienne convention d'identifiants.

**Décision : aucune purge, aucune réémission avec un nouvel identifiant, aucune assimilation automatique aux séances du matin.** Le téléphone d'origine doit fournir un export conservant :

- les deux lignes brutes de l'outbox : URL, méthode, corps, `operation_id`, métadonnées, état, nombre de tentatives, dernière erreur/réponse et dates ;
- `client_session_id`, `session_id` éventuel et table de correspondance client → serveur ;
- établissement, classe, compte technique, discipline, créneau, heure originale et durée ;
- journaux durables d'ouverture, de marques et de clôture associés ; tout accusé Cloud ou relais déjà présent ;
- version Web, version du service worker, fuseau et réglage de l'horloge du téléphone au moment de la capture.

Les journaux se trouvent notamment dans IndexedDB `moncahier_offline_v1`, ses magasins `outbox`, `kv` et `meta`, avec les clés `teacher:session-delivery:v1:…`, `teacher:attendance-delivery:v1:…`, `teacher:session-lifecycle:v1:…`, et les snapshots locaux de classe. L'export doit être conservé dans un emplacement privé : il peut contenir des données d'élèves. Ne pas désinstaller la PWA, effacer le stockage, déconnecter de force ou utiliser un bouton de purge pour tenter de résoudre ces deux lignes.

## Consommation et stabilité observées

### Render

Service à une instance, plan `free`, limite mémoire observée de 512 Mio et CPU de 0,15 cœur. Le processus est lancé avec un heap Node limité à 288 Mio. Aucun paramètre n'a été modifié.

Sur la fenêtre **23/10 23:30 → 24/10 05:00**, résolution 15 minutes : mémoire observée entre environ 248 et 319 Mio, maximum ≈62,4 % de la limite ; maximum des points CPU agrégés ≈0,058 cœur, soit ≈38,6 % de la limite. Les séries sont partielles et traversent plusieurs instances : elles ne constituent ni une mesure de pointe instantanée ni un test de charge en journée.

La recherche de journaux de niveau `error` sur 23:20–05:00 n'a renvoyé aucune ligne. Les métriques HTTP et de latence demandées étaient vides ; aucun p95 ni taux global d'erreur Render ne peut donc être affirmé.

### Supabase

Sur **23/10 23:20 → 24/10 05:00** : **21 253** entrées HTTP `edge_logs`, sans statut 4xx/5xx dans l'agrégation interrogée. Parmi elles : 512 lectures de `relay_sync_devices`, 336 mises à jour de heartbeat ; plusieurs tables de bootstrap sont lues environ 336 fois. Ce motif est compatible avec un ancien agent relais qui continue à synchroniser périodiquement. Il ne prouve pas que les nouveaux téléphones contactent un relais local.

Le verrou client Cloud/PWA ne désinstalle pas un ancien programme relais déjà en marche. Son arrêt éventuel doit attendre la sauvegarde et le rapprochement de ses journaux ; le chemin de récupération n'a pas été supprimé pour faire artificiellement baisser les compteurs.

La préparation froide conserve actuellement une lecture des disciplines pour chacun des 37 créneaux, avec une concurrence bornée à quatre. Les tests comptent 38 téléchargements pour ces créneaux et le roster, auxquels s'ajoutent les lectures d'identité, d'établissement, de révision, des disciplines manuelles et de séance ouverte, puis les fichiers du shell. Ce budget est issu du code et du laboratoire, pas d'une mesure réseau sur le téléphone. Une préparation est réutilisée ; vérification légère à 60 s et TTL de succès à 6 h. Le changement de créneau utilise une clé et des objets stables ; le tic d'affichage à 5 s n'implique pas à lui seul un nouveau chargement de disciplines.

Le correctif ne télécharge pas davantage de disciplines, ajoute une lecture ciblée d'identifiant de séance pour sécuriser l'ACK, et supprime les sondages Cloud inutiles avec file vide. Aucun gain chiffré de facture n'est annoncé sans mesure sur une période scolaire comparable.

### Anomalie de sécurité distincte

**ANOMALIE CONFIRMÉE : RLS désactivée sur `public.profiles` et `public.user_roles`.** L'inspection des privilèges confirme des droits étendus, y compris écriture, pour `anon` et `authenticated`. Les conseillers Supabase signalent également cette configuration. Cela interdit de conclure à une validation globale de la sécurité du produit. Aucun test d'exploitation ni modification de rôle réel n'a été effectué.

Cette configuration nécessite une correction dédiée des accès directs et des politiques, avec recette des connexions de chaque rôle. Activer brutalement les anciennes politiques d'urgence ou retirer des droits sans examiner leurs usages peut casser l'accès aux écoles. L'audit PWA ne les a pas modifiées. [Référence Supabase : policies présentes et RLS désactivée](https://supabase.com/docs/guides/database/database-linter?lint=0007_policy_exists_rls_disabled).

## Tests et preuves

- Les nouveaux scénarios exécutés contre le code historique `c68bae86` reproduisent 12 échecs sur un ensemble de 59 cas ; 47 cas restent réussis. Il ne s'agit pas d'une affirmation fondée uniquement sur la lecture du code.
- Premier lot correctif : 61 tests ciblés réussis, dont API d'ouverture, worker réel en machine virtuelle, préparation incomplète et absence de sondage avec file vide.
- PostgreSQL local 17 : deux connexions concurrentes, une seule ouverture ; le cours suivant est accepté après clôture. La migration est aussi exécutée dans PGlite avec contrôle des privilèges et préservation des cours groupés.
- La commande `npm run test:cloud-pwa` regroupe les régressions d'appels, autorisations de classe, horodatage, clôture, outbox, reconnexion, ACK, anciens journaux, PWA et comptes enseignants. Les anciens tests de relais ont été actualisés sans modifier leurs mécanismes d'autorisation.
- La CI vérifie le typage, cette suite, la concurrence PostgreSQL, le navigateur avec vrai service worker/IndexedDB, puis la compilation Next.js. Elle utilise des identités synthétiques et des URL Supabase invalides, sans secrets de production. L'historique Git est récupéré pour les tests reproduisant d'anciennes versions.
- Le disque local a saturé pendant l'installation des dépendances. Les résultats de typage/build faisant autorité sont ceux de la CI avec le lockfile exact, pas les premières commandes locales interrompues avec une installation partielle.

Les identifiants des exécutions finales et leurs résultats sont renseignés après la fin des contrôles. Le workflow est accessible depuis la [PR #224](https://github.com/steedo1/CAHIER-D-ABSENCES/pull/224/checks).

## Mise en production et retour arrière

Aucune migration n'a été appliquée au projet Supabase réel. La seule migration proposée est `supabase/migrations/20261024053353_class_exceptional_session_guard.sql` : fonction et trigger, sans nouvelle colonne, mise à jour de séance, purge ou modification d'EDT. Elle est `SECURITY INVOKER`, avec droits d'exécution publics retirés.

Après revue et réussite des contrôles, appliquer cette migration avant le code qui marque les nouvelles séances exceptionnelles. Conserver le commit actuel `c68bae86` comme point de retour. La migration documente le retrait du trigger et de sa fonction ; aucune suppression de données n'est nécessaire. Le code proposé ne réactive jamais le relais local et ne change aucune variable d'environnement de production.

## Recette restant à effectuer sur les vrais téléphones

**NON VÉRIFIÉE SUR APPAREIL**, même si toute la CI réussit : installation/mise à jour effective du worker ; préparation complète des comptes classe et enseignant ; sélection des 13 disciplines ; appel prévu, autre cours pendant un créneau, entre deux créneaux et hors créneau ; durée différente ; saisie hors connexion ; fermeture/réouverture de la PWA ; suspension Android/iOS ; alarme et clôture automatique ; retour Internet et disparition de la file uniquement après ACK exact.

La recette doit utiliser un environnement et des comptes de démonstration ou une séance scolaire réellement prévue et autorisée, jamais des fausses présences en production. Pour les deux opérations de septembre, commencer par l'export de conservation, puis rapprocher chaque charge utile et chaque identifiant avant toute décision.
