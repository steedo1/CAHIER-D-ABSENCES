# Finance — inscription simple + nettoyage élèves test CSCA

## Ce patch fait 3 choses

1. Dans **Finance > Caisse et inscriptions > Nouvelle inscription**, les catégories sont retirées.
   - On inscrit seulement l’élève avec : nom, prénom(s), matricule facultatif, classe.
   - Aucun montant, aucune catégorie, aucun reçu n’est créé à cette étape.
   - Après inscription, l’écran revient sur le module paiement avec l’élève pré-sélectionné.

2. Dans **Organisation scolaire > Liste des classes > Liste d’une classe**, un bouton **Inscrire un élève** est ajouté.
   - Il permet d’ajouter rapidement un élève avec les informations minimales.
   - La liste se recharge automatiquement après inscription.

3. Le SQL `sql/delete_csca_test_kouadio_ange_students.sql` supprime les élèves de test CSCA dont le nom commence par `KOUADIO ANGE`, ainsi que les données liées.

## Fichiers modifiés

- `src/app/admin/finance/payments/page.tsx`
- `src/app/admin/finance/payments/PaymentsComposer.tsx`
- `src/app/admin/classes/liste/[id]/page.tsx`
- `src/app/api/admin/classes/[id]/roster/route.ts`
- `sql/delete_csca_test_kouadio_ange_students.sql`

## Test recommandé

1. Exécuter le SQL de nettoyage dans Supabase.
2. Lancer `npm run build`.
3. Tester :
   - Finance > Caisse et inscriptions > Nouvelle inscription
   - Organisation scolaire > Liste des classes > Liste d’une classe > Inscrire un élève
