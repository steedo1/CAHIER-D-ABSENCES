# Mon Cahier — suivi du déploiement RAM, 21 octobre 2026

## Périmètre et autorisation

L’utilisateur a autorisé la mise en production contrôlée de la correction et a enregistré lui-même les commandes dans Render, son navigateur disposant d’une session connectée. L’agent a vérifié ces valeurs par le connecteur avant de déclencher un unique déploiement. Aucun DNS, domaine, secret Supabase, donnée scolaire ou forfait n’a été modifié.

- PR source : [192](https://github.com/steedo1/CAHIER-D-ABSENCES/pull/192), fusionnée après confirmation d’Auto-Deploy sur Off.
- Commit candidat et fusionné : `8c8c0bcc6e22ba88587b324b3e2c8676543fcadd`.
- Service de production : `mon-cahier-test` / `srv-dbc291on74is73f4692g`.
- Branche : `migration-render-test-20261021`.
- Nouveau déploiement : `dep-dbc6dj8473hc73f99db0`, déclenché à **07:16:29 UTC / Abidjan**.
- Référence précédente : `b2cad91258062d993151af890605d6de9bf51bdc`, déploiement `dep-dbc3uirbc2fs73b7675g`.
- Build enregistré : `npm ci && NODE_OPTIONS=--max-old-space-size=4096 npm run build`.
- Démarrage enregistré : `node --max-old-space-size=288 node_modules/next/dist/bin/next start --hostname 0.0.0.0`.
- Auto-déploiement laissé sur **Off** pour conserver un déclenchement contrôlé.
- Contrôle de santé Render conservé : TCP par défaut. Aucun nouveau endpoint public ni sonde mémoire en production.

Le plafond de 288 Mio concerne l’old space V8. Ce n’est ni une réservation mémoire ni une limite RSS. Les caches et requêtes Supabase existants sont conservés.

## Incidents observés avant la nouvelle version

Les événements Render exposent **trois arrêts pour dépassement de mémoire sur l’ancienne instance** : `07:07:58`, `07:11:44` et `07:15:41`, motif `oomKilled`, limite `512Mi`. Ils précèdent le déclenchement du nouveau déploiement à 07:16:29. Les logs de démarrage et les chutes de mémoire sont cohérents avec des redémarrages de cette ancienne version ; il ne s’agit pas d’une interruption causée par la nouvelle bascule.

Entre 07:00 et 07:16, la pointe mémoire du conteneur atteint **509,8 Mio**. Le CPU atteint **0,1499 cœur**, pour une limite API précédemment observée de 0,15 cœur. La moyenne mémoire de cette fenêtre n’est pas une référence stable : elle inclut les chutes de consommation dues aux arrêts. Les métriques de latence et de nombre de requêtes HTTP restent vides dans le connecteur ; une comparaison de production à charge identique n’est donc pas possible avec ces seules séries.

Les preuves brutes sans données scolaires ni secrets figurent dans `deploiement-mesures.json`. Les validations et benchmarks locaux restent décrits dans [rapport.md](rapport.md).

## État et mesures après déploiement

Le nouveau déploiement est **live depuis 07:20:21 UTC / Abidjan**. Les logs confirment Node 22.23.3, Next 15.5.27 et la commande de démarrage directe à 288 Mio. La compilation et les vérifications TypeScript de Render ont réussi. La nouvelle instance `srv-dbc291on74is73f4692g-5qpld` annonce `Ready in 4.3s`.

Première mesure à 07:21 : **321,0 Mio** pour le conteneur de la nouvelle instance. La mesure à 07:20 encore associée à `...-frthg` concerne l’ancienne instance et doit être exclue du bilan après bascule. À 07:22–07:24, les mesures sont autour de **413–416 Mio**, puis **351,3 Mio à 07:25**, sans événement d’arrêt ni nouveau démarrage dans les logs/événements consultés. Cette évolution est compatible avec une libération de mémoire, sans prouver son mécanisme. L’observation reste courte et ne constitue pas une comparaison à trafic identique.

Contrôles HTTP séquentiels sans connexion et sans test de charge :

| Ressource | Résultat |
| --- | --- |
| `/login` | 200, HTML Mon Cahier et assets Next présents |
| `/manifest.webmanifest` | 200, JSON valide |
| `/moncahier-sw.js` | 200 |
| `/offline.html` | 200 |
| `/class` et `/admin` sans session | 307 vers `/login` |
| `/api/class/roster` sans session | 401 |

Les sept requêtes ont pris **5,9 à 13,9 secondes** depuis l’environnement d’audit, réseau et proxy compris. Il ne s’agit pas de temps CPU ni de mesures internes Render. Le premier `/login` est mesuré pendant le démarrage à froid des routes. Les métriques HTTP Render sont vides ; une absence de régression de performance n’est donc pas démontrée. Les tests connectés classe/enseignant/administration, l’enregistrement et la synchronisation d’un véritable appel, la clôture et la reprise hors ligne n’ont pas été simulés sur les données de production. Ils restent à confirmer avec les comptes habituels de l’utilisateur.

Un second contrôle `/login` après plusieurs minutes répond **200 en 6,18 s** depuis le même environnement. Une seule mesure antérieure valait environ 5,9 s ; ces quelques observations ne permettent pas de conclure à une variation de performance serveur.

Le CPU de la nouvelle instance atteint **0,146 cœur** à 07:22, redescend à **0,070 cœur** à 07:25, puis atteint **0,150 cœur** à 07:28. Ce dernier point atteint la limite exposée par l’API du service. Le CPU reste un point de vigilance sur le gratuit ; aucun gain CPU en production n’est revendiqué.

### Bilan étendu à 07:39

Les mesures de la nouvelle instance entre **07:21 et 07:39** atteignent désormais **468,1 Mio**, avec une dernière valeur de **435,6 Mio** à 07:39. La marge au pic n’est donc plus que d’environ **43,9 Mio**. Aucun événement `server_failed` ou `server_restarted` n’a été renvoyé entre la bascule et la dernière vérification. **Le gratuit ne peut pas être déclaré durablement stabilisé sous 400 Mio, ni suffisamment dimensionné pour tous les établissements, sur ce résultat.**

Un signalement opérationnel sur les matières/une préparation PWA incomplète a été reçu pendant cette observation. L’investigation en lecture seule a trouvé un délai de 2,5 s du worker pour les matières, inférieur au budget de huit secondes de la page. Ce comportement préexistait au déploiement RAM et a été reproduit sur le code de référence avec une réponse simulée à 3,5 s. Un correctif PWA séparé est testé en branche isolée ; il n’a pas été inclus dans le déploiement RAM. Aucun emploi du temps ni donnée scolaire n’a été modifié pendant cette investigation.

## Capacité et recommandation

L’optimisation est maintenant réellement déployée et les premières mesures du conteneur sont inférieures aux pointes de l’ancienne version. **Une tenue permanente sous 400 Mio n’est pas démontrée**, puisque la nouvelle version a atteint **468,1 Mio** dans la fenêtre étendue. La capacité durable de plusieurs établissements et les traitements lourds (PDF, imports/exports, très grandes listes) ne sont pas certifiés par cette observation courte. Des mesures sur plusieurs journées et les appels habituels restent nécessaires.

Le service reste gratuit : aucune souscription ni montée de gamme n’a été effectuée. Le gratuit conserve la mise en veille après quinze minutes sans trafic et le redémarrage d’environ une minute. Il ne constitue donc pas une garantie de disponibilité pour les appels scolaires, même si la RAM est contenue.

La première option Render moins chère que le Standard reste **Starter / `0.5c-512mb` à 7 $/mois**, 512 Mo et davantage de CPU, sans veille du gratuit. Elle ne fournit pas de RAM supplémentaire et doit rester conditionnée à la marge observée. Si les traitements réels dépassent cette marge, la première offre Render avec plus de mémoire est **`1c-2g` à 25 $/mois**, 2 Go. Il n’est pas nécessaire de souscrire à 25 $ sur la seule base des premières minutes après correction ; il n’est pas non plus justifié de garantir la fiabilité du gratuit pour plusieurs établissements.

Sources officielles revérifiées : [tarifs Render](https://render.com/pricing), [plans CPU/RAM](https://render.com/docs/compute-plans), [limites du gratuit](https://render.com/docs/free).

## Retour arrière

Le déploiement précédent reste identifié ci-dessus. La documentation Render actuelle indique qu’un **Rollback** depuis Deploys réutilise l’artefact et la commande de démarrage du déploiement ciblé, sans écraser les réglages actuels du service. Cela permet un retour à l’ancien démarrage pour ce rollback. Pour un futur déploiement standard de l’ancienne version, il faut aussi remettre `npm run start` dans les réglages courants. Aucun rollback n’a été déclenché.

Source vérifiée : https://render.com/docs/rollbacks (consultée le 21 octobre 2026).
