# QR absent dans l'aperçu d'un bulletin ancien

Base : commit actuellement servi par `www.mon-cahier.com`, `4cc157f385b5ee008b492349173487e1092c1ff2`, déploiement Vercel `dpl_884BJfQtmtXcCXUevwAEUT5kJjys`. Le checkout isolé est aligné sur ce commit. La branche `codex/supabase-traffic-production-20261006` est conservée ; la PR #89 précédente est déjà fusionnée.

## Diagnostic

La capture montre un aperçu du troisième trimestre 2025-2026, référence `BUL-562B24EA20D7`, avec le texte de remplacement « QR ». En lecture seule, aucun code court n'est enregistré pour cette référence dans `bulletin_qr_codes`. La clé de signature est configurée pour Production et Preview (seule sa présence a été consultée, jamais sa valeur).

La route GET ne crée volontairement aucun code court pour éviter des INSERT à chaque consultation/préparation automatique. Elle utilise alors une URL signée contenant le snapshot complet : moyennes, rangs, matières, groupes et détails. Sans compression, ce contenu peut dépasser la capacité d'un QR. Le serveur renvoie alors `qr_png: null` ; le générateur du navigateur rencontre la même limite et garde le cadre vide.

Le scénario est reproduit avec les fonctions réelles de la route et une fixture de douze matières : JSON d'environ 4 370 octets, URL d'environ 5 916 caractères ; `qrcode` échoue avec « The amount of data is too big to be stored in a QR Code ». Ce sont des mesures sur une fixture, pas sur la réponse authentifiée exacte de l'utilisateur. Le bulletin réel reste à vérifier dans la Preview avec son compte.

## Correction ciblée

- Le signataire partagé compresse les grands payloads avec Deflate avant de les encoder et de signer. Le préfixe `z:` distingue ce format ; les petits tokens gardent le format historique.
- Le vérificateur contrôle le HMAC avant toute décompression, borne la sortie à 128 Kio et refuse les données invalides. Il conserve la lecture des anciens tokens JSON.
- La route bulletin appelle ce signataire partagé. Aucune modification des calculs, du snapshot, du code court enregistré, de l'année ou de la période.
- Les tests QR de consommation et de secours sont ajoutés au gate CI existant.

Même fixture après correction : URL d'environ 1 450 caractères, PNG généré et contenu complet retrouvé après vérification de la signature. Le code court existant reste prioritaire. Le GET conserve une lecture groupée et zéro écriture.

## Vérification

Les deux nouveaux cas qui échouaient sur la production passent après correction. Suite ciblée : **10/10 réussis**. Elle couvre le bulletin ancien sans code court, son PNG, l'année et les dates historiques, tous les détails du snapshot, la réutilisation du code court, les anciens tokens, le refus des modifications du token, des données compressées invalides et des décompressions trop grandes.

```sh
node --test test/bulletin-qr-fallback.test.mjs test/bulletin-qr-consumption.test.mjs
```

Build, typage et résultats CI finaux sont référencés dans la nouvelle PR avec le commit et l'URL Preview.

Fichiers : `src/lib/bulletin-qr.ts`, `src/app/api/admin/grades/bulletin/route.ts`, `test/bulletin-qr-fallback.test.mjs`, `.github/workflows/offline-go-live.yml` et ce rapport. Aucun changement de dépendance, migration, RLS ou écriture Supabase effectué.

## Recette et limites

Ouvrir le bulletin du troisième trimestre 2025-2026 en Preview, vérifier le QR et sa lecture, puis un bulletin courant et un bulletin possédant déjà un code court. Tester l'aperçu et l'impression. Les URL du QR pointent vers le domaine public : le nouveau format compressé ne sera reconnu par ce domaine qu'après déploiement du correctif de vérification ; avant fusion/promotion, vérifier son décodage sur le même déploiement Preview.

Les gros snapshots produisent un QR plus dense qu'un code court ; les snapshots exceptionnellement grands peuvent toujours dépasser la capacité du QR même compressés. L'émission explicite pour impression conserve le code court. Aucun nouvel INSERT automatique n'est ajouté pour contourner cette limite. Ni fusion ni promotion automatiques pour ce correctif.
