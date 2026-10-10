# Parent Connect : crédits prépayés et année scolaire

Cette évolution a été commencée depuis le commit de production `d89a461e2184de5c29629201cb7a765a738c1f85` sur `reprise-propre-5418ce7-20260729`. La compatibilité est aussi vérifiée avec les changements publiés depuis, dont le retrait ciblé des anciennes actions PWA (`6e78dc72`). Le registre Parent Connect reste séparé de la scolarité. La connexion conserve le matricule actuel, sans nouveau code.

## Période scolaire

L’abonnement couvre uniquement **l’année scolaire courante, jusqu’à sa date de fin configurée dans `academic_years`, dernier jour inclus**. Il ne dure pas douze mois. La borne stockée est minuit UTC après le dernier jour. Une année absente, ambiguë ou terminée bloque les nouvelles activations. Un enfant déjà couvert ne peut pas payer une deuxième fois pour cette année.

Le super admin approuve la période lors de la confirmation des crédits ou d’une prise en charge collective. Allonger le calendrier à l’école ne prolonge pas cette période approuvée ; raccourcir le calendrier réduit immédiatement l’accès. Une nouvelle année exige une nouvelle couverture. Les crédits inutilisés restent dans l’historique de leur année et ne sont pas reportés automatiquement.

Le calendrier du CSCA consulté pendant la préparation indique le **11 juillet 2027** pour 2026-2027. Aucune couverture réelle n’a été ajoutée pendant les tests.

## Part Nexa prépayée

1. L’école verse à l’avance **1 500 FCFA par crédit** à Nexa.
2. L’admin ou le financier peut déclarer ce versement et sa référence. Cette déclaration n’est pas une preuve de réception et ne crée aucun crédit.
3. Dans **Super admin → Parent Connect → établissement → Gérer**, le super admin vérifie le paiement reçu puis confirme la déclaration, ou choisit **Attribuer des crédits**.
4. Il confirme quantité, référence et réception effective. Une déclaration ne peut être confirmée deux fois. La confirmation réserve aussi l’accès aux matricules activés.
5. L’école encaisse ensuite **2 000 FCFA par enfant**, active son matricule et consomme **un crédit** de cette année. Elle conserve **500 FCFA** ; Nexa a déjà reçu sa part.

Sans crédit, la page bloque l’encaissement et la base refuse l’activation. Reçu, activation et consommation sont exécutés dans une transaction, sous verrou par établissement ; le dernier crédit ne peut pas être consommé deux fois. Les admins ne peuvent pas s’attribuer de crédits ni désactiver la restriction. Le super admin peut suspendre les nouvelles activations en conservant les abonnements déjà payés.

Le registre ne transfère pas d’argent et ne vérifie pas automatiquement la banque ou le Mobile Money. Le super admin confirme après vérification effective de la réception. Il suit crédits, encaissements et déclarations, avec références, année, date et auteur. Les tableaux de bord concernent l’année courante ; les listes historiques présentent les dernières opérations.

## Parcours à l’établissement

Dans **Parent Connect**, choisir niveau puis classe, ou rechercher directement nom, prénoms ou matricule. Les élèves proposés sont actifs et inscrits dans une classe de l’année courante. Après réception des 2 000 FCFA, choisir **Encaisser et activer**, renseigner le payeur, le règlement et une référence facultative. Le reçu imprimable indique l’année et sa date de fin.

| Profil | Consulter et lire les reçus | Encaisser / déclarer un versement | Confirmer / attribuer des crédits | Activer toute l’école / gérer l’accès |
| --- | --- | --- | --- | --- |
| Admin | Oui | Oui | Non | Non |
| Financier | Oui | Oui | Non | Non |
| Correspondant fichier | Oui | Non | Non | Non |
| Fondateur | Oui, dans son établissement | Oui | Non | Non |
| Super admin | Oui | Oui, dans le périmètre autorisé | Oui, tous les établissements | Oui, tous les établissements |

## École déjà payée : CSCA

Dans **Super admin → Parent Connect → établissement → Activer tous les élèves**, vérifier année, date de fin et effectif. Indiquer la référence du paiement déjà reçu et confirmer sa réception. Le bouton couvre les élèves actifs actuellement inscrits, avec matricule. Les élèves sans matricule sont comptés et exclus ; aucun matricule n’est inventé.

La prise en charge garde un instantané des identifiants et un journal avec auteur, année, référence, effectif et date. Elle active la restriction des matricules. Elle ne crée aucun faux encaissement de 2 000 FCFA, n’invente pas le montant historique payé par l’école et ne consomme pas de crédits individuels. Les paiements parents existants restent conservés. Un élève inscrit après l’opération n’est pas automatiquement couvert : le super admin peut répéter une prise en charge ou l’école utiliser un crédit.

## Mise en service

1. Appliquer `supabase/migrations/20261010033119_parent_connect_school_payment.sql` par le circuit habituel de migrations avant de publier le code. Elle crée six tables et onze fonctions isolées, accessibles au serveur uniquement. Elle ne modifie pas les notes, absences ou frais de scolarité.
2. Publier la branche validée. La migration seule ne bascule aucune école : le super admin doit confirmer des crédits, valider la prise en charge collective ou activer explicitement la restriction.
3. Pour le CSCA déjà payé, effectuer la prise en charge collective depuis l’espace super admin. Pour les autres écoles, confirmer les crédits prépayés avant toute collecte.
4. Vérifier connexion, données et alertes avec un matricule couvert et un non couvert. Les anciennes sessions restent reconnues, mais les données d’un enfant sans couverture sont bloquées côté serveur.

Seul le super admin peut rétablir l’accès antérieur sans abonnement. Reçus et journaux restent conservés. Un transfert ne débloque pas le suivi dans la nouvelle école avec l’ancien abonnement. Supprimer un élève conserve son reçu et son crédit consommé avec ses nom et matricule d’origine.

**La migration reste à appliquer sur la base cible : aucun paiement, crédit ni activation du CSCA n’a été effectué en production pendant cette préparation.**

## Vérifications

`npm run test:parent-connect` couvre React et les événements DOM, les API et contrôles serveur avec le client Supabase et des réponses simulées, et la migration SQL avec PostgreSQL embarqué PGlite. Aucun paiement réel ni écriture sur la production ne sont effectués.

Les scénarios vérifient recherche, niveau/classe, droits des profils, confirmations obligatoires, crédit épuisé, déclaration sans crédit, reçu atomique, double clic/reprise après coupure, seconde collecte annuelle refusée, calendrier, changement d’année, transfert, suppression, alertes par enfant et collectif de plus de 1 000 élèves sans fausse recette. L’absence de migration conserve l’accès antérieur ; une panne imprévue ferme l’accès payant et empêche la collecte.
