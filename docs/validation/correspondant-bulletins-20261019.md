# Vérification des bulletins du Correspondant Fichier — 19 octobre 2026

## Problème reproduit

Version active contrôlée : `278381f4f71a3b7f60853d011724d8715155b856`,
déploiement Vercel de production `dpl_AWoUZcH2EBskmx4Q7KXbkbmShDzx`, READY,
affecté à `www.mon-cahier.com`.

Le layout du rôle `file_correspondent` utilise son propre shell, sans
`SchoolNavigationProvider`. Le calendrier des bulletins primaires dépendait
exclusivement de ce provider réservé à l’administrateur. Le compte Correspondant
Fichier restait donc sur le sélecteur des périodes, même avec un calendrier
d’évaluations datées déjà configuré.

Reproduction Chromium avant correction : délai dépassé en attendant
`#primary-bulletin-event option[value="DEC"]`, sans appel à l’API du calendrier
primaire. Aucun problème de calcul n’était nécessaire pour déclencher le défaut.

## Correction

Le hook partagé réutilise les paramètres institutionnels déjà chargés et
autorisés par les deux écrans existants de bulletins lorsque le provider est
absent. Le parcours administrateur conserve son contexte de navigation. Les
autorisations serveur du calendrier et des bulletins sont inchangées ; le
Correspondant Fichier consulte sans recevoir de droits d’écriture supplémentaires.

Aucune nouvelle interface, dépendance, migration, DDL ou modification de données
scolaires. Le secondaire historique et les règles CSCA restent inchangés.
La branche de travail est exclue des builds Vercel automatiques.

## Validation locale

- Contrôle TypeScript réussi : `NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck`.
- 64 tests réussis : événements primaires, parcours du bulletin primaire,
  intégration du bulletin spécialisé, adaptations historiques du secondaire.
- 9 contrôles Chromium/PDF réussis : parcours administrateur et véritable rôle
  `file_correspondent` sans provider ; lecture du calendrier et du bulletin par
  les handlers réels ; présentations française/arabe et directeurs distincts ;
  logo ; changements CP1 → CM2 → CP1 ; réinitialisation de l’évaluation ; aucun
  passage CP1–CM1 proposé au CM2 ; aucune écriture lors de la consultation.
- Six variantes PDF (français/arabe/combiné, ordinaire/passage) : une A4 par élève,
  barèmes, résultats distincts et récapitulatif annuel. Inspection visuelle du PDF
  combiné de passage effectuée.
- `git diff --check` réussi.

Les tests utilisent les composants et handlers réels avec un transport Supabase
synthétique ; aucune note réelle n’est créée et aucune notification n’est envoyée.

## Constat réel EPC, en lecture seule

L’établissement E020684 a bien un logo, les noms des deux directeurs et sept
événements configurés pour 2026–2027, dont l’évaluation de niveau du 22 octobre.
Au moment du contrôle, deux colonnes CP1 français existent mais ne contiennent
aucune note ; aucune note publiée officielle n’est disponible pour EPC. Il est
donc impossible de valider un bulletin EPC rempli avec des résultats réels à ce
stade. Les notes absentes ne doivent pas être présentées comme des zéros.

Le navigateur de test n’avait pas de session Mon Cahier connectée : l’ouverture
directe en production a affiché la demande de reconnexion. La recette visuelle
authentifiée en production n’est pas revendiquée. Aucun accès de substitution
ni modification des droits n’a été effectué pour contourner la connexion.

## Commandes de recette

```sh
NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck
node --import tsx --test test/primary-events-integration.test.mjs test/primary-bulletin-workflow.test.mjs test/specialized-bulletin-integration.test.mjs test/secondary-historical-layout.test.ts test/secondary-franco-arabic-historical-reuse.test.ts
npm run test:primary-events:browser
```

Les contrôles GitHub de la PR et l’état du déploiement après fusion doivent être
consultés séparément avant d’annoncer la livraison en production.
