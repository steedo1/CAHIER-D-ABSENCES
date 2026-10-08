# CSCA — essais réels de 3e1 du 8 octobre 2026

Vérification en lecture seule dans le projet `nnxgxxktjvgnnbcedmvv`. Classe 2026–2027 : `cd8ae0a9-c8b1-434a-8d41-652fd9ebec84`.

Les cinq séances ont `origin=class_device`, `status=submitted`, une heure de fermeture et un reçu causal d’appel élèves. La réception Cloud s’est faite entre 03:25:45 et 03:25:54, heure d’Abidjan. Les heures de saisie d’origine ont été conservées.

| Essai | Séance | Début réel | Fin réelle | Absents | Retards élèves |
| --- | --- | --- | --- | --- | --- |
| Allemand hors EDT | `957feb31-8e95-5b35-842d-5562e347d818` | 03:15:26.323 | 03:16:06.551 | 2 | 1 |
| Français hors EDT | `342fbe03-40ac-527d-9282-424bbcc57fe6` | 03:16:27.289 | 03:17:02.930 | 0 | 0 |
| Allemand prévu à 03:20 | `4ba5176f-dd1a-52c2-a56a-9658d7e053ba` | 03:20:12.241 | 03:20:42.223 | 0 | 0 |
| H-G prévu à 03:22 | `d5635843-23c1-5b3d-969a-0fa65482e5e7` | 03:22:39.293 | 03:23:08.521 | 2 | 1 |
| Anglais prévu à 03:24 | `e9b0e9ea-aa65-51c5-b649-473242afe6dc` | 03:25:04.208 | 03:25:11.933 | 0 | 0 |

## Corrections issues de ces essais

- Le dernier appel local peut être confirmé même si le worker ou une autre passe de synchronisation a déjà retiré sa file d’envoi. La vérification authentifiée exige la même classe, le même auteur, la même séance, sa fermeture exacte et le reçu du lot final capturé au moment de cette fermeture. Une file vide ou un autre cours ne suffit pas. Une transaction compare le marqueur actuel avant mise à jour, afin de ne pas confirmer un cours plus récent par erreur.
- Le badge précise « Dernier appel reçu ». Les actions bloquées restent signalées séparément, avec un lien utilisable dans la PWA vers « Détails de synchronisation ». La page propose la reprise des appels et la copie d’un diagnostic sans contenu élève. Les actions hors appel restent visibles et conservées.
- Les deux cours hors EDT portent maintenant leur reçu d’appel et leur état de fermeture dans la réponse admin. Le bilan de réception les inclut et déduplique les séances. Leur détail montre début réel, fin réelle, durée et heure de réception, à l’écran et à l’impression. Aucun retard par rapport à un créneau inexistant n’est calculé.
- La surveillance garde les fractions de minute dans les calculs et affiche les secondes. Les écarts des trois essais sont 12 s, 39 s et 1 min 4 s, au lieu des anciennes minutes arrondies par excès. Les durées effectives utilisent les horodatages complets et le recouvrement avec le créneau prévu.
- Le comptage des autres classes et les règles de paie sont conservés, conformément à la précision de l’utilisateur.

## Limites et suite des essais

Les deux actions protégées de la PWA doivent encore être identifiées à partir de leur diagnostic local ; la réception des cinq appels ne prouve pas leur résolution. Aucun effacement des données des essais n’a été effectué. Leur nettoyage doit cibler uniquement les cinq identifiants ci-dessus lorsque les essais et le diagnostic seront terminés. Les anciens caches et opérations en attente sont conservés. Les versions du schéma IndexedDB (1) et des caches métier (v2) restent compatibles.
