# Distinctions enseignants — règles strictes et sources de vérité

**Version fonctionnelle : 1.0 — 15 juillet 2026**
**Périmètre :** page Administration > Distinctions > Enseignants
**Principe directeur :** aucun score ne doit être produit à partir de données partielles et aucun point manquant ne doit être redistribué.

## 1. Finalité

Le module distingue au maximum les trois enseignants dont le travail est à la fois :

- suffisamment documenté dans Mon Cahier ;
- régulier sur toutes les classes prises en charge ;
- pédagogiquement efficace ;
- assidu et ponctuel ;
- accompagné d'un cahier de texte et d'une progression exploitables ;
- associé à une bonne présence des élèves pendant les cours réellement effectués.

Le moteur ne cherche pas à fabriquer obligatoirement un Top 3. S'il n'y a aucun enseignant éligible, aucun carton n'est généré.

## 2. Barème fixe sur 100

| Famille | Détail | Points |
|---|---|---:|
| Évaluations | Régularité des évaluations publiées valides | 15 |
| Évaluations | Couverture réelle des notes | 10 |
| Résultats | Moyenne pédagogique | 10 |
| Résultats | Taux de réussite | 15 |
| Enseignant | Assiduité | 12 |
| Enseignant | Ponctualité | 8 |
| Cahier | Séances renseignées dans le cahier de texte | 12 |
| Cahier | Progression réalisée | 8 |
| Élèves | Présence des élèves pendant les cours | 10 |
| **Total** |  | **100** |

Les poids sont verrouillés. Une famille indisponible ne transfère jamais ses points à une autre famille.

## 3. Publication obligatoire d'une évaluation

Une évaluation est prise en compte uniquement lorsqu'elle est réellement publiée.

Le moteur vérifie l'état de publication dans `grade_evaluations` :

- `is_published = true`, ou état de publication compatible avec `publication_status = 'published'` pour les données historiques ;
- les notes doivent exister dans la source officielle `grade_published_scores` avec `is_current = true`.

Les évaluations dans les états suivants sont exclues :

- brouillon ;
- soumise ;
- en attente de validation ;
- changements demandés ;
- refusée ;
- dépubliée ;
- publiée sans aucune ligne officielle exploitable.

Une évaluation publiée n'est pas automatiquement valide. Elle doit aussi couvrir au moins **70 % des élèves actifs** de la classe à la date de l'évaluation.

## 4. Définition d'une évaluation publiée valide

Une évaluation est valide lorsqu'elle remplit simultanément les conditions suivantes :

1. elle appartient à la période sélectionnée ;
2. elle est rattachée au bon établissement et à la bonne année scolaire ;
3. elle est rattachée à l'enseignant, à la classe et à la matière ;
4. elle est publiée ;
5. ses notes officielles courantes sont présentes dans `grade_published_scores` ;
6. au moins 70 % des élèves actifs de la classe possèdent une note officielle ;
7. le barème de l'évaluation est exploitable et la note est convertissable sur 20.

La nature de l'évaluation — interrogation, devoir, composition ou autre — ne donne aucun bonus. La colonne et le critère « Types » sont supprimés.

## 5. Régularité des évaluations — 15 points

### 5.1 Moyenne d'évaluations par classe

```text
Moyenne d'évaluations par classe =
Nombre d'évaluations publiées valides / Nombre de classes officiellement affectées
```

L'objectif maximal est fixé à **5 évaluations publiées valides par classe** sur la période.

```text
Taux de régularité = min(Moyenne d'évaluations par classe / 5, 1) × 100
Points de régularité = Taux de régularité × 15 / 100
```

Exemples :

| Moyenne par classe | Taux du critère | Points |
|---:|---:|---:|
| 1 | 20 % | 3/15 |
| 2 | 40 % | 6/15 |
| 3 | 60 % | 9/15 |
| 4 | 80 % | 12/15 |
| 5 ou plus | 100 % | 15/15 |

### 5.2 Contrôle de la répartition entre les classes

Une forte activité dans une seule classe ne doit pas masquer l'absence d'évaluations dans les autres classes.

- minimum exigé : **3 évaluations publiées valides par classe** ;
- au moins **80 % des classes affectées** doivent atteindre ce minimum.

Le non-respect de l'une de ces obligations rend l'enseignant **non éligible**, même si sa moyenne globale d'évaluations par classe semble suffisante.

## 6. Couverture des notes — 10 points

```text
Couverture des notes =
Nombre de notes officielles trouvées / Nombre de notes normalement attendues
```

