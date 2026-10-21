# Migration intégrale Mon Cahier — constat et correctifs préparés

Relevé du 21 octobre 2026, heures UTC / Abidjan. **Migration non validée ; production non modifiée pendant cette intervention.**

## Conclusion opérationnelle

La migration du code a conservé la base `ac615564` de `reprise-propre-5418ce7-20260729` et les correctifs Render ultérieurs. La comparaison ne révèle pas de remplacement par une ancienne application : les 27 fichiers différents portent principalement sur Render, RAM, redirections, photos et suivi des appels. En revanche, la configuration n'a repris que sept des 27 variables Vercel. Plusieurs services fonctionnels sont donc débranchés malgré un site accessible.

Service réel : `mon-cahier-test`, `srv-dbc291on74is73f4692g`, workspace `tea-dbc1ns9srm7s739bitug`. Branche de production `migration-render-test-20261021`, commit `44e180461f4d4414a2ae13b0ca76e9eea24932bb`, déploiement `dep-dbcaeorrjlhs73bbr0rg`. Auto-déploiement off, une instance free, limite 512 Mio. Aucun abonnement augmenté, service créé, schéma ou donnée scolaire modifié.

## Inventaire des preuves

| Domaine | État établi | Preuve / limite |
|---|---|---|
| Accueil et connexion direction | Accessibles | Accueil et écran de connexion parcourus réellement dans le navigateur ; aucune session scolaire authentifiée |
| HTTPS et domaine apex | Fonctionnent sur les routes sondées | HTTPS valide ; mon-cahier.com/login redirige vers www.mon-cahier.com/login, HTTP final 200 |
| Connexion parents | Écran accessible, backend dégradé | HTTP 200 écran ; PARENT_JWT_SECRET absent, création de session dépend explicitement de ce secret |
| Supabase | Accessible en lecture seule | Requêtes de métadonnées, compteurs et agrégats réels réussies ; ne prouve pas tous les droits RLS par rôle |
| Comptes super/admin/correspondant/prof/classe/parent | Recette réelle non vérifiée | Authentification scolaire non établie ; protection du navigateur bloque l'observation après la connexion Render. Aucun contournement de rôles ou création de compte |
| Appels CSCA | Activité réelle constatée, clôture dégradée | 36 teacher_sessions le 21/10 : 34 submitted avec ended_at ; 2 open, sans ended_at, bien après la fin prévue |
| Clôture automatique | Pas de garantie serveur autonome établie | Les deux appels ouverts sont de compte classe ; watcher du navigateur présent, aucun cron de clôture identifié ; pg_cron non installé |
| Matières / emplois du temps / synchronisation | Tests automatiques positifs, recette réelle restante | Tests multicycle, reprise et séquençage passent ; pas de nouvel appel fictif dans une classe réelle |
| Notes et moyennes | Tests automatiques positifs | Contrats de publication, saisies et règles de cycles couverts ; pas de saisie scolaire réelle ni de bulletin individuel modifié |
| Bulletins EPC français/arabe et secondaire | Code/règles présents, recette réelle restante | Paramètres school_cycles_v1, franco_arabic_reports_v1, primary_evaluation_events_v1 présents ; tests multicycle positifs |
| Modèles et impressions de bulletins | Recette réelle restante | Aucun remplacement des événements primaires par des trimestres ; rendu/PDF et comparaison visuelle à faire sur comptes autorisés |
| QR de bulletins | Configuration dégradée | BULLETIN_QR_SECRET absent ; conserver le secret historique avant de tester les QR existants. Tests QR locaux positifs ; aucun QR imposé au primaire |
| Attestations, photos, signatures | Correctif antérieur conservé, recette réelle restante | Helper d'origine des photos et tests présents ; aucun PDF réel régénéré dans ce lot |
| Push | En panne confirmée | /api/push/vapid renvoie une clé vide ; job de 09:35 échoue quatre fois HTTP 500 Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY |
| SMS Orange | En panne confirmée | CRON_SECRET et identifiants Orange absents ; job SMS de 13:10 : quatre HTTP 403 ; aucune émission de test |
| Finance : écritures et reçus | Recette réelle restante | Tests parents/encaissements isolés positifs ; aucun paiement réel exécuté |
| Orange Money en ligne | Non disponible dans le code actuel | Adaptateur de production non implémenté, limitation déjà présente avant Render ; distinct de l'envoi SMS Orange |
| Cahier IA / prédictions | Raccordement externe non vérifié | URLs MON_CAHIER_AI_SERVICE_URL / ML_PREDICT_URL absentes des inventaires ; un seul service Render listé. Pas de création payante autorisée |
| PWA | Ressources accessibles ; usage réel restant | Manifest et SW HTTP 200 ; installation, reprise réseau et mise à jour à vérifier sur téléphone/tablette |
| Autres modules : santé, DRENAET, fondateur, ressources, organisation | Présents dans le dépôt, non validés en production | Inventaire de routes du build disponible ; aucun succès annoncé à partir de la seule compilation |

