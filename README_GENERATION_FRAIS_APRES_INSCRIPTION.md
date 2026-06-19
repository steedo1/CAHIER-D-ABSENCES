# Génération des frais après inscription minimale

Ce correctif ne change pas la logique d'encaissement de Mon Cahier.
Il fait seulement ceci : après l'inscription minimale d'un élève, Mon Cahier crée les situations financières ouvertes à partir des barèmes actifs déjà définis pour la classe.

Si aucun barème actif n'existe pour la classe, aucun frais n'est créé : il faut alors définir ou régulariser les barèmes de cette classe.

Fichiers modifiés par le script :

- `src/app/admin/finance/payments/page.tsx`
- `src/app/api/admin/classes/[id]/roster/route.ts`

SQL fourni :

- `sql/generate_charges_for_csca_kouadio_ange_students.sql`

Ce SQL sert uniquement à générer les frais manquants pour les élèves test KOUADIO ANGE déjà inscrits au CSCA.
