# Point de sauvegarde — 17 octobre 2026

Ce point conserve tout le développement local démarré depuis `6d6799fe7c0e39de011b417b99179f4b00bc1fe4`, avant les corrections complémentaires de l’audit utilisateur. Ce n’est pas une validation de mise en production.

## Intégré localement

- Formulaire Super Admin et API de création existants enrichis pour les cycles et enseignements ; menu réel et liste raccordés.
- Conservation des paramètres pédagogiques et contrôle des écritures concurrentes, protections de rôles et clés réservées.
- Navigation par cycle, niveau, classe et enseignement dans les modules existants.
- Création des classes préscolaires/primaires par le module existant, sans nouveau schéma ni nouvelles séries du secondaire.
- Compatibilité des deux identifiants de matières dans les nouveaux comptages et aperçus d’import.
- Sélection du moteur côté serveur, historique par défaut ; réutilisation du calculateur et des modèles franco-arabes existants.
- Raccordement du moteur spécialisé à l’API et à la page de bulletins existantes ; lecture des seules versions courantes des notes officiellement publiées.
- Résolveur de coefficients avec une seule autorité active par contexte ; résultats et rangs français/arabe indépendants.
- Contrat qualitatif préscolaire conservé ; comptes de directions restreints toujours bloqués tant que leur isolation complète n’est pas intégrée.

## Vérifications obtenues avant ce point

- 87 tests multicycles ont passé sur un état antérieur aux dernières retouches de navigation et de présentation. Ils comprennent une comparaison des résultats du bulletin historique avec le commit de départ sur des jeux synthétiques CSCA, Dieudonné et Notre Dame.
- Des tests supplémentaires de classes, identifiants et coefficients ont passé séparément.
- Une passe TypeScript a réussi avant les derniers ajustements. Le build Next.js a ensuite compilé le code, mais échoué sur la signature optionnelle de `GET` dans `/api/admin/school-cycles` : le paramètre doit être requis pour les types de routes générés par Next.
- Lint des fichiers modifiés : dernière passe à 0 erreur et 20 avertissements, avant quelques retouches finales. Lint global : première passe à 152 erreurs et 342 avertissements, comprenant de nombreux fichiers hors périmètre ; ce résultat n’est pas un lint global réussi.
- Trois PDF de contrôle synthétiques ont été générés, extraits et rendus avec Poppler : primaire français, regroupé bilingue, et regroupé long. Tous sont A4 ; les documents courts ont 2 pages pour 2 élèves, le document long 4 pages. Les pages examinées ont du contenu lisible, y compris arabe, et des tableaux poursuivis avec leurs en-têtes.
- Le parcours complet navigateur reste non validé : les tentatives sur le serveur de développement ont été perturbées par la compilation à froid et les délais de connexion. Un passage sur le serveur issu du build reste à faire.

Les journaux et PDF se trouvent dans `OPTIMISATION`, hors du dépôt applicatif, notamment `verification/specialized-print-20261017`. Ils ne constituent pas des bulletins d’établissement réel.

## Corrections prioritaires demandées à la reprise

1. Corriger la signature Next.js, puis normaliser les équivalences pédagogiques dans les barèmes, coefficients, programmes et filtres sans confondre les séries, divisions ou niveaux primaires.
2. Vérifier les copies de correctifs disponibles et intégrer seulement ce qui manque.
3. Remplacer les parcours répétés du classement spécialisé par un calcul par programme, en conservant les ex æquo.
4. Empêcher l’impression trompeuse d’un bulletin incomplet, y compris par Ctrl+P ; le seul bouton désactivé ne suffit pas.
5. Rejouer les tests sur le dernier état local, TypeScript, lint ciblé, build et parcours navigateur ; compléter les régressions hors ligne, Parent Connect et Finance.

## Limites fonctionnelles encore ouvertes

- Matières partagées : pas de programme fiable porté par les évaluations actuelles ; blocage conservé, aucune déduction depuis le nom ou le filtre d’interface. Une solution sans DDL doit être étudiée et validée avant activation de ce cas.
- Inscriptions individuelles à un sous-ensemble des programmes : rattachement explicite à terminer sans dupliquer les élèves.
- Préscolaire : catalogue de compétences, saisie et persistance des observations, puis génération du livret opérationnel à raccorder.
- Imports : aperçu sans écriture préparé, mais intégration au parcours existant et import effectif contrôlé à terminer. Aucune importation réelle de CEIFAD autorisée.
- Directions française/arabe : appliquer et vérifier les périmètres sur toutes les routes avant de provisionner ces comptes.
- Vérifier les parcours complets de création, classes, affectations, saisie/publication et bulletins dans les vrais écrans.

Aucun push, déploiement, changement du schéma Supabase, `db push`, mutation d’établissement réel ni fusion en production n’est réalisé par ce point de sauvegarde. Le push groupé exige la validation de l’utilisateur.