Les deux sessions ouvertes relevées : TD2, début prévu 07:15, appel réel 07:28:31, durée 55 min ; 3e1, début prévu 10:15, appel réel 10:15:10, durée 55 min. Ces agrégats ne prouvent pas que toutes les marques de présence ont été livrées. **Ne pas fermer ni compléter les présences automatiquement sans examiner les données du téléphone et le protocole de synchronisation.** L'application utilise `teacher_sessions` pour ces appels ; la table historique `attendance_sessions` est vide et ne doit pas servir à conclure à une absence d'activité.

## Variables et dépendances à Vercel

Voir [variables.md](variables.md), tableau complet des 27 clés et dix clés à rétablir. Dix clés Render recensées, dont trois de runtime. Les défauts ont été vérifiés avant de proposer une copie. Le seuil de retard historique diffère du défaut actuel.

Vercel n'est plus l'hébergeur nécessaire à l'accueil sondé. Les workflows atteignent le domaine Mon Cahier, dont le service Render est confirmé dans le Dashboard. Restent :

- Authentification historique de cinq routes actives faisant confiance à x-vercel-cron : corrigée en proposition #197, pas en production.
- En-tête x-vercel-cron envoyé inutilement par les trois workflows ; quatre tentatives par exécution, alternance d'hôte et d'authentification, journalisation du corps de réponse. Un appel unique et vérifié est préparé séparément.
- VERCEL_URL dans les fallbacks push, SMS, dashboard super, /v/[code] et export des moyennes. Ces fallbacks ne sont pas une dépendance active si les origines publiques sont correctes ; leurs chemins de repli restent à tester.
- Release PWA fondée surtout sur NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA : raccordement à RENDER_GIT_COMMIT préparé, sans changer le schéma offline ni vider les caches métier.
- Fichier vercel.json : ne déclenche pas lui-même un service ; exclusions ajoutées aux branches de préparation. Ne pas supprimer l'ancien projet Vercel avant recette et retour arrière documentés.

## Tâches automatiques

Les workflows planifiés sont exécutés depuis **main**, commit `c599e66f347a0badb7c4ae9cb4303846cd9e29bd`. Une modification uniquement sur la branche Render n'actualise pas ces workflows actifs.

| Tâche | Déclencheur déclaré | Résultat observé / problème |
|---|---|---|
| /api/admin/attendance/alerts | GitHub attendance-alerts-cron.yml, */2 | Run 39585782283 du 21/10 10:36 réussi HTTP 200 ; sans CRON_SECRET Render, le bypass Vercel suffit actuellement. Des erreurs métier peuvent aussi être renvoyées HTTP 200 : statut vert insuffisant |
| /api/push/dispatch | GitHub dispatch-cron.yml, */5 + appels inline | Run 39578102869 09:35 échoué, VAPID absente ; inline bloqué faute de CRON_SECRET |
| /api/sms/dispatch | GitHub dispatch-sms-cron.yml, */5 + inline | Run 39605647673 13:10 échoué HTTP 403 ; secret Actions présent, secret Render absent |
| /api/cron/attendance/monitor | Aucun déclencheur planifié trouvé dans ce dépôt | URL différente des alertes ; ne pas confondre surveillance et clôture des séances |
| /api/cron/finance/monthly-reminders | Aucun déclencheur planifié trouvé | Ne pas activer sans valider la fréquence, les règles métier et l'idempotence |
| /api/founder/daily-summary | Aucun déclencheur planifié trouvé | Même défaut de sécurité que les autres routes ; ne pas créer un second job aveuglément |
| WhatsApp | Routes historiques désactivées | Désactivation conservée ; gardes sécurisées sans remise en service |

