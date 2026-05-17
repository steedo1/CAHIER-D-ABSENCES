# Mon Cahier — Paiement en ligne Phase 3B

Objectif de cette phase : sécuriser le tunnel interne avant de brancher Orange Money réel.

## Règle appliquée

- Le parent clique sur **Payer maintenant**.
- Mon Cahier crée une **intention de paiement**.
- Le paiement passe en **en attente**.
- Aucun reçu officiel n’est créé tant que l’opérateur Mobile Money n’a pas confirmé le paiement.
- L’admin voit l’intention dans l’historique des paiements en ligne.

## Ce qui n’est pas encore fait

- Pas encore de débit réel Orange Money.
- Pas encore de webhook Orange réel.
- Pas encore de reçu automatique après confirmation Orange réelle.

## Modèle financier conservé

Chaque école encaisse directement sur son propre compte marchand. Nexa Digital SARL ne reçoit pas les frais scolaires.
