# Parent Connect : abonnement payé à l’établissement

Cette évolution part du commit en production `d89a461e2184de5c29629201cb7a765a738c1f85` sur `reprise-propre-5418ce7-20260729`. Elle ajoute un registre Parent Connect séparé des frais de scolarité et conserve la connexion actuelle par matricule.

## Parcours à l’établissement

Dans le menu **Parent Connect**, choisir un **niveau**, puis une **classe**. La liste apparaît automatiquement. La recherche permet de retrouver un enfant par son nom, ses prénoms ou son matricule, avec ou sans filtre de classe.

Après réception des **2 000 FCFA**, ouvrir **Encaisser et activer**, renseigner le nom du payeur, le mode de règlement et une référence facultative, puis enregistrer. Le reçu est consultable et imprimable. Le matricule est activé pour douze mois. Un renouvellement conserve les jours restants. L’abonnement est lié à l’enfant et à son établissement : plusieurs parents peuvent utiliser le même matricule actif.

| Profil | Consulter et lire les reçus | Encaisser / renouveler | Enregistrer les reversements | Changer le mode d’accès |
| --- | --- | --- | --- | --- |
| Admin | Oui | Oui | Oui | Oui |
| Financier | Oui | Oui | Oui | Non |
| Correspondant fichier | Oui | Non | Non | Non |
| Fondateur / super admin | Oui, dans le périmètre autorisé | Oui | Oui | Oui |

Chaque paiement réserve **500 FCFA à l’établissement** et **1 500 FCFA à Nexa Digital**. Les reversements sont des déclarations de transferts déjà effectués ; cette page ne déclenche aucun transfert d’argent. Les totaux incluent tous les paiements. Les listes historiques montrent les trente opérations les plus récentes.

## Mise en service

1. Exécuter la migration `supabase/migrations/20261010033119_parent_connect_school_payment.sql` par le circuit habituel de migrations de la base cible, avant de publier le code. Elle crée quatre tables et quatre fonctions isolées, avec accès serveur uniquement. Elle ne modifie pas les tables de notes, d’absences ni de scolarité.
2. Publier la branche après validation. Aucune école ne bascule automatiquement à l’accès payant : les accès existants sont conservés tant que son admin n’active pas le mode d’accès par abonnement.
3. Préparer les abonnements payés, puis l’admin sélectionne **Activer l’accès par abonnement** et confirme les conséquences affichées.
4. Vérifier sur un enfant abonné et un enfant non abonné : connexion par matricule, consultation des données et alertes. Les anciennes sessions restent reconnues mais les données d’un enfant sans abonnement actif sont bloquées côté serveur.

Le bouton **Revenir à l’accès actuel** permet de désactiver le contrôle d’abonnement pour l’établissement sans effacer les paiements. Un retour de code doit également laisser les tables et les reçus en place. Les liens parents existants sont conservés.

En cas de transfert d’un enfant vers un autre établissement, son abonnement de l’ancienne école ne débloque pas le suivi dans la nouvelle. Les reçus de l’ancienne école restent archivés. La suppression habituelle d’un élève conserve les reçus avec leur nom et matricule au moment de l’encaissement.

## Vérifications reproductibles

`npm run test:parent-connect` vérifie le composant React avec des événements DOM et une API simulée, les contrôles serveur avec le véritable client Supabase et des réponses simulées, et la migration SQL dans PostgreSQL embarqué PGlite. Aucun paiement réel et aucune écriture sur la base de production ne sont effectués par ces tests.

Les scénarios couvrent niveau/classe, recherche directe, droits du Correspondant, reprise après coupure avec le même identifiant, expiration, séparation des enfants d’une famille, alertes, paiement atomique, double clic, renouvellement, accès inter-établissements, reversements, privilèges publics et conservation des données scolaires.

Une absence de migration conserve l’accès parent antérieur ; une erreur réseau ou de base inattendue n’accorde pas d’accès payant. La page d’encaissement affiche une erreur si son schéma n’est pas installé, pour éviter d’encaisser sans pouvoir activer.
