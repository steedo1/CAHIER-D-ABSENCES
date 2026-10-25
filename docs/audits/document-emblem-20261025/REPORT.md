# Emblème ivoirien : cartes et attestations — contrôle du 25 octobre 2026

> **Mise en production approuvée et réalisée le 25/10/2026 à 22:33 UTC.** PR 228 fusionnée au commit `34e72bc45e0a603fcdfb710795acd69587f107cd`, déploiement Render `dep-dbf857t9fdbs73963o50` confirmé `live`. Emblème visible et décodé dans l’aperçu de production, vrai QR valide et inchangé après déploiement, PDF individuel et réimpression sans erreur. Fenêtre d’attestation générée. Aucun SQL ni changement de données scolaires. Maximum mémoire observé sur la nouvelle instance : 306,8 Mio / 512 Mio, cinq relevés de 22:33 à 22:37. Aucun message d’erreur entre 22:33 et 22:38. Voir [le contrôle après déploiement](DEPLOYMENT.md) et [les relevés](deployment.json). Les sections suivantes conservent le compte rendu préparatoire.

## État lors de l’audit avant validation

- Production auditée avant validation : `910cf81422d7f349faa0cc2becea2aa3cb90fcdc`, déploiement Render `dep-dbf243om7kps73fg8170`, service `mon-cahier-test` (`srv-dbc291on74is73f4692g`). Les PR 226 (cartes) et 227 (transferts/cache) sont fusionnées et présentes.
- Ajout de l'emblème : branche `feature/embleme-documents-20261025`, issue de cette production ; commit fonctionnel `c48511a915b47e568df41039c3edd8f1210ac82a`.
- PR de revue : https://github.com/steedo1/CAHIER-D-ABSENCES/pull/228 . Elle n'est pas fusionnée. L'emblème n'est donc **pas encore affiché en production**. Aucune modification du service ni nouvelle dépense cloud n'a été effectuée.
- CI complet réussi : https://github.com/steedo1/CAHIER-D-ABSENCES/actions/runs/40237704237 . Les deux jobs, compilation/navigateur/PDF et intégration native Supabase, sont terminés avec succès.

## Modification

Image fournie par le propriétaire : 219 914 octets, 1536 × 1356. Version d'impression : JPEG 280 × 247, 17 984 octets (réduction de 91,8 %). L'image est redimensionnée une seule fois pendant le développement, sans suppression de détails ni génération d'un autre emblème.

L'emblème est intégré comme constante dans les modules de documents, avec le SHA256 de l'original et la recette de compression. Aucun endpoint d'image, fichier public supplémentaire, objet Supabase Storage, appel SQL ou traitement Sharp sur Render n'est ajouté. Les établissements ayant un pays explicitement différent de la Côte d'Ivoire ne l'affichent pas. Quand le pays est absent, le comportement suit l'en-tête ivoirien par défaut déjà utilisé par ces documents.

Sur les cartes, l'emblème apparaît à droite de l'en-tête national ; la place du logo d'établissement à gauche du PDF est préservée. L'aperçu affiche le nouvel emblème. Recto/verso, QR obligatoire, dimensions, placement du verso, photos et signatures facultatives conservent leur fonctionnement.

Sur les attestations, l'emblème est à droite de l'en-tête, distinct du logo d'établissement. Le HTML contient une seule source pour tout le lot, affectée aux images avant impression. Le document attend son décodage, comme pour les photos. Les signataires existants ne sont pas changés : les attestations bilingues testées conservent leurs deux directeurs des études, les autres leur responsable configuré.

La police des cartes est conservée dans une promesse partagée pendant la session de page. Tous les lots et réimpressions utilisent le même chargement ; après échec réseau, un nouvel essai reste possible. Les caches PWA, les préchargements Admin supprimés par la PR 227 et les autorisations des API restent inchangés.

## Consommation : ce qui est mesuré

Il serait inexact de promettre zéro octet supplémentaire. Le module source contenant l'image fait 24 964 octets, soit **18 620 octets compressé gzip** dans cette mesure isolée (le découpage et la compression finale des chunks dépendent du build). Ce léger coût est supporté au premier chargement du code de document, et non à chaque élève. L'emblème est ensuite local dans le navigateur.

