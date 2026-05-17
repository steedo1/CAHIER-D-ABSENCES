# Paiement en ligne — Phase 4D

Objectif : corriger le point critique confirmé pendant le test interne.

Un paiement ne doit pas seulement passer au statut `succeeded`. Il doit aussi produire un reçu officiel et une allocation finance.

## Corrections

- Le service ne marque plus définitivement une intention comme confirmée avant création du reçu.
- Le reçu récupère l’année scolaire depuis la classe si la vue des soldes ne la renvoie pas.
- Si un reçu existe déjà pour la référence en ligne, l’intention est rattachée au reçu existant.
- En cas d’échec de génération du reçu, l’erreur est conservée dans l’intention au lieu de masquer le problème.
- L’historique admin affiche `Confirmé sans reçu` si une ancienne intention est dans cet état.
- En mode Test / Sandbox uniquement, un bouton de réparation permet de générer le reçu manquant sur une intention déjà confirmée.

## Règle métier

Statut confirmé sans reçu = anomalie technique à réparer avant Orange réel.

Orange Developer ne doit pas être branché tant que :

- le reçu officiel apparaît dans `/admin/finance/receipts`;
- le reste dû de l’élève diminue ;
- la ligne en ligne affiche un numéro de reçu ;
- un second webhook ne crée pas de doublon.
