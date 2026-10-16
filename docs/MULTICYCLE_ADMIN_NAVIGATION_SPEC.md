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
