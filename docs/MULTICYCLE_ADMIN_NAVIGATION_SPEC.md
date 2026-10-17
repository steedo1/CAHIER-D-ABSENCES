# Mon Cahier — Flux de navigation administrateur multicyle (spécification UX P0)

**Statut : proposition à valider avant réalisation des interfaces.**
**Contexte :** une seule application, plusieurs cycles, enseignements français et arabe. Aucun établissement n'est configuré par ce document. Les adaptations ne doivent jamais changer les interfaces d'une école non activée.

## 1. Concepts séparés (critique)
1. `school_cycle` : `preschool | primary | secondary` (cycle scolaire, pas l'actuel `education_type`).
2. `teaching_track` : `all | french | arabic` (organisation des enseignements, *pas* langue de l'interface). Intitulés métiers personnalisables.
3. `ui_locale` : `fr | ar` (traduction de l'interface / RTL, projet distinct).
4. Classe administrative/cohorte et groupes d'enseignement ne doivent jamais être automatiquement confondus : une même classe d'élèves peut apprendre les deux programmes, ou les groupes peuvent être distincts.
5. Pour le secondaire existant, `education_type` continue à signifier général, technique, professionnel, BTS.

## 2. Parcours d'accueil
```
Connexion Admin
  → Tableau de bord général (institution + année scolaire actuelle)
    → vue globale : élèves uniques actifs, classes administratives,
                   personnels uniques, finances, activités/alertes
    → cartes accessibles : Préscolaire | Primaire | Secondaire
    → raccourcis : inscrire élève, créer classe, enseignants, encaissement
    → administratif transverse : finances, rapports, communication, configuration
  → Sélection d'un cycle
    → vue de ce cycle
      → filtre enseignement : Tous | Français | Arabe (uniquement si activé)
      → filtre niveau → classe/groupe
      → module de travail → fiche/action → retour au même contexte
```

**Pas d'écran intermédiaire bloquant :** l'administrateur peut rester sur « Toute l'école » et filtrer à tout moment. Les cycles non activés ne s'affichent pas en menu courant. Un établissement secondaire historique conserve le tableau de bord et les chemins actuels, sans redirection surprise.

## 3. Barre de contexte persistante
- Établissement (nom/logo), année scolaire, cycle [Tout / Préscolaire / Primaire / Secondaire], enseignement [Tous / Français / Arabe], recherche classe/élève.
- Filtres dépendants : choisir cycle peut réinitialiser un programme/niveau/classe incompatible.
- Le contexte visible doit être sauvegardé dans URL et/ou état explicite contrôlé (p. ex. `school_cycle`, `teaching_track`, `class_id`), sans interférer avec `education_type`, `formation_code` existants.
- Bouton « Vue générale » et fil d'Ariane « Direction › Primaire › Arabe › CM2 › Enseignants ».
- Les droits et autorisations ne dépendent jamais d'un sélecteur client : validation serveur obligatoire.

## 4. Menu de gauche (une seule arborescence, pas 3 duplications)
### Direction générale / transversal
- Tableau de bord général
- Élèves & inscriptions
- Classes et groupes
- Enseignants & personnel
- Administration / rôles
- Finances : frais, encaissements, reçus, impayés, rapports
- Communication
- Statistiques générales, Correspondant fichier
- Paramètres : année, cycles, programmes, périodes, discipline, tarifs, sécurité
### Pédagogie (vue filtrée par cycle)
- Tableau de bord du cycle
- Emplois du temps & affectations
- Assiduité / conduite
- Disciplines
- Cahier de texte (selon cycle)
- Évaluations (notes primaire/secondaire ; compétences préscolaire)
- Bulletins (primaire/secondaire) / Livrets (préscolaire)
- Bilan pédagogique / rapports
### Particularités
- Préscolaire : compétences, observations, livret sans note /20 imposée.
- Primaire : évaluations, sous-matières et coefficients configurables, bulletins adaptés.
- Secondaire : ne pas modifier/réécrire l'organisation et les outils déjà opérationnels.
- Plusieurs enseignants par classe, associations précises par discipline et éventuellement groupe, sans supprimer leurs autres affectations.

## 5. Flux opérations
- Élève : Direction > Inscrire > année > cycle > classe administrative > identité > responsable > enregistrer; enseignements seulement via configuration pédagogique. Une identité, aucun doublon dû au Français/Arabe.
- Enseignant : Personnel > créer/choisir > affecter discipline(s), classe(s)/groupe(s) > vérifier multi-affectation. Pas de création de compte de connexion sans données de contact validées.
- Finance : Direction > Finances > opérations globales ou par cycle; total de l'école agrégé **sans double compter** l'élève qui suit deux enseignements.
- Notes : choisir cycle et classe > discipline > période > saisie > rendu adapté à la pédagogie du cycle.
- Retour : conserver le cycle, programme et classe; aucune réinitialisation automatique en secondaire général.

## 6. Ordre de développement
1. Lire `school_cycles_v1` *sans DDL*, affichage conditionnel derrière activation par établissement.
2. Installer une barre de contexte au-dessus du contenu **uniquement** pour les écoles multicylces; dashboard général avec accès cycles, sans interrompre l'ancien shell.
3. API serveur read-only des cycles/classes/élèves actifs : institution_id + année scolaire, permissions, pagination.
4. Menu adapté : réutiliser `src/app/admin/ui/sidebar-nav.tsx` et `shell.tsx`; rester compact sur mobile.
5. Brancher modules communes (classes, élèves, enseignants, finances) au périmètre sélectionné et préserver les règles de lecture offline.
6. Adapter primaire/preschool pédagogiquement avec modèles approuvés, traductions PDF arabes testées séparément.
7. Vérifier TypeScript, tests CI, Preview Vercel READY, sécurité multi-établissements; seulement ensuite envisager fusion en PROD.

## Règle métier définitive — moyennes franco-arabes

Décision confirmée : **ne jamais mélanger les moyennes de l'enseignement français et de l'enseignement arabe**.

- Un élève dispose d'une seule identité et inscription administrative, mais de deux parcours pédagogiques possibles.
- Pour chaque parcours, le calcul utilise uniquement ses propres matières, notes, barèmes et coefficients validés ; un classement éventuel est propre à ce parcours.
- Un document imprimé peut comporter les deux bulletins côte à côte ou l'un à la suite de l'autre, mais ne présente **aucune moyenne franco-arabe générale**. `format: combined` signifie seulement « présentation regroupée », pas « fusion mathématique ».
- La valeur `combinedAverage` du contrat de préparation reste strictement `null` pour empêcher les présentations de déduire une moyenne commune.
- Ne jamais faire une moyenne des deux moyennes, même pondérée et même si elles sont toutes deux sur /20.
- Les contrôles de préparation (actuellement hors production) doivent être conservés dans les futures API et modèles PDF.
- **Ne pas modifier** les règles des bulletins historiques des établissements non activés (notamment CSCA).

## Maquettes A4 de bulletin — décision d'interface

- Trois présentations professionnelles, avec typographie institutionnelle, palette vert foncé / bleu / or et impression A4 : bulletin **français**, bulletin **arabe**, et **document regroupé**.
- La présentation regroupée n'agrège **jamais** les moyennes des deux programmes : chaque tableau, chaque moyenne et chaque classement restent dans son enseignement.
- **Ne pas afficher le bandeau d'avertissement rouge « Aucune moyenne franco-arabe globale » sur les bulletins.** La séparation s'exprime par les sections et l'absence de moyenne commune, sans explication alarmiste.
- Le modèle peut être prévisualisé par le Super Admin depuis `/super/cycles/bulletins-preview` avec des **données fictives** clairement signalées. Les signatures, tampons et logos réels seront fournis/configurés par l'établissement ; ne jamais inventer de tampon officiel.
- Le composant réutilisable `FrancoArabicBulletin` consomme des données de bulletin **déjà autorisées côté serveur**. Il ne cherche pas les notes, ne crée pas d'élèves, ne remplace pas le bulletin historique et n'autorise pas les nouveaux directeurs.
- L'impression utilise une mise en page A4 CSS. La vérification visuelle des sauts de page, la connexion au moteur de notes et l'export PDF métier restent des étapes distinctes, avant toute fusion en production.

## Correction de gouvernance des bulletins — 16 octobre 2026

Le Super Admin est le gestionnaire **commercial et technique de la plateforme** :
établissements, abonnements et activation initiale des cycles proposés. Il ne gère
**aucun bulletin**, matière évaluée, moyenne, coefficient pédagogique ou maquette
d'élève. L'ancien éditeur et les anciennes API `/super/.../franco-arabic-reports`
ainsi que la prévisualisation Super Admin ont été supprimés.

La **direction / administration scolaire** autorisée possède l'organisation
pédagogique : disciplines enseignées par cycle/track, règles de coefficient par
niveau, formats de bulletin, responsables et validations. Ces opérations sont
scopées côté serveur sur l'`institution_id` de sa session et ne prennent
jamais un identifiant d'établissement depuis le navigateur.

- École primaire **ordinaire** : document « Bulletin de notes », section
  « Résultats scolaires », « Moyenne générale », « Direction de l'établissement ».
  Aucune étiquette « Programme français » ni page arabe.
- École **franco-arabe** : deux ensembles pédagogiques autonomes, avec option
  de présentation regroupée qui n'agrège jamais les deux moyennes.
- Les matières ne sont pas codées en dur sur le bulletin : elles proviennent du
  catalogue **activé pour l'établissement**. Les listes effectivement prises en
  compte sur un bulletin donné sont définies par `cycle + niveau (CP1, CP2,
  CE1, CE2, CM1, CM2...) + enseignement + coefficient`. On n'étend pas à
  un CP1 l'ensemble des matières déclarées pour tout le primaire.
- Les noms de disciplines et coefficients montrés dans les **maquettes**
  restent fictifs. **La conformité aux programmes officiels français et arabes
  de chaque niveau n'est PAS encore vérifiée ou renseignée automatiquement.**
  Ne pas revendiquer un référentiel national exhaustif tant qu'il n'a pas été
  validé à partir de documents officiels et de bulletins de l'établissement.
- Entrée admin seulement si cycles activés : `/admin/bulletins/modeles`.
  Les anciens établissements continuent d'utiliser `/admin/bulletins` ;
  le moteur de notes existant n'est pas remplacé à ce stade.
- Un rôle Super Admin ne dispose plus de route dédiée pour sauvegarder ou
  prévisualiser les modèles ; et la route de provisionnement des cycles conserve
  les répartitions pédagogiques existantes sans pouvoir les modifier.

## 7. Non-objectifs / garde-fous
- Ne pas créer l'EPC ou aucune de ses classes avant stabilisation du code.
- Ne pas supposer que « CP1 Français » et « CP1 Arabe » sont deux cohortes distinctes.
- Aucun `db push`, DDL ni migration sur Supabase PROD dans cette phase.
- Les nouveaux contrôles ne doivent jamais élargir l'accès aux tables sans RLS déjà signalées.
- Préserver CSCA, Dieudonné, Notre Dame, PWA offline, modules finances, notes, Parent Connect.
- Pas de chiffres démo présentés comme de vraies données, pas de pages « prêtes » sans tests.

## 8. Critères d'acceptation UX
- Un admin d'école multicyle voit l'ensemble en une connexion.
- Il atteint Primaire > Arabe > CM2 > enseignants en quelques actions, sans changer de logiciel.
- Il revient au même contexte après ajout, consultation et retour.
- Le nombre d'élèves de l'école et les créances ne doublent pas selon les programmes.
- Un admin du CSCA garde exactement l'expérience actuelle.