Sur les douze derniers runs planifiés listés, les horaires ne respectent pas des intervalles réels de deux/cinq minutes. Le cron déclaré n'est donc pas une garantie pour la première surveillance à 7 h 30. Cause du retard de déclenchement non établie ; aucun nouveau service payant créé. Vérifier la page Actions et l'état des workflows avant décision sur le mécanisme de planification.

Le helper proposé refuse les anciennes URLs Vercel et les mauvais chemins, canonicalise apex vers www **avant** d'ajouter le secret, refuse les redirections suivantes, vérifie `ok: true` dans le JSON, n'affiche pas les réponses privées et ne rejoue pas un POST ambigu. Il dispose d'un mode de validation sans requête réseau. Aucun de ces tests ne déclenche de tâche réelle.

## RAM et requêtes Supabase

Trois événements oomKilled confirmés à 07:07:58, 07:11:44 et 07:15:41 UTC, limite 512 Mio. Aucun nouvel événement server_failed dans la liste relue, mais pas de garantie de stabilité durable.

RAM de production, même version : 293 990 400 octets à 12:00, maximum échantillonné 407 097 340 à 13:40 ; 429 125 630 à 14:10, 418 844 670 à 14:20. CPU initial modéré dans la fenêtre échantillonnée. Aucune mesure avant/après une nouvelle correction déployée, puisque rien n'a été déployé.

Reproduction locale isolée, 120 requêtes, concurrence 2, 20 classes/1 200 élèves synthétiques, heap 288 Mio : statuts attendus corrects, pic RSS OS 448,95 Mio, dernier RSS 285,84 Mio. TypeScript et SWC non chargés dans le runtime ; webpack chargé. Node local 24.19.0, Next installé 15.5.27 : **ce test ne reproduit pas exactement le Node Render ni la charge PDF/7 h 30**. Il montre une marge limitée sous 512 Mio, pas une fuite mémoire prouvée ni sa résolution.

Le premier contrôle TypeScript avec le heap local par défaut a épuisé environ 2 Gio. Avec heap de compilation 4 Gio, typecheck et build réussissent. Cela concerne le poste de compilation, pas la RAM runtime de Render ; aucune hausse de plan recommandée à partir de ce seul résultat.

Journaux HTTP Supabase, 21/10 07:00–14:00 : 23 792 user_roles, 22 150 auth/v1/user (204 erreurs), 19 117 classes, 13 602 attendance_schedule_revisions, 11 472 institution_periods, 10 257 academic_years, 9 982 institution_subjects, 9 958 profiles, 7 643 relay_sync_devices. Les consultations fréquentes de préparation/révision/relais et les relectures d'authentification sont des pistes concrètes. Ces volumes couvrent tout le projet et ne sont ni un relevé de facturation ni une attribution certaine à un appareil ou à Render. Les compteurs PostgreSQL cumulés depuis 2025 ne doivent pas être interprétés comme ceux de la journée.

Des modifications d'un audit Supabase antérieur sont présentes dans une autre copie de travail (`/workspace/var/mon-cahier-audit`) mais non intégrées à la branche Render ; elles n'ont pas été écrasées, reprises aveuglément ni présentées comme livrées. Leur revue et leurs mesures restent nécessaires avant de revendiquer une réduction.

Files de notifications : 100 pending au relevé ; 42 706 error historiques dont 42 689 no_subscriptions. Ne pas remettre les erreurs en attente en masse. Aucune purge, modification ou resynchronisation forcée réalisée.

## Correctifs préparés et validation

