# Mon Cahier IA v2 — Fiche technique

## Positionnement

Mon Cahier IA v2 est une intelligence pédagogique contextualisée. Elle analyse les données scolaires réelles d'un établissement afin d'aider l'équipe éducative à détecter les risques, identifier les matières bloquantes, préparer les conseils de classe et proposer des remédiations.

## Ce qui est mis en place

1. Assistant libre : l'utilisateur peut poser une question en français.
2. Détection d'intention : élèves à suivre, classe à risque, matière bloquante, résumé, conseil de classe, remédiation.
3. Moteur d'analyse pédagogique : notes, matières clés, assiduité, conduite, moyennes, risque par élève, risque par classe.
4. Service ML Python : possibilité de charger un vrai modèle entraîné (`joblib`) et de retourner des probabilités de réussite.
5. Historisation : interactions IA, runs de prédiction, élèves analysés, versions de modèles, échantillons d'entraînement, résultats réels.
6. Cadre éthique : aide à la décision, jamais sanction automatique.

## Données utilisées

- Notes et moyennes publiées.
- Matières, coefficients et matières clés.
- Classes, niveaux et années scolaires.
- Assiduité, absences, retards.
- Moyenne de conduite si disponible.
- Avancement du programme communiqué par l'établissement.
- Résultats réels ultérieurs pour l'entraînement.

## Données exclues

- Ethnie, religion, santé, vie familiale sensible.
- Opinions politiques.
- Informations financières des parents comme critère direct de réussite.
- Toute donnée non nécessaire à l'objectif pédagogique.

## Modèle IA

La v2 fonctionne en trois modes :

- `rules_baseline` : moteur explicable sans service ML externe.
- `ml_service` : modèle entraîné via le service Python.
- `hybrid` : évolution prévue combinant règles explicables + modèle entraîné.

## Validation

Pour défendre le modèle, il faut progressivement mesurer :

- accuracy ;
- ROC AUC ;
- faux positifs ;
- faux négatifs ;
- précision des élèves réellement en difficulté ;
- évolution après remédiation.

## Phrase officielle

Mon Cahier IA est un système ivoirien d'aide à la décision scolaire. Il analyse les données pédagogiques réelles des établissements — notes, assiduité, conduite, progression, matières et évaluations — afin d'identifier les élèves à suivre, les classes sensibles, les matières bloquantes et les actions de remédiation utiles avant les examens.
