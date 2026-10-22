# Incident mémoire Render — 22 octobre 2026

Service : `mon-cahier-test` (`srv-dbc291on74is73f4692g`), instance Render Free (512 Mio), région Francfort. Audit en lecture seule des événements, métriques et logs Render le 22 octobre 2026.

## Preuves observées
- Arrêts Render `server_failed` avec `oomKilled.memoryLimit = 512Mi` : **09:00:40 UTC**, **09:25:30 UTC**, **10:57:02 UTC** (22/10/2026). Également constatés le 21/10.
- Redémarrage opérationnel `server_available` observé à 13:31:21 UTC.
- `memory_usage` (résolution 5 min) : point maximal observé **497 979 400 octets** (~475 Mio) à 08:10 UTC, soit ~93 % du plafond ; il peut y avoir des pics intermédiaires non visibles entre deux points.
- Logs : nombreux `[bulletin] génération du QR impossible` avec `url_length` généralement ~3020–3130 caractères ; erreurs groupées en rafales dans les logs existants.
- Logs : `[class-roster] slow_request` avec un temps total jusqu'à >5 secondes ; `data_ms` prédomine sur certaines requêtes.

**Attention : les corrélations temporelles ne démontrent pas que les QR sont l'unique cause des OOM.** La répétition des erreurs et leur concurrence élevée justifient néanmoins un premier correctif ciblé.

## Constat confirmé dans le code (commit déployé `5c2850ce`)
La fonction `attachQrPng` dans `src/app/api/admin/grades/bulletin/route.ts` utilisait `Promise.all(items.map(...))` pour créer simultanément **toutes** les images QR (par défaut 600px). Les URL trop longues déclenchaient un `console.warn` par élève, potentiellement des dizaines de logs par chargement de bulletin.

## Correctif sur branche isolée
Branche : `fix/render-memory-bulletin-20261022`.
- Encoder au maximum **deux QR en parallèle** ; conserver l'ordre et tous les champs de réponse.
- Conserver le comportement historique en cas d'URL trop longue : `qr_png: null`, `qr_url` et `qr_token` inchangés ; la préparation explicite des liens courts à l'aperçu reste gérée séparément.
- Réduire les avertissements à **une ligne agrégée par requête**, sans jetons ni données scolaires.
- Aucune modification SQL, RLS, URL publique, Supabase ni logique de calcul.
- Trois tests de régression ajoutés (`test/render-bulletin-qr-memory.test.mjs`) : 120 élèves et pic de deux encodages, ordre, erreurs, données inchangées, journalisation groupée et lots vides.

## Validation et limites
- Vérification TypeScript et **29 tests QR** réussis dans GitHub Actions (première exécution).
- La compilation Webpack a réussi mais le prérendu Next.js /profile a échoué sur la CI initiale : **`Config Supabase serveur manquante`**. Le workflow de la branche a été ajusté avec des valeurs CI fictives, sans accès aux vrais secrets, pour une nouvelle vérification.
- **Aucune preuve de baisse mémoire réelle sur Render tant que le correctif n'a pas été testé sur une instance isolée sous charge.**
- Le compte Render actuellement accessible ne liste qu'un seul web service nommé `mon-cahier-test` ; **l'association éventuelle avec le domaine public `mon-cahier.com` n'est pas vérifiée**. Ne pas déployer sur ce service sans contrôler les domaines personnalisés et l'isolation de la production.

## Étapes restant à exécuter
1. Confirmer les domaines personnalisés et la base de données du service ; choisir un environnement de validation sans trafic d'établissements.
2. Exécuter un test avant/après à scénario identique (classe de 30–120 élèves, bulletins NC, QR courts et trop longs, impression, scan).
3. Mesurer RSS/heap (mémoire totale du processus et V8), CPU, requêtes, latences, redémarrages ; répéter sur plusieurs cycles.
4. Auditer `class-roster` (temps DB, taille `settings_json`, requêtes concurrentes, chargements clients) avant toute modification fonctionnelle.
5. Vérifier les endpoints de comptes classe/enseignant, absence et notes, PWA, bulletins franco-arabes, PDF et impression après une éventuelle promotion.
6. Une optimisation QR n'est **pas** une preuve de correction de toutes les fuites et dépassements mémoire : poursuivre le diagnostic si les pics persistent.

**Politique : ne pas fusionner ni déployer en production avant validation mesurée.**
