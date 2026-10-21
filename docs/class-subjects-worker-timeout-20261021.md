# Matières de l’appel — délai de lecture PWA

Le service worker interrompait `/api/class/subjects` après 2,5 secondes et fabriquait une réponse 503. La page acceptait pourtant huit secondes et la préparation pouvait nécessiter davantage. Une réponse Cloud valide reçue après ce délai devenait donc une panne apparente, y compris sur un téléphone déjà préparé.

Un test exécute le véritable service worker dans un contexte isolé avec une horloge contrôlée et un réseau simulé : avant correction, une matière disponible en 3,5 secondes et un créneau disponible en douze secondes donnent tous deux 503. Après correction, les deux réponses sont conservées, avec une seule requête par lecture.

## Changement

- Aligner le délai du worker sur huit secondes pour l’écran d’appel et vingt secondes pour `offline_preparation=v1`.
- Donner vingt secondes aux lectures de préparation classe, comme pour la préparation enseignant existante. La reprise reste limitée à une tentative supplémentaire sur panne transitoire ; les refus d’authentification ne sont pas répétés.
- Actualiser la release du worker, en conservant les noms de cache v2, le schéma hors ligne 1, le stockage et les opérations en attente.
- Conserver les réponses Cloud 401/403/409/503, les contrôles de révision, de classe et de compte, et l’interdiction de substituer une matière générale au cours du créneau.
- Aucun changement de requête SQL, d’autorisation, d’horaire, de matière, de règle de notes ou de clôture. Aucun nouvel appel Supabase.

L’absence de discipline peut aussi être légitime lorsqu’aucun cours n’est enregistré à l’horaire consulté. Ce correctif ne crée aucun cours et ne prétend pas corriger toutes les causes possibles d’une liste vide. Les captures montrant une panne de préparation ne suffisent pas, seules, à connaître le délai exact ou la réponse reçue sur le téléphone.

## Validation

- 97 tests ciblés réussis : worker, préparation, isolation des caches, transitions de matières, stabilité PWA, reprise des comptes et fiabilité des appels.
- Les deux nouveaux cas de réponse lente échouaient avant la correction, puis réussissent après celle-ci.
- Lint : aucune erreur ; deux avertissements antérieurs de fonctions inutilisées dans `offline-readiness.ts`.
- Compilation de production et contrôles TypeScript : réussis avec Node 22.23.3 et Next 15.5.27, sur un environnement isolé à clés et URL fictives.
- Aucun test de charge ni écriture sur les données de production. Aucun nouveau déploiement déclenché pour ce correctif.

## Vérification après déploiement autorisé

Avec Internet, laisser la PWA récupérer le worker actualisé puis rouvrir l’écran d’appel avec le même compte. Vérifier une classe disposant réellement d’un cours dans le créneau, la sélection de matière, la préparation complète et les opérations déjà en attente. Ne pas supprimer le cache ni se déconnecter pour forcer cette mise à jour. L’absence de cours au planning doit continuer à bloquer un appel automatique.

## Retour arrière

Le déploiement RAM `8c8c0bcc6e22ba88587b324b3e2c8676543fcadd` reste la référence. Le correctif ne modifie ni le schéma ni les noms de cache et ne nécessite aucune migration de données pour revenir à cette version.
