# Mon Cahier — Paiement en ligne — Phase 4C

## Objectif

Ajouter un tunnel de test interne pour vérifier la réaction de Mon Cahier sans passer par la console du navigateur ni par Orange Developer.

## Ce que cette phase permet

- Simuler un échec opérateur sur une intention en attente.
- Simuler un succès opérateur sur une intention en attente.
- Créer automatiquement le reçu officiel uniquement lors d'une simulation de succès.
- Ne jamais créer de reçu lors d'une simulation d'échec.
- Garder l'admin en consultation opérationnelle : ces boutons sont uniquement visibles pour le tunnel interne de test.

## Garde-fous

Le tunnel interne refuse l'action si :

- l'intention ne dépend pas de l'établissement connecté ;
- le fournisseur n'est pas Orange Money ;
- le compte marchand n'est pas actif ;
- le compte marchand n'est pas en environnement Test / Sandbox ;
- aucun Webhook secret n'est enregistré ;
- l'intention est déjà expirée, échouée ou annulée.

## Parcours de test recommandé

1. Côté parent, créer une nouvelle intention de paiement.
2. Côté admin, aller dans `/admin/finance/online-payments`.
3. Sur la ligne en attente, cliquer sur `Simuler échec`.
4. Vérifier que le statut devient `Échoué` et qu'aucun reçu n'est créé.
5. Créer une autre intention fraîche.
6. Cliquer sur `Simuler succès`.
7. Vérifier que le statut devient `Confirmé` et qu'un reçu officiel est lié.

## Important

Cette phase ne branche toujours pas Orange Money réel. Elle valide le moteur interne avant de connecter l'API opérateur.
