# Mon Cahier IA — Fiche technique v1

## Positionnement

Mon Cahier IA est un module d'aide à la décision pédagogique. Il analyse les données scolaires disponibles dans Mon Cahier afin d'identifier les élèves, classes et matières nécessitant un accompagnement avant les échéances importantes.

Il ne remplace pas le chef d'établissement, le professeur principal, l'éducateur ou le conseil de classe. Il sert à déclencher un suivi plus tôt.

## Questions couvertes en v1

- Quels élèves de 3e doivent être suivis avant le BEPC ?
- Quelle classe a le plus fort risque de baisse ?
- Quelles matières bloquent une classe ?
- Résumer la situation pédagogique de l'établissement.
- Préparer une note pour le conseil de classe.
- Proposer un plan de remédiation.

## Données utilisées

- Notes publiées.
- Moyennes générales et moyennes dans les matières clés.
- Coefficients des matières.
- Volume d'évaluations.
- Absences, retards et assiduité.
- Conduite, lorsque disponible.
- Taille de classe.
- Couverture du programme dans les matières clés.
- Notes en brouillon pour mesurer la qualité de la donnée.

## Données exclues

Mon Cahier IA ne doit pas utiliser comme variables de prédiction :

- religion, ethnie, origine ou langue familiale ;
- santé ou handicap ;
- situation familiale sensible ;
- profession des parents ;
- niveau de paiement des frais scolaires comme critère direct de réussite ;
- toute information non nécessaire à l'accompagnement pédagogique.

## Architecture v1

1. Moteur SQL existant : `predict_success_for_class`.
2. API classe : `/api/admin/notes/predictions`.
3. API assistant : `/api/admin/mon-cahier-ia/insights`.
4. Interface : `/admin/mon-cahier-ia`.
5. Historisation : `ai_prediction_runs`, `ai_prediction_students`, `ai_insight_runs`.
6. Évaluation future : `ai_prediction_outcomes`, `ai_model_evaluations`.
7. Service ML optionnel : variable `ML_PREDICT_URL`.

## Éthique d'usage

Chaque résultat doit être interprété comme une aide à la décision. Un élève ne doit jamais être sanctionné automatiquement sur la base du score IA. Le score sert à organiser une remédiation, informer l'équipe pédagogique et renforcer le suivi.

## Validation du modèle

Pour rendre le modèle défendable, il faut comparer les prédictions aux résultats réels :

- élèves prédits en suivi prioritaire qui ont effectivement chuté ou échoué ;
- élèves non signalés qui ont malgré tout chuté ;
- faux positifs ;
- faux négatifs ;
- précision globale ;
- rappel sur les élèves à risque.

La priorité éducative est de réduire les faux négatifs : un élève fragile que l'IA n'a pas signalé.

## Formulation officielle recommandée

> Mon Cahier IA est une intelligence artificielle éducative contextualisée, conçue pour analyser les réalités scolaires locales — notes, assiduité, conduite, coefficients, matières clés, progression et évaluations — afin d'aider les établissements à détecter précocement les risques, organiser la remédiation et mieux préparer les conseils de classe.