Les notes attendues correspondent aux effectifs actifs concernés par toutes les évaluations publiées de la période.

Barème continu par interpolation entre les seuils suivants :

| Couverture | Points |
|---:|---:|
| Moins de 70 % | 0/10 |
| 70 % | 5/10 |
| 80 % | 7/10 |
| 90 % | 9/10 |
| 95 % ou plus | 10/10 |

Une évaluation couvrant moins de 70 % de sa classe est rejetée du nombre d'évaluations valides.

## 7. Différence entre moyenne pédagogique et taux de réussite

Ces indicateurs ne mesurent pas la même chose.

### 7.1 Moyenne pédagogique

La moyenne pédagogique mesure le **niveau moyen** des élèves.

Pour chaque couple classe-matière :

1. les notes publiées valides de chaque élève sont moyennées ;
2. les moyennes des élèves donnent la moyenne de la classe-matière ;
3. les moyennes des différentes classes-matières sont ensuite moyennées avec le même poids.

```text
Moyenne pédagogique =
Moyenne équitable des moyennes de chaque classe-matière
```

Une classe de 70 élèves ne pèse donc pas davantage qu'une classe de 25 élèves.

Barème :

| Moyenne pédagogique | Points |
|---:|---:|
| Moins de 8/20 | 0/10 |
| 8/20 | 2/10 |
| 10/20 | 4/10 |
| 12/20 | 6/10 |
| 14/20 | 8/10 |
| 16/20 ou plus | 10/10 |

### 7.2 Taux de réussite

Le taux de réussite mesure la **proportion d'élèves ayant atteint au moins 10/20**.

Pour chaque classe-matière :

```text
Taux de réussite de la classe-matière =
Élèves ayant une moyenne ≥ 10/20 / Élèves évalués
```

Le taux final de l'enseignant est la moyenne équitable des taux de ses classes-matières.

Barème :

| Taux de réussite | Points |
|---:|---:|
| Moins de 40 % | 0/15 |
| 40 % | 6/15 |
| 60 % | 9/15 |
| 80 % | 12/15 |
| 90 % ou plus | 15/15 |

Une moyenne pédagogique peut être élevée avec un faible taux de réussite si quelques très bons élèves tirent la moyenne vers le haut. À l'inverse, un taux de réussite élevé peut coexister avec une moyenne pédagogique modeste si la plupart des élèves se situent juste au-dessus de 10/20.

## 8. Assiduité de l'enseignant — 12 points

Les créneaux théoriques proviennent de l'emploi du temps. Les permissions officiellement approuvées sont retirées du dénominateur ; elles ne donnent ni bonus ni malus.

```text
Assiduité =
Séances réellement ouvertes ou effectuées / Séances prévues hors permissions approuvées
```

Les points sont proportionnels au taux d'assiduité :

```text
Points d'assiduité = Assiduité × 12 / 100
```

La donnée est calculable uniquement si :

- au moins **10 séances** sont réellement observées ;
- les séances observées couvrent au moins **50 % des créneaux prévus**.

En dessous de ces seuils, le score final reste `—` et le statut devient **Données insuffisantes**.

## 9. Ponctualité — 8 points

```text
Ponctualité =
Séances ouvertes dans la tolérance / Séances réellement observées
```

La tolérance maximale est fixée à **15 minutes** après l'heure prévue.

```text
Points de ponctualité = Ponctualité × 8 / 100
```

La ponctualité n'est calculée que lorsque la famille Assiduité est elle-même suffisamment observable.

## 10. Cahier de texte — 12 points

Le moteur lit les séances effectivement saisies dans `textbook_lesson_sessions` et les compare aux séances prévues de l'enseignant sur la période.

```text
Couverture du cahier de texte =
Séances de cahier renseignées / Séances prévues hors permissions approuvées
```

```text
Points cahier = Couverture × 12 / 100
```

Conditions :

- une progression doit être officiellement attribuée ;
- les séances doivent correspondre à l'enseignant, à la période, à la classe et à la matière ;
- la couverture minimale du cahier est fixée à **60 %**.

Une progression non attribuée relève d'une donnée institutionnelle manquante : l'enseignant est **non classable**, et non automatiquement sanctionné par zéro.

## 11. Progression pédagogique — 8 points

Les éléments attendus proviennent de `textbook_progression_items`. Les éléments réalisés ou validés proviennent de `textbook_lesson_completions`.

Le taux est **cumulatif à la date de fin de la période sélectionnée** : une complétion enregistrée après cette date ne doit jamais améliorer rétroactivement un palmarès antérieur.

