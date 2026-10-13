# Scan des QR de l'aperçu — 13 octobre 2026

Base exclusive : production `faf25bacfe96f6ec9461c96e45f105d20d71c32f`, PR #111. Branche existante conservée.

La capture du bulletin 2025–2026 montre désormais une image QR, mais le téléphone ne détecte aucun lien. Le domaine public a été vérifié au commit ci-dessus. Le lecteur ZXing-C++ 2.3.0 ne décode pas non plus cette capture. Les deux aperçus réduisent leur PNG à 104 pixels : un token contenant tout le snapshot produit beaucoup trop de cellules pour cette taille.

Une fixture synthétique de douze matières avec professeurs et bilans reproduit le défaut avec le véritable signataire et le générateur du projet. La fixture ne représente pas la réponse authentifiée exacte du bulletin de l'utilisateur.

| QR de fixture | URL | Cellules par côté | Décodage à 104 px | À 128 px | À 600 px |
|---|---:|---:|---|---|---|
| Token compressé signé, niveau L, marge 2 | 2568 caractères | 169 | Échec | Échec | URL exacte |
| Code court émis par le nouveau helper, niveau Q, marge 4 | 49 caractères | 33 | URL exacte | URL exacte | URL exacte |

Les comparaisons de l'URL décodée utilisent son SHA-256. Le QR dense est réduit avec interpolation ; le QR court utilise le rendu sans lissage ajouté au composant. Le test ne garantit pas tous les appareils, distances ou qualités d'impression. La marge de quatre modules suit [la documentation DENSO WAVE](https://www.qrcode.com/en/howto/code.html).

Le correctif prépare les codes courts uniquement lorsque l'utilisateur ouvre ou recharge un aperçu en ligne et qu'un item possède encore un token. Le POST envoie le token déjà signé : aucune nouvelle lecture ni aucun recalcul des notes. Le serveur reprend le contrôle de session et de rôle existant, vérifie le HMAC, l'établissement et l'appartenance des classes, puis réutilise les codes correspondant exactement aux snapshots. Les demandes sont bornées à cinquante élèves ; les appels simultanés identiques sont mutualisés. Aucune relance automatique.

Le GET, la préparation automatique hors ligne et les exports restent en lecture seule. Un aperçu déjà pourvu de codes ne lance pas ce POST. Les snapshots préparés en ligne sont mémorisés dans le cache hors ligne existant du parcours principal. Si la préparation QR échoue, l'aperçu reste disponible et affiche l'échec. Le POST d'impression existant est conservé.

Un nouveau snapshot sans code correspondant nécessite un enregistrement. Une réouverture inchangée n'en crée aucun. Les codes ne remplacent plus le contenu d'un brouillon déjà scannable : une version modifiée reçoit un autre code déterministe, les QR antérieurs restent consultables avec leurs notes initiales. Cela conserve plusieurs versions lorsqu'il y a réellement des changements ; ce n'est pas une purge ni une écriture à chaque consultation. Aucun schéma, RLS, calcul, note, rang ou donnée financière modifié.

Validation locale : 26/26 tests QR et consommation ; lint des fichiers concernés, zéro erreur et 28 avertissements préexistants ; `git diff --check` propre. Tests ajoutés au gate CI : lien court et snapshot exact, réutilisation de cinquante bulletins en deux lectures groupées et zéro écriture, versions immuables, codes officiels, HMAC altéré, autre établissement/classe, origine/session refusées, lots bornés, double ouverture, erreur partielle et mode hors ligne. Revue React : imports serveur séparés du client, préparation dans les handlers, boutons désactivés pendant chargement, alerte accessible, aucune modification de hooks ou de calculs.

La CI et la compilation Vercel du commit exact doivent réussir avant fusion. Aucun test de diagnostic n'a écrit en production. La recette authentifiée et le scan sur téléphone restent à effectuer par l'utilisateur après sa promotion manuelle.

Recette : promouvoir le déploiement Production READY indiqué par la PR, fermer l'aperçu, Ctrl+F5, rouvrir le même bulletin dans Bulletins, scanner. Vérifier que le lien court `/v/...` ouvre le bon élève, la bonne année et les mêmes notes/rangs. Réouvrir sans modification doit conserver le code. Vérifier aussi l'impression et le bulletin préparé hors connexion.
