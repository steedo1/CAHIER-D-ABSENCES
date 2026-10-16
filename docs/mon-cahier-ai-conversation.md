# Cahier IA : conversation et données de l’établissement

Le serveur conserve les réponses directes aux salutations et aux décomptes simples. Les autres questions sont confiées à un modèle conversationnel via Vercel AI Gateway. Le modèle choisit des outils de lecture ; il ne reçoit aucun accès SQL ni clé Supabase.

## Configuration serveur

- Node.js 22 ou ultérieur (le projet Vercel utilise déjà Node 22).
- `AI_GATEWAY_MODEL` : identifiant exact du catalogue Gateway. Le projet possède déjà cette variable pour preview et production ; aucune clé existante n’est remplacée par cette modification.
- Sur Vercel : authentification OIDC du déploiement, gérée par le SDK. Hors Vercel : `AI_GATEWAY_API_KEY` dans l’environnement serveur, jamais dans une variable `NEXT_PUBLIC_*` ni dans le navigateur.
- Les crédits, la vérification du compte et un éventuel budget Gateway restent des prérequis de l’équipe Vercel. Cette modification n’achète aucun crédit, ne crée aucune clé et ne change aucun budget.

Sans modèle configuré, les décomptes directs et les demandes pédagogiques explicites restent utilisables. Une question non comprise reçoit une explication sur la disponibilité du mode conversationnel ; elle ne devient plus automatiquement un résumé pédagogique. Une erreur du moteur configuré est signalée, avec un message distinct pour l’activation, les crédits ou la limitation de débit.

## Sources consultables

| Outil | Source et définition |
| --- | --- |
| `student_statistics` | Inscriptions actives dans les classes de l’année, élèves distincts ; indicateurs des fiches élèves pour les internes, le genre, les redoublants et l’affectation. Les statuts inconnus sont décomptés séparément. |
| `teacher_directory` | Comptes avec le rôle enseignant pour l’établissement ; enseignants distincts affectés aux classes de l’année. Les consultations détaillées donnent les noms, matières et horaires actuels, ou les séances d’appel horodatées sur 1, 7, 30 ou 90 jours. Un nom ambigu demande une précision et un appel manquant ne prouve pas une absence. |
| `school_calendar` | Année scolaire et périodes applicables, en réutilisant la résolution des calendriers par formation de Mon Cahier. |
| `pedagogical_analysis` | Constats anonymisés tirés des bulletins officiels, distinction des moyennes partielles et des zéros vides ; aucune probabilité de réussite ou indice de préparation. Les progressions du cahier de texte sont également consultables. |
| `student_attendance` | Totaux d’enregistrements d’absences et retards dans l’établissement, pour l’année en cours et la date actuelle. Une demande sur une classe ou une date historique ne reçoit pas ces totaux généraux. |
| `available_data` | Classes autorisées et domaines consultables, pour préciser une demande. |

L’établissement est déduit de l’utilisateur authentifié. Une classe passée à un outil doit appartenir à ce périmètre et à l’année choisie. Les lectures ne portent pas sur les contacts parentaux, mots de passe, codes d’activation ou coordonnées des enseignants. Les identités d’élèves ne sont pas envoyées au modèle : au maximum huit cartes nominatives sont affichées séparément dans l’application, uniquement si le suivi d’élèves est demandé. Une analyse pédagogique est limitée à douze classes par outil.

Les comptes enseignants inscrits ne constituent pas un historique annuel des contrats. Les inscriptions sont celles actuellement actives, et les statuts d’internat sont ceux des fiches actuelles. La date de référence ne reconstitue pas des statuts passés.

## Conversation, durée et coût

Le navigateur envoie au plus six échanges terminés. Le serveur limite chaque message à 2 000 caractères et l’historique à 12 000 caractères. Il ignore les rôles privilégiés et l’historique d’un autre utilisateur, établissement, année ou date, via une empreinte de contexte renvoyée au démarrage. Cette empreinte ne remplace pas les droits : chaque requête est authentifiée et les outils restent strictement bornés par le serveur. Une nouvelle discussion ou un changement de date efface l’historique local. Les faits sont relus à chaque tour ; les réponses précédentes servent seulement à comprendre le contexte.

Un tour peut comporter quatre appels de modèle au maximum, 1 200 jetons de sortie par appel et six lectures d’outils distinctes. Les appels identiques sont réutilisés pendant ce tour. Les lectures paginées refusent un résultat incomplet ; un dépassement ne devient pas un faux total. Les délais sont bornés, sans nouvelle tentative automatique du modèle. Un contrôle par instance limite les tours conversationnels à huit par minute et soixante par heure pour un utilisateur et un établissement. Ces limites ne remplacent pas un budget Gateway global ni une limitation de débit distribuée.

## Vérification

```bash
npm run test:mon-cahier-ai
NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit
npm run build
```

Les tests utilisent le vrai composant React, les routes et la boucle d’outils AI SDK avec un modèle simulé. Ils couvrent les questions des captures, les relances, les dates, les statuts inconnus, les droits et la séparation des établissements. Ils ne prouvent pas que les crédits ou l’authentification Gateway sont disponibles en production.

Avant publication, ouvrir la preview avec un compte administrateur de test : « Bonjour », « Combien d’enseignants ? », « Nombre total d’internes ? », « La date de fin du trimestre », puis « Et dans la 3e3 ? ». Vérifier la réponse du modèle et ses sources dans une session autorisée. Un appel réel peut consommer des crédits Gateway ; ne pas activer une recharge ou augmenter un budget pour ce contrôle.