```text
Taux de progression =
Éléments terminés ou validés au plus tard à la fin de la période / Éléments attendus de la progression attribuée
```

```text
Points progression = Taux de progression × 8 / 100
```

Les doublons de complétion d'un même élément sont ignorés.

## 12. Présence des élèves pendant les cours — 10 points

Cet indicateur valorise les enseignants chez qui les élèves sont régulièrement présents pendant les séances réellement effectuées et ayant fait l'objet d'un appel.

```text
Taux de présence des élèves =
Présences élèves constatées / Présences élèves attendues
```

Pour l'appel enseignant, Mon Cahier conserve principalement les absences et retards ; les élèves actifs de la classe qui ne sont pas marqués absents sont considérés présents.

Conditions de fiabilité :

- au moins **5 appels** exploitables ;
- les appels doivent couvrir au moins **50 % des séances prévues** ;
- seuls les élèves actifs à la date de chaque séance sont comptés.

Barème :

| Présence élèves | Points |
|---:|---:|
| Moins de 75 % | 0/10 |
| 75 % | 2/10 |
| 80 % | 4/10 |
| 85 % | 6/10 |
| 90 % | 8/10 |
| 95 % ou plus | 10/10 |

Ce critère reste plafonné à 10 points afin de ne pas faire porter à l'enseignant seul toutes les causes possibles d'absence des élèves.

## 13. Statuts

### Données insuffisantes

Le statut est utilisé lorsqu'au moins une famille obligatoire n'est pas calculable, par exemple :

- aucun emploi du temps exploitable ;
- moins de 10 séances de présence enseignant observées ;
- moins de 50 % des créneaux observés ;
- progression non attribuée ;
- appels élèves insuffisants ;
- aucune évaluation publiée valide permettant de calculer les résultats.

Conséquences :

- score final : `—` ;
- rang : `—` ;
- aucun carton ;
- aucune place au podium.

### Non éligible

Toutes les familles sont calculables, mais :

- un minimum obligatoire n'est pas atteint ; ou
- le score final est inférieur à **75/100**.

### Éligible

Toutes les familles sont calculables, tous les minima sont respectés et le score est supérieur ou égal à **75/100**.

## 14. Constitution du Top 3

Seuls les enseignants éligibles sont classés.

- aucun éligible : aucun lauréat ;
- un éligible : un seul lauréat ;
- deux éligibles : deux lauréats ;
- trois ou plus : les trois premiers.

Ordre de départage :

1. score strict total ;
2. points de résultats pédagogiques ;
3. assiduité ;
4. couverture du cahier de texte ;
5. régularité des évaluations ;
6. ordre alphabétique uniquement pour stabiliser l'affichage technique.

## 15. Critères volontairement exclus

Les éléments suivants ne donnent aucun point :

- nombre de types d'évaluations ;
- diversité interrogation/devoir/composition ;
- nombre brut de notes sans contrôle de couverture ;
- permissions approuvées ;
- brouillons ou évaluations non publiées ;
- créneaux théoriques non réellement observés ;
- données absentes remplacées artificiellement par zéro ou cent.

## 16. Sources techniques principales

| Domaine | Source principale |
|---|---|
| Affectations | `class_teachers`, `teacher_subjects` |
| Évaluations | `grade_evaluations` |
| Notes officielles publiées | `grade_published_scores` |
| Effectifs actifs historiques | `class_enrollments` |
| Créneaux prévus | `teacher_timetables`, `institution_periods` |
| Séances enseignant | `teacher_sessions` |
| Permissions approuvées | `teacher_absence_requests` |
| Cahier de texte | `textbook_lesson_sessions` |
| Progressions attribuées | `textbook_progression_class_assignments` |
| Éléments de progression | `textbook_progression_items` |
| Progression réalisée | `textbook_lesson_completions` |
| Appels et absences élèves | `attendance_marks` |

## 17. Audit affiché à l'administration

La page doit exposer les volumes réellement lus :

- profils enseignants ;
- affectations de classes et matières ;
- évaluations trouvées ;
- évaluations publiées ;
- évaluations publiées valides ;
- évaluations non publiées exclues ;
- lignes de notes officielles publiées ;
- créneaux prévus ;
- séances réellement observées ;
- séances de cahier de texte ;
- progressions attribuées et éléments terminés ;
- appels élèves exploitables.

Chaque enseignant conserve la liste détaillée des motifs de non-classement ou de non-éligibilité. Le calcul doit ainsi être vérifiable, explicable et contestable sur des données précises.
