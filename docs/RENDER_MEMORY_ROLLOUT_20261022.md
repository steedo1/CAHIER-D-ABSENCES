# Plan de déploiement sécurisé — incident Render RAM du 22 octobre 2026

## Identification CRITIQUE
- **Production réelle** : service Render nommé `mon-cahier-test` (nom trompeur), ID `srv-dbc291on74is73f4692g`, domaine officiel `www.mon-cahier.com`.
- Render : **512 Mio de RAM**, instance Free, Francfort, autoDeploy **désactivé**.
- Commit actuellement en production (vérifié Render) : `5c2850ceadfd77ca965666d8303f90790ae1a64e`.
- Dernier déploiement stable déclaré `live` : `dep-dbchsm9srm7s73b43620`.
- Branche actuellement reliée au service : `migration-render-test-20261021`.
- Correction proposée sur branche isolée : `fix/render-memory-bulletin-20261022`, PR **#210** vers `migration-render-test-20261021`. PR brouillon pour empêcher une promotion accidentelle.
- Preuves de panne : OOM 09:00:40, 09:25:30, 10:57:02 et 13:48:16 UTC le 22/10/2026.
- Mesure en production : **~463 Mio** à 14:26 UTC ; marge instantanée ~49 Mio (mesure ponctuelle, pas un maximum).

## Correctif préparé
- Le serveur ne fabrique plus toutes les images PNG QR de la classe en parallèle ; concurrence locale bornée à **deux** tâches par requête.
- Les avertissements pour URLs QR surdimensionnées sont agrégés ; l'URL et le token sont conservés pour éviter une régression de vérification.
- Aucune écriture DB, migration SQL, changement d'environnement ou changement des calculs.
- TypeScript, 29 tests QR et build Next.js validés dans GitHub Actions :
  - `https://github.com/steedo1/CAHIER-D-ABSENCES/actions/runs/39795490039` sur le commit `e8d2b007` : **success**.
  - `https://github.com/steedo1/CAHIER-D-ABSENCES/actions/runs/39793484822` sur `7ded8682` : **success**, dont suite multicycle et compilation.
- **Non démontré** : baisse mémoire en production. Le plafond de 2 est par requête, pas global à toutes les requêtes.

## Préparation obligatoire
1. Confirmer dans Render que l'environnement actif est bien celui servant `www.mon-cahier.com`. Le propriétaire confirme cette association ; ne jamais utiliser ce service pour tests de charge.
2. Photographier/relever la version live, RAM, erreurs OOM, domaines et état de la PWA. Relever les métriques et les événements en lecture seule.
3. Maintenir `5c2850ce` récupérable sans réécrire l'historique : créer au besoin une branche GitHub `rollback/render-prod-20261022-5c2850ce` pointant dessus.
4. Préparer un environnement séparé, isolé des écoles et de la base de production, **sans coût ou changement financier sans accord** ; sinon substituer des essais synthétiques hors Render.
5. Tester une classe 30–120 élèves, QR court, QR long, bulletin avec NC, aperçu, impression PDF, scan d'anciens QR, bulletin secondaire, primaire franco-arabe sans QR, autorisations inter-établissements.
6. Revoir les logs, vérifier qu'aucune erreur critique n'a été introduite.

## Promotion — uniquement après validation explicite
1. Revalider la tête de PR #210, tests et diff par rapport à `5c2850ce`.
2. Fusionner la PR dans la branche reliée au service **seulement** une fois les contrôles terminés.
3. Render a `autoDeploy=no` ; déclencher manuellement le déploiement du nouveau commit (sans modifier plan, variables d'environnement ni domaine).
4. Contrôler que le nouveau commit est marqué `live`; vérifier `www.mon-cahier.com`, authentification de test autorisée, toutes les routes critiques, santé des sessions, données d'établissement.
5. Pendant l'observation, relever les mesures de RAM à **résolution 60 secondes**, CPU, temps API, erreurs QR et OOM. Comparer des scénarios comparables à ceux d'avant le déploiement.
6. Si les OOM persistent ou qu'une fonctionnalité critique régresse : **arrêter la promotion**, préparer une réversion Git non destructive de la modification depuis une branche dédiée, déployer le commit de correction inverse et vérifier le retour du site. Ne pas forcer une branche de production sans contrôle explicite.

## Critères de clôture
- Pas de nouveau `server_failed` OOM lors des essais et observations représentatifs.
- Moyenne et pics de RAM objectivement réduits avec une marge suffisante. **La marge n'est pas garantie à tous les trafics** par un simple test.
- Les bulletins, QR secondaires, impressions, listes de classes, appels, notes et isolation entre écoles fonctionnent.
- Aucune augmentation anormale des requêtes Supabase ; pas de nouvel avertissement critique.
- Documenter honnêtement tout risque persistant.

**État au 22/10/2026 : code corrigé + CI réussie, mais aucune promotion ni validation de RAM sur Render ; la production fonctionne encore sur `5c2850ce`.**
