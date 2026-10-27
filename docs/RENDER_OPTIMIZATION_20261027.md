# Consommation Mon Cahier : constat et premier correctif du 27 octobre 2026

## Base et périmètre

Production vérifiée sur Render : `mon-cahier-test`, service
`srv-dbc291on74is73f4692g`, branche `migration-render-test-20261021`, commit
`cb966506f79595b7c53d0579b3592d48e87b0a5f`, déploiement
`dep-dbg6m96k1f9s73bgpe7g` déclaré live. Ce service sert le domaine officiel.
La nouvelle branche de travail part exactement de ce commit.

Le correctif reste préparé pour revue ; ce document ne prouve aucune fusion ni
mise en production. Aucun changement de forfait, de secret ou de données métier.

## Ce que les mesures permettent de dire

Les captures de facturation fournies par le propriétaire indiquent 5,13 Go
consommés pour 5 Go inclus : 3,82 Go de réponses HTTP et 1,31 Go initiés par les
services. Le quota est partagé entre les services du workspace.

L'API Render donne les volumes suivants pour le **service principal seul**,
somme des points horaires `bandwidth_usage`, unité retournée `mb` :

| Date UTC | Volume journalier, unité Render `mb` |
| --- | ---: |
| 21 octobre | 2 161,44 |
| 22 octobre | 650,60 |
| 23 octobre | 1 118,94 |
| 24 octobre | 993,98 |
| 25 octobre | 173,89 |
| 26 octobre | 112,09 |
| 27 octobre, journée incomplète au relevé | 26,38 |

La consommation récente est plus basse mais la limite mensuelle reste cumulée.
Cette comparaison de jours aux usages différents n'est pas une mesure causale
des gains d'un correctif, ni une prévision de rentrée. Les journaux HTTP Render
détaillés ne sont pas disponibles : aucune attribution exacte aux robots, aux
images ou à une API n'est revendiquée.

Sur la fenêtre Supabase du 26 octobre à 14 h 40 au 27 octobre à 14 h 40 UTC,
les journaux edge agrégés comptent notamment 1 160 GET réussis `user_roles`,
1 121 GET réussis `/auth/v1/user`, 935 GET `profiles`, 619 GET `institutions`,
450 GET `classes` et 319 GET `relay_sync_devices`. Ces compteurs ne suffisent
pas à qualifier individuellement un appel d'inutile. Ils n'indiquent pas les
octets envoyés par Render. Aucune donnée nominative ou recherche SQL brute
contenant des identifiants d'élèves n'est nécessaire à ce relevé.

Le relevé mémoire à résolution horaire entre le 25 octobre et le relevé du
27 octobre contient un point à environ 502 Mio pour une limite de 512 Mio.
Aucun événement `server_failed` n'est retourné sur cette fenêtre. L'absence
d'échantillonnage fin interdit de conclure qu'il n'existe aucun pic.

## Premier correctif

- Le composant de **préparation préventive** ne lance plus son contrôle réseau
  quand le document est masqué. Aucun throttle n'est consommé pendant cette
  pause, ce qui permet de vérifier la révision dès le retour à l'écran.
- Les envois d'appels en attente et le Background Sync restent indépendants de
  cette pause. Une préparation déjà engagée peut se terminer ; aucune annulation
  de journal, de séance ou de téléchargement en cours n'est introduite.
- La préparation du shell et l'installation d'une nouvelle version du worker
  réutilisent les images publiques versionnées déjà valides, à URL exacte.
  L'allowlist correspond aux dix chemins immuables de `next.config.mjs`.
  Les autres ressources et les documents sont toujours rafraîchis.
- La version diagnostique Web/worker est mise à jour ensemble. Le schéma hors
  ligne et les noms de caches restent inchangés, sans purge de données PWA.

## Vérification locale

- Suite Cloud/PWA : **444/444** tests réussis.
- Session Supabase, consommation et cache de références : **16/16** tests réussis.
- TypeScript et compilation Next.js complète réussis avec une configuration
  fictive locale, sans accès applicatif au Supabase de production.
- ESLint des deux fichiers TypeScript concernés : aucune erreur ni avertissement.
- Tests nouveaux : huit heures masquées sans requête pour admin, enseignant et
  compte classe ; reprise immédiate et throttle conservé ; branding réutilisé ;
  ressource non publique rafraîchie ; URL différente non confondue ; icône
  invalide retéléchargée ; allowlist alignée avec les en-têtes HTTP.
- La première exécution de la suite complète nécessitait deux anciens objets
  Git utilisés pour reproduire des bugs historiques ; ils ont été récupérés,
  sans modification de ces tests. La version diagnostique du worker a également
  été alignée avant l'exécution finale réussie.
- La recette navigateur `verify-cloud-pwa-browser.mjs` n'a pas pu démarrer :
  Chromium absent ; le téléchargement de l'archive headless échoue dans cet
  environnement. La suite VM et les contrôles d'intégration ci-dessus passent,
  mais ne constituent pas une recette sur téléphone réel. Le gate GitHub
  existant installe Chromium et exécute cette recette ; ses filtres incluent
  désormais explicitement la préparation et ses tests.

La baisse du trafic réel de ce nouveau correctif devra être mesurée après une
éventuelle livraison, sur une période et des usages comparables.

## Travail suivant, guidé par les mesures

1. Mesurer le nombre de requêtes et le volume par parcours : ouverture classe,
   appel, reconnexion, consultation des notes, lot de bulletins et impression.
   Employer les fixtures isolées pour les charges répétées, jamais les élèves
   réels pour des tests de charge.
2. Examiner les autres rafraîchissements visibles, les appels redondants de
   rôles/profils et les lectures `relay_sync_devices` malgré le Relais désactivé.
   Grouper les lectures et éviter les répétitions sans mettre en cache des
   décisions d'autorisation périmées.
3. Contrôler les lots de photos et de documents, les sélections SQL trop larges,
   les données inchangées et les téléchargements déclenchés sans action utile.
   Le cache public doit rester limité aux ressources réellement publiques.
4. Mesurer la mémoire à résolution fine lors des impressions et appels
   simultanés ; le premier correctif de ce document ne résout pas cette limite.
5. Choisir des seuils de surveillance du trafic, des dépenses, de la mémoire et
   des erreurs. Aucun suivi planifié ou plafond financier n'a été créé ici.

Le moyen de paiement enlève la coupure pour ce dépassement de bande passante,
mais ne supprime ni la facture variable ni les autres limites du serveur gratuit.
Une optimisation ne peut garantir zéro panne ni un plafond de 5 Go pour toutes
les fréquentations futures.

## Retour arrière

Revenir au commit de production ci-dessus pour ces seuls fichiers, ou effectuer
une réversion du nouveau correctif après fusion. Ne supprimer ni caches,
ni IndexedDB, ni outbox. Toute promotion doit revalider la tête de production,
les travaux concurrents et les contrôles GitHub avant de déclencher Render.
