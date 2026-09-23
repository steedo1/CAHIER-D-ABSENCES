# Validation du correctif EDT et cache d'appel

Base : production `941463c098a40f5c13875046a3984c6537fb7e7a`.
PR : https://github.com/steedo1/CAHIER-D-ABSENCES/pull/79

Le fonctionnement Cloud/PWA sans relais reste le parcours normal des établissements qui n'en ont pas. Aucun relais n'est requis par ce correctif. Aucun déploiement Production ni changement de données Supabase n'a été effectué.

## Diagnostic et comportement corrigé

- Le cache professeur utilisait des clés communes aux comptes. Après changement de compte et timeout, le navigateur pouvait reprendre le cours du compte précédent. Les clés physiques incluent désormais établissement, professeur et révision officielle ; les réponses arrivant après changement de compte sont rejetées.
- Le worker pouvait servir une ancienne matière de classe comme une réponse réseau réussie. Ce fallback a été retiré : seule une préparation cohérente, identifiée et compatible avec la dernière révision connue peut fournir le repli hors ligne.
- Les paquets EDT, listes et préparation sont publiés ensemble. Une nouvelle révision connue invalide les projections précédentes ; un payload sans contrat ne peut pas alimenter le cache courant.
- Le démarrage tente de reconstruire une préparation périmée et revalide l'affectation sélectionnée. Les cours manuels explicites du nouveau commit de production sont conservés.
- Les affectations simultanées distinctes restent disponibles. La tablette demande une sélection en présence de plusieurs matières ; les doublons exacts seulement sont supprimés. Le calcul des vacations regroupe un même professeur et créneau physique, même avec plusieurs classes.
- Dans les établissements équipés, le relais reste une source de réplication facultative. Une révision de relais plus ancienne que celle connue du Cloud n'est pas considérée à jour.

Contrôle Supabase en lecture seule : EDT CSCA de 564 lignes / 19 classes conservé. Pour 5e2, les créneaux du lundi 09:05–10:00 et 10:15–11:10 portent EPS. Aucune correction des lignes EDT n'a été faite.

## Fichiers principaux

- Contrat et identité : `src/lib/attendance-cache-contract.ts`, `attendance-cache-identity.ts`, `attendance-schedule-revision-server.ts`, `offline.ts`, `cloud-availability.ts`, `offline-auth-readiness.ts`, `offline-readiness.ts`, `src/app/providers.tsx`.
- Distribution officielle : routes `api/teacher/classes`, `api/teacher/institution/basics`, `api/teacher/offline/bootstrap`, `api/offline/schedule-status`, `api/class/subjects`.
- Écrans : `src/components/teacher/TeacherDashboard.tsx`, `src/app/class/page.tsx`, `src/components/OfflineReadinessCard.tsx`.
- Worker et version : `public/moncahier-sw.js`, `src/lib/offline-release.ts`.
- Vacations : `src/lib/finance/payroll-values.ts`, `src/app/admin/finance/payroll/page.tsx`.
- Compatibilité des établissements équipés : `desktop/relay/src/teacher-{offline-schedule,session-open,session-rules}.mts`, bibliothèques de protocole, livraison et synchronisation des séances professeur.
- Tests et gate CI : `test/attendance-cache-isolation.test.mjs`, tests de transitions de matières, paie, préparation, PWA, livraison/outbox ; `.github/workflows/offline-go-live.yml`.

## Résultats contrôlés

| Vérification | Résultat |
| --- | --- |
| Isolation réelle du cache, comptes, révisions, timeout, reconnexion, réponses invalides, établissements sans relais | 18 verts / 0 rouge |
| Mêmes assertions de cache sur le code de production de référence | 7 verts / 11 rouges attendus, démontrant le défaut avant correction |
| Suite critique Web avant les cinq derniers cas ajoutés | 120 verts / 0 rouge |
| Suite Web complète `.mjs` avant le dernier cas ajouté | 279 verts / 21 rouges sur 300 |
| Même suite disponible sur la base production | 254 verts / 26 rouges sur 280 |
| Comparaison des noms des échecs | Les 21 rouges sont tous déjà présents sur la base ; cinq autres échecs de la base ne subsistent plus |
| Suites runtime livraison, synchronisation, admin et préparation | 123/125 initialement ; les deux échecs de fixtures d'identité corrigés, sous-suite outbox rejouée 12/12 |
| Relais facultatif : vérification complète | 229 verts / 0 rouge |
| Relais : compilation et tests ciblés après dernier ajustement | 25 verts / 0 rouge |
| TypeScript final et `git diff --check` | Réussis |

Les 21 échecs préexistants concernent les contrats de transferts/listes/identité élèves et une assertion LOT4A de capacité relais. Ils ne sont pas masqués. Les logs locaux `tests-web-final.log` et le log de référence `../schedule-baseline-941463c0/tests-baseline-all.log` permettent la comparaison.

Couverture A–G : cache exécuté avec IndexedDB en mémoire et transitions réseau/comptes. H–J : politiques de préparation et révision, dont trois tests qui échouent si un relais est consulté dans un établissement sans relais. K–L : transitions des matières uniques/multiples et sélection explicite. M–N : conservation des classes simultanées et calcul d'une vacation. O : filtre serveur professeur/établissement/créneau vérifié. P : suites de livraison, outbox, préparation et surveillance admin. Les tests de contrat statiques ne remplacent pas l'essai sur appareils réels.

## Limites et test terrain de cinq minutes

La Preview doit être validée avec les comptes réels avant tout GO Production. Aucun appel réel n'a été créé automatiquement. Le premier chargement connecté doit reconstruire les anciens caches non identifiés. Hors réseau, un appareil ne peut pas découvrir une modification EDT qu'il n'a jamais reçue ; il utilise la dernière préparation officielle connue, sans la présenter comme une révision plus récente.

1. **0–1 min, sans relais** : ouvrir la Preview sur le téléphone professeur et la tablette 5e2, vérifier l'identité et attendre la préparation. Au créneau EPS autorisé, vérifier EPS sur les deux appareils. Ne pas changer l'horloge d'un appareil de production pour simuler le lundi.
2. **1–2 min** : avec partage Internet, sélectionner EPS et démarrer uniquement une séance de test autorisée. Vérifier que le bouton répond et que la classe/matière correspondent.
3. **2–3 min** : couper Internet puis recharger. EPS doit rester la matière préparée ; Informatique ne doit pas apparaître. Une préparation invalide doit produire une demande de mise à jour, jamais une matière arbitraire.
4. **3–4 min** : reconnecter, vérifier la synchronisation et l'absence de doublon ; sur le téléphone professeur, quitter A puis ouvrir B et vérifier uniquement les affectations de B.
5. **4–5 min** : vérifier côté admin la séance, les présences et une seule vacation pour un cours groupé. Pour les langues simultanées, vérifier la sélection explicite entre les deux matières dans un créneau de test adapté.

Pour un établissement équipé seulement, compléter ensuite par le contrôle de révision du relais. Cette vérification n'est pas un prérequis au parcours Cloud/PWA d'un établissement sans relais.
