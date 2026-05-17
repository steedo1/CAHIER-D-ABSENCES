# Paiement en ligne — Phase 3C simple

Objectif : garder le paiement en ligne simple pour l’établissement.

## Règle retenue

- Le parent initie le paiement.
- L’opérateur Mobile Money confirme ou échoue.
- Mon Cahier expire automatiquement les intentions trop anciennes.
- L’admin consulte l’historique, mais ne pilote pas le paiement.

## Ce qui est volontairement supprimé

- Pas de bouton admin “Annuler”.
- Pas de bouton admin “Marquer expiré”.
- Pas de validation manuelle admin.
- Pas de reçu sans confirmation opérateur.

## Écrans

Côté parent :
- le parent clique sur “Payer maintenant” ;
- l’intention passe en attente ;
- le parent peut vérifier le statut.

Côté admin :
- historique en lecture seule ;
- statuts visibles : en attente, confirmé, échoué, expiré ;
- aucune action manuelle sur le paiement.

## Expiration automatique

Quand une intention reste en attente au-delà de son délai, Mon Cahier la passe automatiquement en `expired` lors du chargement du suivi parent ou de l’historique admin.
