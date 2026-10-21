# Clôture de secours indépendante des appareils — proposition non activée

## Défaut et limites

Le contrôle SQL en lecture seule du 21 octobre relève quatre séances `class_device`
encore `open`, sans `ended_at`, dont deux du jour. Leur durée enregistrée + 2 minutes
est dépassée. Le watcher existant ferme au retour du téléphone ; il ne peut agir
lorsque l'appareil reste éteint. Aucun de ces enregistrements n'a été modifié.

## Comportement préparé

`POST /api/cron/attendance/close-overdue` exige `CRON_SECRET`, via `x-cron-secret`
ou Bearer. Par défaut, il effectue uniquement une simulation et retourne des nombres,
sans identifiant d'élève ou de séance. Une requête `?apply=1` est refusée tant que
`ATTENDANCE_SERVER_CLOSE_ENABLED` n'est pas exactement `true` côté serveur.

La sélection porte sur 100 séances ouvertes maximum, commencées depuis sept jours.
La fin calculée reprend `started_at + expected_minutes + 2 minutes`, comme le watcher
client. Une durée absente, non entière, négative ou supérieure à 24 h est ignorée.
Les séances futures, déjà terminées et l'historique plus ancien sont exclus.

L'application écrit seulement `ended_at` et `status=submitted`, avec comparaison de
l'établissement, de l'identifiant, de l'heure de début, de la durée et du statut ; une
fin manuelle concurrente reste prioritaire. Les présences, absences, notes et sanctions
ne sont pas écrites. Aucun SMS ou push n'est produit par ce traitement. La livraison
offline des présences reste assurée par le mécanisme existant.

## Activation à valider séparément

Cette PR n'ajoute ni calendrier actif ni variable à Render et ne crée aucun service.
Déployer d'abord en simulation, relever les candidats et vérifier les heures calculées
avec la direction. L'activation nécessite ensuite une validation explicite : ces fins
automatiques apparaîtront dans le suivi des cours et peuvent influer sur les rapports
qui consultent leur durée.

Le dépôt contient trois workflows actifs sur `main`, pas sur la branche de production.
Le futur déclencheur devra donc être ajouté sur `main`, utiliser un seul POST canonique
authentifié, une concurrence de 1, aucun rejeu après un délai ambigu et une fréquence de
deux minutes. Les déclenchements GitHub observés sont espacés : leur seule expression
cron ne garantit pas une exécution à 7 h 30. Le choix d'un ordonnanceur fiable reste à
valider ; `pg_cron` et `pg_net` ne sont pas installés sur le projet Supabase contrôlé.
Aucun nouveau service facturé ou abonnement ne peut être créé sans accord.

## Retour arrière

Avant activation, archiver en privé les seuls champs des séances candidates (`id`,
`institution_id`, `started_at`, `expected_minutes`, `ended_at`, `status`). Désactiver
la variable puis le déclencheur arrête les écritures suivantes. Une restauration de
fins déjà appliquées nécessite de comparer les valeurs courantes à celles écrites
par ce traitement pour préserver les corrections humaines intervenues depuis.
Le retour au déploiement Render antérieur ne restaure pas les données.

Validation : 65/65 tests des échéances, de la garde cron, des écritures conditionnelles,
de la concurrence, des flux offline et des comptes classe ; compilation Next.js et
TypeScript réussies. Tests synthétiques uniquement, aucune écriture de test sur la
production. Suivi #198.
