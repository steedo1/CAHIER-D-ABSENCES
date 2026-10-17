# Intégration pédagogique multicycle — décision et limites

## Décision

Une application, les modules actuels et deux stratégies de calcul. Le moteur historique reste le défaut, y compris pour un établissement dont les cycles ou les anciens modèles sont déjà configurés. Le calculateur franco-arabe existant est réutilisé ; aucun troisième moteur n’est introduit.

La sélection est réalisée après authentification et contrôle de la classe, dans `/api/admin/grades/bulletin`. Elle exige simultanément des cycles activés, un cycle de classe reconnu ou explicitement configuré, des paramètres pédagogiques valides et `franco_arabic_reports_v1.engine = "specialized"`. Un paramètre d’URL ne sélectionne pas le moteur. L’administrateur de l’établissement doit activer cette option explicitement dans les paramètres de bulletins existants ; les modèles enregistrés avant cet ajout ne basculent pas automatiquement.

Le chemin historique conserve ses calculs, exceptions CSCA, coefficients, classements, décisions et QR. Sa sélection n’ajoute aucune requête SQL/Supabase. Des tests exécutent le bulletin historique du commit `6d6799fe7c0e39de011b417b99179f4b00bc1fe4` et le bulletin courant sur les mêmes données synthétiques, puis comparent moyennes, résultats par matière et rangs.

## Données et écrans communs

- Même établissement, année, classe, inscription et identité/matricule de l’élève.
- Même authentification, enseignants et affectations. Les deux représentations historiques d’un identifiant de matière sont normalisées depuis le catalogue actif de l’établissement.
- Même API et page opérationnelles de bulletin ; le composant franco-arabe existant présente les résultats spécialisés.
- Mêmes périodes applicables à la classe et même circuit de publication. Le moteur spécialisé ne lit que les scores officiels courants, associés à une évaluation publiée et à sa version courante. Il ne recopie aucune note et ne lit pas les brouillons comme remplacement.
- Aucun nouveau module financier, registre d’élèves ou schéma Supabase. Les paramètres complémentaires utilisent le JSON d’établissement existant, dont les écritures sont protégées par rôle et révision.

## Coefficients : une autorité active

Le résolveur reçoit un contexte vérifié `(établissement, cycle, niveau, enseignement, discipline)` et un catalogue réellement actif. Deux modes explicites existent ; leurs valeurs ne sont jamais fusionnées :

1. `institution` (défaut) : le programme de niveau et les coefficients enregistrés dans `institution_subject_coeffs` sont utilisés. Les anciennes valeurs du modèle JSON sont ignorées pour ce calcul et ne sont pas recopiées. Le niveau exact est prioritaire sur une éventuelle règle globale existante ; une ambiguïté, une valeur absente ou invalide bloque la moyenne. Aucun coefficient secondaire ou coefficient 1 n’est inventé. En l’absence d’un programme de niveau séparé, les matières explicitement configurées par coefficient pour ce niveau constituent le catalogue.
2. `program` : les coefficients explicitement validés du modèle sont l’unique autorité des contextes spécialisés. Leur clé comprend cycle, niveau, enseignement et discipline. Aucun repli sur la table historique ni sur un autre programme n’est effectué. Les données historiques sont conservées pour le chemin historique, mais ne constituent pas une deuxième valeur active pour ce contexte.

La source figure dans la réponse serveur et dans la configuration pédagogique. Changer cette source ne synchronise ni ne réécrit les données existantes. Le choix est réservé à l’administrateur pédagogique de l’établissement, jamais au Super Admin lors de la création.

## Français, arabe et matières communes

Chaque programme possède son barème, ses résultats et son classement. Les notes sources conservent leur dénominateur ; la conversion n’est appliquée que pour calculer le résultat du programme. Un document regroupé présente les deux ensembles indépendants et ne contient aucune moyenne ou aucun rang global français+arabe.

Une évaluation dont la discipline appartient à un seul programme peut être classée sans ambiguïté à partir de la configuration vérifiée. Une discipline appartenant aux deux programmes ne permet pas cette déduction : `grade_evaluations` et `grade_published_scores` n’ont pas de clé explicite d’enseignement. Le filtre choisi dans le navigateur, le nom d’une discipline ou celui d’un enseignant ne sont pas des preuves suffisantes.

**Limite volontaire actuelle :** ces évaluations partagées sont exclues des calculs et rendent le bulletin incomplet ; elles ne sont jamais comptées deux fois. L’impression depuis le nouveau panneau reste désactivée tant que les résultats ne sont pas complets.

**Solution proposée sans DDL, non activée :** un rattachement d’évaluation à un programme peut être conservé dans un registre de métadonnées du JSON existant, indexé par l’UUID de l’évaluation et son contexte de classe/année. Ce registre ne doit contenir aucune note. Avant écriture, le serveur doit vérifier le rôle, l’établissement, la classe, l’affectation, la discipline et le programme autorisé ; il faut aussi traiter la concurrence et l’atomicité entre création d’évaluation, rattachement et publication. Tant que ce mécanisme n’est pas intégré à toutes les voies de saisie, modification, relais et publication, le blocage reste en place. Aucune migration n’est requise ni effectuée pour cette proposition.

L’inscription individuelle à un sous-ensemble des enseignements, lorsque tous les élèves d’une classe ne suivent pas les mêmes programmes, reste également à expliciter dans les données communes avant activation pour ce cas. Le parcours actuel spécialisé traite les programmes configurés pour la classe/cycle et n’invente pas une seconde fiche d’élève.

## Préscolaire et directions

La fonction qualitative déjà développée est conservée. Le préscolaire ne reçoit aucune moyenne ni aucun classement de substitution. Le parcours opérationnel répond explicitement que le catalogue de compétences et le stockage des observations doivent être définis avant génération. Ils ne sont pas simulés à partir des notes chiffrées. Leur raccordement à la saisie existante reste à terminer sans nouvelle table pour le moment.

Les comptes de directions restreints ne sont pas provisionnés avant l’intégration et les tests de tous les contrôles serveur. La sélection d’un enseignement dans la navigation n’accorde aucun droit. Le nouveau parcours de bulletin est limité à l’administrateur de l’établissement ; il ne reprend pas automatiquement les droits élargis d’autres rôles.

## Vérification et consommation

Les lectures sont paginées et limitées, avec des tris stables. Élèves, coefficients, évaluations et scores sont chargés par lots, puis les deux programmes sont calculés en mémoire. Aucune requête par élève ou par programme n’est effectuée. Un test compare le nombre de lectures pour 2 et 120 élèves.

Les tests couvrent le choix serveur, le primaire ordinaire, les résultats et rangs indépendants, les matières partagées bloquées, les brouillons et anciennes versions, les accès étrangers, les identifiants d’affectations, la création de classes et la conservation du chemin historique. Les parcours navigateur, l’impression, le build et les régressions doivent être consignés séparément avec leurs résultats réels ; les tests simulés ne valent pas validation en production.

Aucune DDL, aucun `db push`, aucune mutation d’établissement réel, création réelle de CEIFAD, fusion ou mise en production n’est autorisé par cette intégration.
