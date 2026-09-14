# Synchronisation des appels : correctifs du 14 septembre 2026

Base : `5353d2593b2c429232ee47ed826562e3254c3173`, branche `reprise-propre-5418ce7-20260729` et version de production constatée avant intervention.

## Changements

- Les synchronisations Cloud tentent réellement les connexions lentes (2G, économie de données), avec une sonde limitée à 8 secondes. La saisie interactive conserve son chemin local rapide.
- La remise à jour de la séance ouverte après synchronisation exige une réponse Cloud réelle ; une ancienne réponse vide du cache ne doit pas effacer une séance locale en attente.
- La surveillance associe la séance au créneau canonique (`started_at`) et transmet son identifiant, son heure d’appel réelle et sa clôture dans la même réponse. Le second chargement `daily-sessions` et le rapprochement approximatif par noms/90 minutes sont supprimés.
- Les données nécessaires sont paginées avec contrôle du nombre attendu ; une réponse partielle en erreur n’est pas présentée comme complète.
- La réception des données élèves s’appuie sur les accusés existants de `relay_attendance_session_causality`. Une séance ouverte ou clôturée n’est pas, à elle seule, une preuve de réception de l’appel élèves. Un lot confirmé ne prouve pas l’absence de corrections supplémentaires en attente sur un téléphone.
- La source Cloud/Relais/cache et la date des données sont affichées. Une erreur d’actualisation en arrière-plan reste visible et conserve les derniers résultats.
- L’en-tête d’impression se charge indépendamment de la surveillance et n’est plus redemandé à chaque rafraîchissement.
- Les séances sans correspondance dans l’EDT actuel déclenchent un avertissement explicite.
- Les heures de fin hors ligne anciennes sont conservées ; une heure fournie invalide ou trop future est refusée explicitement, jamais remplacée silencieusement par l’heure du rejeu.

## Périmètre préservé

Aucune DDL, migration, `db push`, modification de données de production ou modification du calcul de paie. Les notes restent Cloud-only. Publication en Preview et fusion sur la branche existante ; promotion manuelle par le responsable.

## Validation et limites

La suite ciblée couvre l’ordre ouverture → appel → clôture, les ACK exacts, conflits, reprises locales, Cloud-only des notes, surveillance et nouvelles régressions (connexion lente, créneaux adjacents, pagination, accusés et dates de fin).

La validation sur téléphone physique reste nécessaire avant de considérer le parcours terrain totalement validé : préparer une classe, couper Internet, ouvrir un cours, saisir absent et retard, clôturer, rétablir une connexion faible, attendre la fin des opérations en attente, puis contrôler élèves, horaires et réception dans la surveillance admin. Rejouer ensuite pour vérifier l’absence de doublon.

Le navigateur peut suspendre une PWA fermée ou un téléphone verrouillé : rouvrir l’application pour permettre la reprise. Le correctif ne promet pas de synchronisation fiable application fermée.

L’EDT historique n’est pas versionné par ces changements. Après modification d’un planning, les anciens créneaux non retrouvés restent signalés, pas reconstruits arbitrairement. Les réponses d’un ancien Relais peuvent ne pas inclure les identifiants/accusés : leur réception élèves est alors affichée comme non vérifiable.