1. **PR #197**, branche `fix/render-cron-auth-20261021`, nouveau commit `5de22546a23518130daa1c3743a02b5f6218c3c9` : couvre les cinq routes actives vulnérables et les deux routes WhatsApp, avec contrôle du dispatcher SMS déjà protégé. Toujours en brouillon, non fusionnée, non déployée.
2. **PR #199**, branche `audit/render-infra-20261021` : /api/health sans accès base métier, secret ou notification ; release PWA raccordée à Render au build ; configuration Next du webhook alias Orange rendue explicite ; outil local d'audit des variables sans valeurs. Blueprint seulement proposé, non appliqué sur le service manuel.
3. **PR #200**, branche `fix/render-scheduled-jobs-20261021`, commit `85285f36f8251d500e147d5a62c2c726c985cd07` : helper, tests et trois workflows préparés séparément pour **main** ; aucun changement des tâches actives avant validation coordonnée avec la configuration Render. Les trois fichiers YAML sont vérifiés et le lancement manuel reste sans réseau par défaut.

Résultats détaillés dans `tests.json` : 327/327 tests multicycle de la version actuelle ; 91/91 tests parents ; 112/112 appels/reprise/QR ; 8/8 gardes de sécurité ; 4/4 tests release/health/préflight ; 4/4 tests du client cron unique. Certaines suites ont des scénarios qui se recoupent : ne pas vendre leur somme comme autant de fonctions distinctes vérifiées.

Build de sécurité et typecheck avec heap 4 Gio réussis. Build infra réussi, /api/health inclus ; avertissement historique Edge/Supabase restant. Le défaut d'analyse de dynamic/runtime sur l'alias webhook Orange est corrigé dans ce lot. Le build ignore ESLint par configuration existante ; un **lint ciblé séparé** des fichiers modifiés du lot infra et du client cron a réussi sans erreur ni avertissement. La suite ciblée infra/offline passe 51/51, dont 43 scénarios offline existants et huit tests infra/cron.

Non effectués : recette des comptes réels, SMS/push vers destinataires autorisés, impression et contrôle visuel des PDF réels, paiement réel, test de mise en veille/reprise/changement d'appareil en classe, pointe du lendemain 7 h 30, comparaison de consommation après déploiement. Aucun compte de test créé dans une école réelle.

## Activation proposée et retour arrière

Demander validation explicite avant de modifier la configuration active, fusionner #197 ou déployer : ce service est la production et le rétablissement CRON/VAPID/Orange peut déclencher la livraison de messages existants.

Ordre : conserver le commit/déploiement 44e1804 ci-dessus ; contrôler les messages pending ; comparer les origines communes et vérifier les secrets sans affichage ; rétablir les dix clés justifiées avec leurs valeurs historiques ; tester la configuration sans envoi ; intégrer les correctifs validés ; reconstruire et déployer de façon surveillée ; vérifier login, parents, QR existants, photos, matières, appels et health ; seulement ensuite valider les envois sur des destinataires expressément autorisés et les tâches réelles. Aucune automatisation de fermeture de séance ou correction de marques scolaires sans analyse spécifique.

Le lot de workflows doit être intégré sur main pour prendre effet ; ne pas fusionner l'intégralité de l'ancienne branche main dans la branche Render. Garder l'auto-déploiement Render désactivé durant la recette. Ne pas appliquer render.yaml comme une nouvelle infrastructure : service manuel existant.

Retour arrière : remettre le commit/déploiement 44e1804 sur le même service avec la commande runtime actuelle, ne pas basculer DNS vers Vercel suspendu. Revenir séparément sur les commits de workflows si nécessaire. Pour la configuration, conserver les dix clés initiales et ne retirer que les dix clés ajoutées si une régression est attribuée au lot ; aucune rotation de Supabase, JWT, VAPID ou QR. Le retour de code n'annule pas un SMS envoyé : d'où le contrôle préalable des files. Aucune migration SQL à annuler dans ces lots.

La clôture de l'issue #198 reste conditionnée à la recette réelle et aux mesures. Ce rapport établit les faits et les limites ; il ne certifie pas que Mon Cahier est déjà entièrement rétabli.
