# Mon Cahier IA v37 — Socle parcours élève longitudinal

## Objectif

Avant d'entraîner un modèle ML, Mon Cahier doit conserver un vrai parcours élève :

- même élève sur plusieurs années ;
- changement de classe dans l'année ;
- admission / promotion ;
- redoublement ;
- sortie ou transfert ;
- actions de remédiation et résultats après action.

Le modèle ne doit pas apprendre qu'un enfant est « faible ». Il doit apprendre des situations pédagogiques et l'effet des actions menées.

## Ce que la migration ajoute

### 1. `student_persons`
Identité pédagogique stable. Elle permet de relier plusieurs fiches `students` qui représentent le même enfant dans le temps ou entre établissements Mon Cahier.

### 2. Colonnes sur `students`
Ajoute :

- `student_person_id` ;
- `lifecycle_status` ;
- `transfer_code` ;
- informations de transfert / sortie.

### 3. `student_lifecycle_events`
Journal des événements de parcours : changement de classe, promotion, redoublement, transfert, sortie, fusion de doublon, correction.

### 4. `student_year_decisions`
Décision par année scolaire : admis, promu, redouble, transféré, sorti, orienté.

### 5. `student_transfer_requests`
Prépare le transfert contrôlé d'un dossier élève entre deux établissements Mon Cahier.

### 6. `ai_remediation_plans` + `ai_remediation_plan_items`
Permettra d'enregistrer officiellement les plans de remédiation IA : action, élèves concernés, responsable, échéance, statut.

### 7. `ai_remediation_item_outcomes`
Permettra de noter le résultat après action : amélioration, pas d'amélioration, commentaire, nouvelle évaluation, etc.

### 8. Enrichissement de `ai_training_samples`
Ajoute les colonnes nécessaires pour entraîner un modèle qui comprend le parcours : `student_person_id`, `enrollment_id`, `period_code`, `source_plan_item_id`, `outcome_window`.

## À retenir

La v37 ne change pas encore l'interface. Elle pose la base saine avant l'entraînement ML.

Étape suivante recommandée :

1. ajouter les actions admin : promouvoir, redoubler, transférer, sortir ;
2. enregistrer les plans de remédiation IA dans la base ;
3. générer les premiers vrais échantillons d'entraînement à partir des parcours et des résultats après action.
