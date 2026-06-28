# Mon Cahier IA v38 — Dataset automatique sans charge admin

## Objectif

Construire le jeu de données d'entraînement de Mon Cahier IA à partir des données déjà produites par l'école, sans demander à l'administration de suivre manuellement les actions proposées par l'IA.

La règle métier retenue est :

- les plans de remédiation IA aident l'école à agir ;
- le modèle n'apprend pas à partir du fait qu'une action a été proposée ;
- le modèle apprend à partir des trajectoires réelles observées : notes, absences, retards, conduite, évaluations, progression, effectif, lien parent, décisions annuelles.

## Ce que v38 ajoute

Migration SQL :

```txt
src/db/mon_cahier_ai_v38_auto_training_dataset.sql
```

Elle ajoute :

```txt
v_ai_student_period_feature_snapshots
```

Un snapshot automatique par élève et par période, construit à partir de :

- moyenne pondérée de période ;
- moyenne brute de période ;
- nombre de notes ;
- nombre d'évaluations ;
- types d'évaluations ;
- nombre de matières évaluées ;
- nombre de matières sous 10 ;
- nombre de matières sous 8 ;
- effectif de classe ;
- absences et retards ;
- conduite / pénalités ;
- liens parents ;
- progression cahier de textes.

Puis :

```txt
v_ai_student_period_training_dataset
```

qui ajoute les résultats réels connus :

- moyenne de la période suivante ;
- évolution de moyenne ;
- encore sous 10 ou non ;
- décision annuelle si disponible : admis, redouble, orienté, transféré, sorti.

Enfin :

```txt
mon_cahier_ai_rebuild_training_samples(institution_id, academic_year)
```

qui remplit automatiquement `ai_training_samples`.

## Ce qui est volontairement exclu

Le dataset n'utilise pas :

- nom ;
- prénom ;
- matricule ;
- téléphone parent ;
- action IA proposée ;
- validation manuelle d'une remédiation.

L'identifiant élève sert uniquement à rattacher les lignes dans la base. Il ne doit pas être utilisé comme variable explicative du modèle.

## Commande SQL après installation

Après avoir exécuté la migration dans Supabase, reconstruire le dataset pour une année :

```sql
select *
from public.mon_cahier_ai_rebuild_training_samples(
  '<institution_id>'::uuid,
  '2025-2026'
);
```

Résultat attendu :

```txt
rows_total   = lignes créées ou mises à jour
rows_ready   = lignes avec résultat connu, utilisables pour entraînement
rows_pending = lignes en attente de période suivante ou décision annuelle
```

## Pourquoi certaines lignes restent pending

Une ligne est `pending` si Mon Cahier n'a pas encore de résultat réel à associer au snapshot.

Exemple : T1 existe, mais T2 n'est pas encore disponible.

Dès que les notes T2 ou la décision annuelle sont disponibles, on relance la fonction. Les lignes deviennent automatiquement exploitables.

## Suite logique

v39 pourra utiliser `ai_training_samples` pour entraîner le premier modèle ML réel.

Le modèle devra apprendre sur les signaux pédagogiques, pas sur l'identité de l'élève.