Un test des objets PDF confirme **un seul objet image pour 100 cartes**. Pour les attestations, deux pages utilisent également un unique objet image 280 × 247 ; 100 attestations contiennent une seule source dans le HTML. Le navigateur de CI constate **zéro requête HTTP d'image** sur les scénarios d'attestation avec images de test intégrées.

Mesure locale du moteur PDF avant/après, sans photos, mêmes scripts et machine (transport Supabase fictif instrumenté) :

| Volume | Lectures avant / après, chargement + préparation | Écritures QR | Octets PDF avant | Octets PDF après | Temps PDF avant / après |
|---:|---:|---:|---:|---:|---:|
| 500, cinq PDF | 59 / 59 | 0 | 3 429 406 | 3 522 197 | 1,988 / 2,124 s |
| 1000, dix PDF | 111 / 111 | 0 | 6 856 562 | 7 047 121 | 3,897 / 4,322 s |

L'ajout est d'environ **19 Ko par PDF de 100 cartes**, pas 19 Ko par élève. Ces fichiers sont créés et téléchargés **dans le navigateur** ; leur taille supplémentaire n'est pas transférée depuis Render ou Supabase. Les temps sont une observation locale, pas une garantie de débit ni une preuve statistique d'augmentation de CPU. La génération reste côté navigateur.

Mesure Chrome CI réelle, portraits JPEG synthétiques distincts de 240 × 320, transport fictif :

| Volume | PDF | Temps d'export | Chargements de police | Lectures groupées instrumentées | Écritures SQL | Heap navigateur avant / après |
|---:|---:|---:|---:|---:|---:|---:|
| 500 | 5 | 8,756 s | 1 | 59 | 0 | 26,2 / 26,6 Mio |
| 1000 | 10 | 15,515 s | 1 | 111 | 0 | 31,2 / 37,6 Mio |

La réimpression en session ne relit pas Supabase et ne recharge pas la police, assertions du navigateur exécutées. Les téléchargements normaux de photos privées existent toujours : aucune économie fictive n'est annoncée sur ceux-ci. Le heap est une mesure JavaScript avant/après, pas le pic mémoire total du navigateur.

Intégration native : une vraie pile Supabase locale éphémère (Auth, PostgREST, Storage privé), sans connexion à la production, valide à nouveau les rôles, établissements, signatures, scans valides/falsifiés/révoqués/classe changée/année expirée. Préparation de 500/1000 : 137/265 ms, hors PDF et latence cloud ; zéro mutation SQL pendant chargement/préparation/réimpression, tables du module inchangées. Pic RSS du processus Next CI : 367,7 Mio. Les compteurs PostgreSQL observés et leur périmètre sont fournis dans `native-metrics.json` ; ils n'incluent pas les requêtes internes de GoTrue/Storage.

## Contrôle de la production actuelle, avec session autorisée

Le site officiel s'ouvre dans le navigateur. Le module chargé avec la session CSCA affiche 527 élèves, l'année 2026–2027 et les filtres de classe/niveau. Une carte réelle a été prévisualisée ; son QR public a été vérifié par un clic explicite et a renvoyé **Carte valide**. Un PDF individuel a été généré puis régénéré, sans erreur d'interface ; le lien QR est resté identique. Aucune carte ni inscription n'a été créée, invalidée ou modifiée pour ce contrôle.

Les avertissements du tableau signalent correctement 81 photos absentes, 12 matricules absents et 5 dates de naissance absentes. Ce sont des données à compléter par l'établissement, pas des identités recréées par le module.

Une attestation réelle a été demandée pour un seul élève et sa fenêtre de document s'est ouverte. Le navigateur de contrôle interdit l'inspection du protocole `blob:` : la photo et le contenu de ce document de production n'ont donc pas été inspectés via cette fenêtre. Aucun contournement n'a été effectué. Le rendu est contrôlé indépendamment sur les PDF fictifs du même générateur, ci-dessous. Aucune donnée personnelle réelle n'est enregistrée dans ce dossier ou dans la PR.

