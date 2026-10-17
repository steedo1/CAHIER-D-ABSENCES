# Correctifs d’audit multicycle — lot local du 17 octobre 2026

Le commit `d0f3b4a8` conserve le travail antérieur. Ce lot poursuit ce travail dans `multicycle-finalisation`, sur `feat/multicycle-franco-arabe-20261016`. Il ne crée ni nouvelle application, ni nouveau moteur de calcul, ni registre supplémentaire de notes ou de coefficients.

## Corrections intégrées

- Normalisation commune des niveaux pédagogiques dans les barèmes, politiques de coefficients, recherche du programme réel, navigation, filtres et création multicycle des classes : `6e`, `6ème`, `6eme`, `6EME` désignent le même niveau. Les autres niveaux du collège et variantes de seconde, première et terminale sont également traités. A, A1, A2, C et D restent distincts, de même que CP1/CP2, CE1/CE2 et CM1/CM2. Les identifiants et libellés des classes physiques ne sont pas fusionnés par ce normaliseur.
- Conservation de la normalisation historique des coefficients dans `official-grade-level.ts`. Le moteur spécialisé utilise le nouveau normaliseur strict ; le moteur historique reste inchangé.
- Les matières d’un catalogue réellement configuré pour un autre niveau ne sont plus remplacées par une liste déduite des coefficients. Une configuration manquante produit un résultat incomplet. Le mode institution utilise `institution_subject_coeffs`, le mode programme utilise ses politiques explicites ; leurs poids ne sont jamais mélangés.
- Les doublons de barèmes ou politiques sur deux alias du même niveau sont rejetés. Une configuration explicitement spécialisée mais invalide provoque une réponse 409, sans retour silencieux au bulletin historique.
- Les rangs sont calculés une fois par enseignement, par tri, avec classement de compétition `1, 2, 2, 4`. Les résultats incomplets ne participent pas. Les notes sont regroupées une fois par élève et les rattachements des matières une fois par catalogue, sans requêtes par élève.
- L’API existante transmet la validation de chaque enseignement. L’impression française peut être autorisée indépendamment de l’arabe ; le regroupé exige les deux. Les aperçus incomplets portent « BROUILLON · NON VALIDÉ ».
- Le bouton et Ctrl+P utilisent l’action d’impression de la page existante, qui relit les publications. La feuille d’impression refuse aussi l’impression native des résultats incomplets, pendant la préparation ou après un échec : elle ne contient alors qu’un message de refus, sans identité, notes, moyennes ni signatures.
- La signature de la route `GET /api/admin/school-cycles` est corrigée pour les types de routes générés par Next.js.

## Vérification locale

Les vérifications utilisent exclusivement des identités et données synthétiques. Les tests de régression du bulletin historique comparent les calculs au commit de départ `6d6799fe7c0e39de011b417b99179f4b00bc1fe4` pour des jeux CSCA, Dieudonné et Notre Dame ; ils ne prouvent pas une validation sur leurs données de production.

Les journaux restent hors du dépôt, dans `OPTIMISATION`, avec le préfixe `multicycle-audit-`. Les PDF et rendus sont dans `verification/specialized-print-20261017`. Le script `npm run test:multicycle:print` contrôle les vrais modèles et la feuille d’impression, après chargement des données par la véritable route de bulletin sur une fixture isolée.

- `npm run test:multicycle` : **99/99 réussis**, y compris le test d’interface du bouton et de Ctrl+P, le refus des configurations spécialisées invalides et les comparaisons du moteur historique.
- Régressions Parent Connect, Finance, notes et hors ligne : première passe **163/166** ; les trois échecs proviennent de `git show` dans les tests hors ligne, bloqué par la propriété Windows du worktree. Rejeu du fichier concerné avec une exception Git limitée au processus et à ce seul dépôt : **25/25 réussis**, dont les trois cas initialement bloqués. Aucun changement de l’application ou de la configuration Git globale pour ce rejeu.
- `npm run typecheck` : réussi ; le build contrôlera aussi les types de routes générés sur le dernier état.
- ESLint sur les fichiers de développement modifiés depuis le commit de départ : **0 erreur, 19 avertissements**. Le lint global n’est pas déclaré réussi ; la passe antérieure signalait de nombreux problèmes hors périmètre.
- Impression : **6 scénarios PDF réussis** en A4 — primaire français, arabe seul, regroupé, regroupé long, regroupé incomplet bloqué, français complet avec arabe incomplet. Les cas courts produisent 2 pages pour 2 élèves, le long 4 pages ; le cas bloqué ne produit qu’une page de refus, sans identité ni résultats. Contrôle du texte et des dimensions par `pypdf`, puis rendu Poppler et inspection visuelle des pages arabe, regroupée, longue et de refus.
- Build : résultat de clôture à compléter après la fin de la vérification en cours.

## Archive préparée dans ChatGPT

Le dossier `/mnt/data/moncahier_multicycle_work` appartient à un autre environnement. L’archive annoncée est `Lot2_Correctifs_MonCahier_Multicycle_SansPush_20261017.zip`, attendue dans Téléchargements. Tant qu’elle n’est pas disponible ici, sa comparaison ne peut pas être déclarée réalisée. À réception : inspection séparée, comparaison avec ce lot, puis intégration des seules améliorations manquantes. Aucun remplacement global des fichiers actuels.

## Intégration opérationnelle restant à terminer

1. Compléter le raccordement des affectations, coefficients et imports aux parcours existants, en vérifiant les deux familles d’identifiants de matières sur les routes réelles de lecture et d’écriture. L’aperçu d’import préparé ne constitue pas encore un import effectif validé. La normalisation stricte doit aussi être vérifiée dans l’éditeur historique pour les séries génériques A : son comportement historique A→A2 est volontairement conservé pour les établissements existants et ne doit pas modifier une configuration spécialisée A distincte.
2. Vérifier tout le parcours classe → affectation → saisie → publication → bulletin dans les écrans existants. Les bulletins spécialisés fonctionnent pour les programmes configurés au niveau du cycle ; les inscriptions individuelles à un sous-ensemble des enseignements restent à raccorder explicitement.
3. Conserver le blocage des matières partagées tant que les évaluations ne possèdent pas de rattachement fiable à un enseignement. Aucun rattachement n’est déduit du nom ou d’un filtre d’écran.
4. Terminer les périmètres serveur des directions française/arabe sur toutes les routes concernées avant de permettre la création de leurs comptes restreints.
5. Raccorder le catalogue de compétences, la saisie et la persistance des observations préscolaires dans les modules existants, puis générer le livret ; aucun calcul numérique de moyenne n’est appliqué au préscolaire.
6. Comparer l’archive lorsqu’elle arrive, terminer la recette navigateur et examiner les limites de lint global avant toute publication groupée.

Aucun push GitHub, déploiement, changement de schéma Supabase, `db push`, import CEIFAD, modification d’établissement réel ou fusion en production n’est autorisé par ce lot. Le push groupé reste soumis à la validation explicite de l’utilisateur.
