# QR des bulletins avec bilans et professeurs

Base : production `4ab7bbc8ca237d7d7a037359d0ca5e22d6d10c49` (PR #110).

## Constat

Le domaine public sert désormais la PR #110, vérifié par l'affectation Vercel.
La nouvelle capture concerne l'aperçu de 1A, trimestre 1 de 2026–2027, CSCA.
Le rechargement Ctrl+F5 n'a pas fait apparaître le QR. Une lecture Supabase
confirme l'absence de code court pour la référence de la capture ; aucune
écriture de diagnostic n'a été effectuée.

Le premier test reproduisait douze matières simples. Une fixture synthétique
avec les champs réels de la route (professeurs, identifiants, NC et trois
bilans) produit une URL compressée d'environ 2568 caractères. Avant ce
complément, le rendu serveur au niveau M échoue et renvoie un PNG null.
Le secours navigateur est plus restrictif, au niveau Q. La compression seule
ne couvre donc pas ce cas. La taille citée est celle de la fixture ; la réponse
authentifiée exacte du bulletin de l'utilisateur reste à comparer.

## Modification

Un générateur commun conserve le niveau graphique demandé tant qu'il peut
encoder l'URL. Il descend de H vers Q, M puis L uniquement lorsqu'une erreur
de capacité survient. Les erreurs de canvas/configuration restent signalées.
L'API et les deux pages de bulletins l'utilisent. Le contenu de l'URL, le HMAC,
le snapshot complet, les notes, les rangs et les dates restent identiques.
Une impossibilité de produire le PNG est désormais journalisée côté serveur,
avec longueur d'URL et niveau graphique uniquement, sans token ni donnée scolaire.

## Vérification

- 13/13 tests QR et consommation réussis, dont le cas auparavant en échec.
- Le PNG est produit pour le bulletin NC avec bilans et professeurs.
- Le secours navigateur passe Q → M → L avec le même texte à scanner.
- Les codes courts conservent Q ; les anciens tokens restent acceptés.
- Le snapshot signé est identique après vérification ; zéro écriture sur GET.
- Lint des fichiers modifiés : zéro erreur, avertissements déjà présents.
- Les suites QR sont déjà exécutées par le gate CI.

La capacité maximale d'un QR reste finie et L offre moins de résistance aux
dommages graphiques. L'émission explicite pour impression conserve les codes
courts. Après promotion du déploiement Production prêt (menu **Promote**),
rouvrir ce bulletin, vérifier aperçu et impression, puis scanner le QR.
