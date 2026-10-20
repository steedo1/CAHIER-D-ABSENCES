# Anglais DPFC 2026-2027

`english-dpfc-2026-2027.json` conserve les données importées depuis le PDF officiel du second cycle et leurs références de source.

Les 5 programmes du document, soit 43 unités distinctes, sont déclinés en 8 modèles nationaux par série : seconde A/C, première A/C/D et terminale A/C/D. Chaque unité est un élément `lesson` ; sa durée correspond au volume officiel total, activités complémentaires incluses. Les activités ne sont pas ajoutées comme éléments supplémentaires, pour éviter de compter leurs heures deux fois. Les durées manquantes ou incohérentes du document sont conservées dans les descriptions et métadonnées. Aucune date ni séance réalisée n'est inventée.

Pour le CSCA, 6 copies d'établissement sont affectées aux 9 classes de 2026-2027 : 2A, 2C1, 2C2, 1A, 1D1, 1D2, TA, TD1 et TD2. Elles utilisent les codes courts des classes, compatibles avec la synchronisation déjà déployée. Les affectations génériques (`teacher_id = null`) suivent les affectations pédagogiques réelles pour les comptes prof et classe. Les volumes annuels sont de 96 heures, sauf terminale C/D : 64 heures.

Le PDF source est stocké dans le bucket privé `progressions` et lié aux modèles et copies. Son SHA-256 est `5f18be5d636eddbec42a4b076f4542a705edeb8b74e848df4f1ca4fa6ccf2060`.

## Import

`sql/seed_anglais_dpfc_2026_2027_csca.sql` est un import de données transactionnel, sans modification de schéma. Les UUID déterministes et les clés uniques permettent sa réexécution sans duplication. Il vérifie l'établissement, la matière, l'année des classes et leurs affectations d'anglais, puis annule la transaction si les résultats attendus ne sont pas présents. L'objet PDF doit déjà exister au chemin enregistré. L'import a été exécuté et vérifié le 6 octobre 2026 ; il n'est pas exécuté au démarrage de l'application.

Résultat vérifié : 8 modèles nationaux, 6 copies CSCA, 119 éléments (66 nationaux et 53 d'établissement), 9 affectations actives et 1 document. Les modèles de mathématiques 1D et leurs affectations sont inchangés.

## Correspondances des niveaux

`src/lib/textbook/level-matching.ts` partage les correspondances entre la copie nationale et la synchronisation. Il reconnaît les libellés longs, les codes courts et les séries regroupées. Le code de filière officiel distingue A1 et A2 des numéros de division ; les séries et niveaux différents restent séparés.

Validation :

```sh
node --test test/textbook-level-matching.test.mjs test/textbook-redesign.test.mjs test/textbook-teacher-name-resolution.test.mjs
```

Les 29 tests passent. Une simulation de la fonction réelle de synchronisation, avec les classes et affectations pédagogiques de la base, confirme 9 correspondances et aucune création, réactivation ou désactivation, dans la version en production comme dans la version corrigée. Les données et le PDF sont vérifiés directement ; cette vérification ne remplace pas une connexion interactive à chaque compte utilisateur.
