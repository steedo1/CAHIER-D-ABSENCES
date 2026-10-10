# Parent Connect : activations et année scolaire

Cette correction part du commit publié `5ec6b8cc0593a652180731fcfe0d0146d06f8b3a` sur `reprise-propre-5418ce7-20260729`. Le registre reste distinct de la scolarité. La connexion conserve le matricule actuel.

## Période

L’abonnement couvre l’année scolaire courante jusqu’à sa date de fin configurée, dernier jour inclus. Il ne dure pas douze mois. La borne stockée est minuit UTC après le dernier jour. Une année absente, ambiguë ou terminée bloque les nouvelles activations. Un enfant déjà couvert ne paie pas une deuxième fois pour cette année.

Le super admin approuve la période lors de l’attribution des crédits ou d’une prise en charge collective. Allonger le calendrier à l’école ne prolonge pas cette période approuvée ; le raccourcir réduit immédiatement l’accès. Une nouvelle année exige une nouvelle couverture. Les crédits inutilisés restent dans leur année.

## Écran de suivi

Admin : Administration & services → Parent Connect. Financier : Gestion financière → Parent Connect. Correspondant fichier : Organisation scolaire → Parent Connect. Sur mobile, Parent Connect est directement accessible.

Le compteur principal est **Élèves activés**. L’effectif inscrit de l’année et le nombre sans matricule expliquent l’écart. Ces nombres restent ceux de toute l’école quand on recherche un nom, un niveau ou une classe. Les anciens tarifs fixes et cartes financières sont retirés du suivi ; reçus et journaux présentent uniquement les opérations réelles.

| Profil | Consulter les abonnements et reçus | Encaisser et enregistrer les numéros | Attribuer des crédits / activer toute l’école |
| --- | --- | --- | --- |
| Admin | Oui | Oui | Non |
| Financier | Oui | Oui | Non |
| Correspondant fichier | Oui | Non | Non |
| Fondateur | Oui dans son établissement | Oui | Non |
| Super admin | Oui | Oui dans le périmètre autorisé | Oui |

## Montants réellement reçus et contrôle Nexa

Les montants sont libres : l’école saisit son encaissement parent ; le super admin confirme séparément le montant reçu par Nexa et le nombre de crédits accordés. Aucun montant n’est déduit d’un tarif fixe. Les numéros sont donnés par les parents ; aucun numéro ni règlement n’est inventé.

L’école peut déclarer un versement déjà effectué. Cette déclaration ne crée aucun crédit. Dans Super admin → Parent Connect → établissement → Gérer, le super admin choisit **Confirmer la réception** ou **Attribuer des crédits**, renseigne quantité, montant reçu et référence, puis confirme la réception effective après vérification. Le registre ne vérifie pas automatiquement la banque et ne transfère pas d’argent.

Un encaissement parent consomme un crédit de la même année. Le paiement est relié au lot de crédits utilisé, avec son montant Nexa historique. Les changements de prix sur un nouveau lot ne recalculent aucun ancien reçu. La part établissement correspond au montant réellement encaissé moins la part Nexa du crédit utilisé. Les restes d’un lot sont répartis exactement en FCFA. Un paiement inférieur à la part Nexa de son crédit est refusé sans encaissement enregistré ni crédit consommé.

Sans crédit, la collecte est bloquée. Reçu, activation et consommation restent atomiques sous verrou d’établissement. Une même opération ne peut pas créer deux paiements ou être réutilisée avec un montant différent. Les comptes école ne s’attribuent pas de crédits et ne désactivent pas la restriction. Le super admin peut suspendre les nouvelles activations en conservant les couvertures déjà accordées.

## Abonner un enfant

Choisir niveau puis classe, ou rechercher nom, prénoms ou matricule. Les élèves proposés sont actifs et inscrits dans l’année courante. Après réception du paiement, choisir **Encaisser et activer**, renseigner payeur, **montant reçu**, numéro SMS, mode de règlement et référence facultative. Le reçu imprimable conserve le montant réel et la fin scolaire.

Le parent ouvre `/parents/login`, saisit le matricule activé et clique sur **Se connecter**. Il ajoute ensuite les autres enfants depuis son espace ; leur couverture est contrôlée séparément. Les messages de blocage ne présentent aucun prix imposé.

## CSCA et couverture collective

Le CSCA est couvert depuis le 10 octobre 2026 : **513 élèves éligibles activés jusqu’au 11 juillet 2027 inclus**, pour 2026-2027. La vérification de la base compte **529 élèves actifs inscrits**, dont **16 sans matricule**. Ces 16 sont exclus tant que l’établissement n’a pas renseigné leur matricule. Les 123 autres dossiers marqués actifs n’ont aucune inscription en classe ; ils ne constituent pas automatiquement des abonnements éligibles. Aucun élève ni matricule n’a été inventé, réaffecté ou supprimé pour augmenter ce compteur.

Super admin → Parent Connect → établissement → **Activer tous les élèves** couvre les élèves actifs inscrits avec matricule pour une école déjà payée. Cette action exige référence, confirmation et effectif exact, et conserve un instantané des identifiants. Elle ne crée aucun faux encaissement ni consommation de crédit. Un élève ajouté après l’opération exige une nouvelle prise en charge super admin ou un crédit individuel.

Pour un enfant couvert, **Ajouter le numéro SMS** ou **Modifier le numéro** ne demande ni paiement ni crédit. Les modifications sont journalisées, visibles par Nexa, et réservées aux profils autorisés.

## SMS et push

Les SMS d’absence, retard et digest de notes publiées utilisent le numéro associé à l’enfant, à l’école et à l’année même sans compte ou ouverture de l’application parent. Les numéros ivoiriens conservent leur zéro initial.

Super admin → Abonnements reste le point de contrôle des SMS, avec autorisation principale et réglages par événement. Crédits, couverture collective et numéro enregistré n’activent pas les SMS. **Au CSCA, les SMS restent désactivés et les push actifs.** Cette correction ne modifie ni les réglages SMS, ni les triggers d’appel, ni le dispatcher. Aucun SMS réel n’est utilisé pour les tests.

## Migration et validation

L’installation initiale `20261010033119_parent_connect_school_payment.sql` est déjà en production. La correction ajoute `20261010053906_parent_connect_flexible_amounts.sql` : contraintes de montants variables, deux fonctions serveur avec montant explicite, lien paiement/lot de crédits et compteur des couvertures effectivement éligibles. Les anciennes fonctions restent disponibles pour les clients déjà chargés ; les nouveaux écrans utilisent les montants explicites. RLS, droits serveur et contrôles de rôles restent en place.

`npm run test:parent-connect` vérifie React/DOM, contrôles API, PostgreSQL embarqué PGlite et dispatcher avec fournisseur simulé. Les scénarios incluent tarifs différents, montant de lot non divisible, reprises, droits, crédit épuisé, période, transfert, suppression, numéro parent, autorisation SMS et collectif. Les tests n’effectuent aucun paiement réel ni envoi SMS.