Render : Node 22.23.4 confirmé par le journal du build. État non suspendu et déploiement `live`. Aucune erreur journalisée entre 16:00 et le contrôle vers 22:02 UTC. Les relevés mémoire avant le parcours étaient autour de 265 Mio ; le maximum de la dernière heure, incluant le chargement des pages connectées de la production actuelle, était 377,4 Mio sur 512 Mio. Cette variation n'est **pas** une mesure de l'emblème, qui n'est pas déployé. Le relevé de bande passante à 21:00 est faible, mais une heure au repos ne permet pas de conclure sur les quotas mensuels.

Une première tentative HTTP depuis l'environnement de travail a expiré ; le contrôle du site et des fonctions a ensuite réussi dans le navigateur. Un premier lancement des tests sous Node 24 rencontrait une erreur de flux dans le test multipart existant ; les tests et la compilation ont été refaits sous le même Node 22 que Render, avec succès. Les tests historiques ont été lancés après récupération de l'historique Git requis.

## Tests et preuves

- 18 tests cartes et 3 tests de l'emblème : réussis sous Node 22.
- 353 contrôles scolaires et 438 contrôles Cloud/PWA : réussis.
- Attestations : quatre scénarios (classique, CSCA, franco-arabe, noms longs), deux élèves chacun ; une page par élève, signataires et titres présents, aucun débordement, un seul objet d'emblème, aucune requête réseau du logo.
- Typecheck et compilation complète Next : réussis.
- PDFs rendus en PNG et inspectés : emblème, textes, noms arabes, zones de signatures, marges et pied de page lisibles, sans chevauchement.
- Décodage indépendant ZXing à 300 dpi : QR individuel exact, **10/10 QR** du verso A4, tous distincts.
- Les essais matériels d'imprimante recto verso et de caméra de téléphone ne sont pas réalisés par cette session. La validation QR réelle a été déclenchée dans un navigateur, et les QR des PDF ont été décodés par logiciel.
- Preuves CI : https://github.com/steedo1/CAHIER-D-ABSENCES/actions/runs/40237704237/artifacts/12615249141 . Intégration native : https://github.com/steedo1/CAHIER-D-ABSENCES/actions/runs/40237704237/artifacts/12615837399 .

![Carte fictive, exemple arabe](carte-apercu.png)

![Attestation fictive, exemple franco-arabe](attestation-apercu.png)

## Mise en production et retour arrière

La PR 228 est prête à être relue. La fusion et le déploiement de cet ajout attendent la validation explicite du propriétaire, conformément à la mission initiale. Aucun nouvel hébergement ou abonnement n'est nécessaire. Aucun SQL ni variable d'environnement ne doit être appliqué pour l'emblème.

Après accord : revérifier la base active et les travaux concurrents, fusionner, déployer le commit de fusion sur le service officiel, attendre `live`, puis contrôler une carte, une attestation, un QR, les journaux et la mémoire. Conserver les optimisations PR 227.

Retour arrière : redéployer la version précédente compatible `910cf814…` (artefact `dep-dbf243om7kps73fg8170` si encore disponible), ou retirer seulement le commit de l'emblème en préservant les éventuelles évolutions suivantes. Aucun retour arrière SQL, suppression d'élève, rotation de clé QR ou effacement de signature n'est requis. Vérifier ensuite l'état `live`, les cartes et les attestations.

## Fichiers modifiés / ajoutés

- `.github/workflows/school-cards.yml`
- `docs/audits/document-emblem-20261025/DEPLOYMENT.md`
- `docs/audits/document-emblem-20261025/REPORT.md`
- `docs/audits/document-emblem-20261025/attestation-apercu.png`
- `docs/audits/document-emblem-20261025/browser-metrics.json`
- `docs/audits/document-emblem-20261025/carte-apercu.png`
- `docs/audits/document-emblem-20261025/deployment.json`
- `docs/audits/document-emblem-20261025/local-after.json`
- `docs/audits/document-emblem-20261025/local-before.json`
- `docs/audits/document-emblem-20261025/native-metrics.json`
- `scripts/test-school-cards-browser.mjs`
- `src/app/admin/cartes-scolaires/workspace.tsx`
- `src/app/admin/parents/page.tsx`
- `src/lib/document-national-emblem.ts`
- `src/lib/school-card-export.ts`
- `src/lib/school-card-pdf.ts`
- `test/attestation-print.test.mjs`
- `test/document-national-emblem.test.mjs`
- `test/helpers/attestation-fixture.mjs`
