# Parent Connect : activation directe

Correction depuis le commit de production `1318c62c5e61bd04bbbb9bd07cf33dec0eaafcfb`, branche `reprise-propre-5418ce7-20260729`.

## Établissement

Admin : Administration & services → Parent Connect. Financier : Gestion financière → Parent Connect. Correspondant fichier : Organisation scolaire → Parent Connect (consultation).

Choisir niveau puis classe, ou rechercher nom, prénoms ou matricule. Cliquer **Activer** sur l’élève : aucun formulaire d’encaissement, montant, payeur, règlement ou reçu. L’accès est ouvert jusqu’à la fin de l’année scolaire approuvée, dernier jour inclus. L’activation consomme un crédit accordé par Nexa. Les élèves déjà couverts ne consomment aucun crédit supplémentaire.

Le compteur **Élèves activés** reste celui de toute l’école pendant la recherche. L’effectif inscrit et les élèves sans matricule expliquent l’écart. Les champs financiers et les versements sont retirés des écrans Parent Connect.

Après l’activation, **Ajouter le numéro SMS** enregistre uniquement le numéro donné par le parent. Une modification du numéro ne consomme aucun crédit. Le parent se connecte avec le matricule actuel.

## Nexa — super admin

Super admin → Parent Connect → établissement → Gérer → **Attribuer des crédits** : saisir la quantité, par exemple 20, puis confirmer. Note facultative. Aucun montant reçu ni confirmation financière à renseigner.

Le super admin voit les crédits disponibles, les élèves activés, l’historique des crédits et les dernières activations avec leur auteur. Il peut suspendre les nouvelles activations et conserver les accès déjà ouverts. **Activer tous les élèves** reste disponible pour la couverture collective de l’année, avec vérification de l’effectif et confirmation de l’action.

## Données et protections

Migration `20261010062246_parent_connect_activation_only.sql` : journal individuel des activations, deux fonctions serveur et consommation commune des crédits avec les anciennes opérations. Un lot manuel porte un montant NULL : il représente une autorisation de crédits, aucun paiement fictif. Les montants et reçus historiques restent conservés.

Sous verrou d’établissement : un clic crée simultanément activation et compte ; reprise et double clic ne consomment pas deux crédits. Aucun nouveau compte pour une mauvaise école, un dossier sorti, sans matricule ou sans inscription actuelle. Droits d’activation admin/financier/fondateur conservés ; correspondant fichier en consultation ; attribution des crédits et collectif réservés au super admin. Tables sous RLS et nouvelles fonctions réservées à service_role.

Les nouvelles activations, crédits, numéros et couvertures collectives n’activent jamais les SMS. Le super admin garde le contrôle séparé des autorisations SMS par événement. Les push conservent leur fonctionnement.

## CSCA

513 élèves déjà couverts jusqu’au **11 juillet 2027 inclus**. 529 inscrits dans l’année, dont 16 sans matricule. Cette correction ne refait pas l’activation collective, n’ajoute aucun crédit et ne modifie aucune donnée d’inscription. Les SMS du CSCA restent désactivés.

## Vérification

`npm run test:parent-connect` exerce les pages React, API, SQL PostgreSQL embarqué et dispatcher SMS simulé. Les scénarios vérifient activation en un clic sans paiement, crédits manuels, reprises, dernier crédit, compatibilité des anciens reçus, rôles, année, pause, matricule, numéro ajouté ensuite et conservation SMS/push. Aucun test de paiement ou de SMS réel en production.
