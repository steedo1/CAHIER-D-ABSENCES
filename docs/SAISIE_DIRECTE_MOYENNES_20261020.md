# Saisie directe des moyennes — secondaire

L’administrateur et le correspondant fichier peuvent ouvrir **Cahier de notes → Registre des notes**, sélectionner la classe, le trimestre et la discipline, puis choisir **Saisir les moyennes**. Le professeur n’a pas besoin d’avoir créé des devoirs. Les établissements conservent leur parcours habituel de saisie des notes.

## Règles

- Une moyenne directe est une moyenne finale sur 20, attachée à un élève, une matière, une année et une période précises. Elle remplace le résultat des notes et du bonus matière pour cette seule période.
- `0` est une vraie moyenne. Un champ vide supprime la saisie directe et rétablit le calcul habituel, notes et bonus conservés.
- Les bulletins, rangs, moyennes annuelles, exports utilisant le bulletin et vérifications QR emploient la même valeur. Un QR déjà émis avec un snapshot officiel conserve son historique.
- Aucun devoir fictif, aucune publication de notes ni notification de devoir ne sont créés par cette saisie.
- Le parcours primaire et ses compositions, ses barèmes et ses calendriers ne sont pas remplacés par cette saisie secondaire sur 20.

Dans **Moyenne de conduite**, choisir la classe et la période, cliquer sur **Valider**, puis **Saisir la moyenne** ou **Modifier la moyenne**. Cette valeur finale prévaut sur les rubriques et sur les composantes Religion/Latin du CSCA. La réinitialisation restaure la source précédente, notamment les heures d’absence et sanctions saisies manuellement. Le correspondant peut saisir la moyenne finale mais ne reçoit pas les droits de modification des rubriques ou du barème.

## Stockage et compatibilité

Aucune DDL, migration ou commande `db push` n’est nécessaire. Aucune donnée scolaire de production n’a été écrite pour les tests.

La table existante `grade_adjustments` a une contrainte unique annuelle `(class_id, subject_id, student_id, academic_year)`, sans `grading_period_id`. Les saisies directes sont donc conservées dans une enveloppe versionnée de `reason`, avec une entrée par UUID de période, l’auteur et l’horodatage. Le motif précédent est conservé. Les colonnes de bonus et de période existantes restent intactes lors de la saisie d’une moyenne.

Les écritures modifient uniquement `reason`, avec comparaison de sa valeur précédente et relecture en cas de concurrence. Une lecture groupée précède les écritures ; seuls les élèves modifiés sont enregistrés. Une source créée uniquement pour cette fonctionnalité est retirée lorsqu’elle devient vide et ne porte aucun bonus. Les routes de bonus peuvent réutiliser une telle source vide sans rencontrer la contrainte unique annuelle.

La conduite utilise `conduct_average_overrides`. L’enveloppe de saisie directe conserve la source précédente pour permettre un retour fidèle aux absences et sanctions. Les règles de conduite composite restent appliquées au calcul automatique ; leurs moyennes de matières directes sont également prises en compte.

## Contrôles

- Autorisation serveur des rôles et de l’établissement ; contrôle de la classe, de la matière, de la période et des élèves ; refus des valeurs hors de 0–20 et des doublons avant écriture.
- Les échecs réseau conservent les saisies à l’écran. Une éventuelle sauvegarde partielle est signalée avec les lignes effectivement enregistrées.
- Les filtres sont désactivés tant que les moyennes modifiées ne sont pas enregistrées ou annulées.
- Tests des véritables routes avec le SDK Supabase et des données synthétiques : indépendance des trimestres, zéro, notes absentes, priorité des moyennes, réinitialisation, bonus, concurrence, droits, bulletins annuels, QR et conduite composite.
- Test du composant React dans un DOM simulé : chargement, décimales, validation, sauvegarde, annulation et conservation des saisies après erreur.
- Contrôles de non-régression : registre existant, navigation correspondant, conduite/éducateur, statistiques, QR et compositions primaires franco-arabes.

Le contrôle en lecture seule de Dieudonné au 20 octobre 2026 trouve six classes avec matières affectées et trois périodes pour 2026–2027. La fonctionnalité est livrée sur une branche dédiée ; la fusion et le déploiement en production restent à effectuer.
