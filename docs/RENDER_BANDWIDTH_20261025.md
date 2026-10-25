# Réduction des transferts Render — 25 octobre 2026

Base vérifiée : service officiel `mon-cahier-test`, branche
`migration-render-test-20261021`, déploiement `dep-dbf1jurrjlhs73988gqg`
live sur `c7c4be6937201b31ae81da37cdb823c002dda284` (cartes scolaires incluses).
Les métriques Render disponibles sont horaires et globales au service ; les
journaux HTTP détaillés ne sont pas disponibles. Elles ne permettent pas
d'attribuer une part exacte du volume à chaque fonctionnalité.

## Corrections

- Arrêt de la préparation **automatique** Admin qui parcourait toutes les classes,
  listes, bulletins et conduites, conformément à la décision administration cloud.
  Le composant conserve la préparation classe/professeur, ses contrôles de révision
  EDT et le cloisonnement des identités. Aucun cache ni journal d'envoi n'est effacé.
- `warmDocument` réutilise les chunks `/_next/static/` déjà validés dans le cache,
  à URL exacte. Nouveau hash = nouveau téléchargement ; HTML et ressources
  non immuables sont toujours rafraîchis. Publication atomique préservée.
- Dix images publiques optimisées : **14 041 343 → 765 579 octets (-94,55 %)**.
  Il s'agit du poids des fichiers sources sélectionnés, pas d'une estimation de
  réduction du trafic total : les illustrations Next/Image étaient déjà optimisées.
  Le fond CSS de connexion et le favicon étaient servis directement.
- Nouvelles URLs versionnées, cache HTTP long limité à ces dix fichiers publics.
  Aucun cache public ajouté aux pages privées, photos d'élèves ou API.
  Anciens fichiers conservés pour les anciens documents en cache.
- Icônes PWA conservées en PNG 192/512 ; favicon 64 ; WebP à dimensions originales.
  Génération reproductible : `node scripts/optimize-public-branding.mjs`.

## Validation et retour arrière

Les tests exécutent le vrai composant de préparation avec transports isolés pour
les trois rôles et le vrai worker dans une VM avec Cache API simulée : suppression
du préchargement Admin, conservation des PWA classe/professeur, réutilisation des
chunks, nouvelle release, conservation du document précédent sur erreur réseau.
Validation locale : compilation Next complète et TypeScript réussis ; **438/438**
tests Cloud/PWA, **12/12** tests Admin/manifeste et **18/18** tests cartes sous
Node 22 (version de leur CI). Sous Node 24.22, le test de dépassement multipart
produit un rejet asynchrone de ReadableStream après son assertion réussie ; la
suite cartes passe sous Node 22 sans modification de son code.

Serveur Next de production local : dix nouvelles images servies en HTTP 200
avec les tailles attendues et leur cache long ; accueil, connexion établissement
et connexion parent en HTTP 200 avec le nouveau favicon ; manifeste sur les
nouvelles icônes. Comparaison visuelle des images avant/après effectuée.
La recette navigateur n'a pas pu démarrer : Chromium absent et téléchargement
du navigateur indisponible dans cet environnement.

**Accord explicite obtenu le 25 octobre 2026** pour envoyer le correctif dans
`steedo1/CAHIER-D-ABSENCES`, le fusionner et le déployer sur Render. Le premier
push avait été arrêté par le contrôle d'approbation ; cette autorisation lève
le blocage. La PR et le déploiement Render constituent les références de l'état
effectivement livré ; un simple push ne vaut pas mise en production.

Retour arrière : redéployer `c7c4be6937201b31ae81da37cdb823c002dda284`, sans
suppression de données, migration SQL ou changement de secrets. Aucun forfait
payant n'est créé. Les Go déjà consommés ne peuvent pas être récupérés par ce
correctif et le plafond gratuit reste à surveiller après déploiement.
