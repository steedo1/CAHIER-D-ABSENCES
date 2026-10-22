# Mon Cahier Finance Desktop — première base technique

Prototype isolé sur la branche feature/finance-desktop-offline-20261022, basé sur la branche de migration Render du 21 octobre 2026.

## Décisions validées
- Logiciel Windows avec Tauri v2, React, TypeScript, Vite et SQLite locale.
- Travail quotidien entièrement hors Internet, une caisse pilote par établissement.
- Données conservées localement; échange avec Mon Cahier en ligne uniquement sur déclenchement humain.
- Production Render / Supabase inchangée et relais local non réactivé.
- Réemploi du module financier actuel et de ses règles, notamment via l'import réel du module src/lib/finance/charge-rules.ts.

## Implémenté dans ce premier jalon
- Structure de projet Tauri indépendante de Next.js.
- Base SQLite persistante dans le dossier de données de l'application; contraintes, WAL, écriture durable.
- Configuration initiale d'un établissement pilote, élèves, créances simples et paiements espèces.
- Enregistrement local transactionnel, contrôle de dépassement de créance et clé de requête idempotente.
- Numéro de reçu marqué PROVISOIRE, journal outbox destiné à la future synchronisation.
- Vue React minimale permettant de tester ces opérations et leur persistance après redémarrage.

## IMPORTANT : non autorisé pour encaissements réels
Ce jalon est un PROTOTYPE de développement. Il ne synchronise pas les données, n'importe pas les tarifs officiels ni les dossiers historiques; les reçus sont exclusivement provisoires.
Ne pas y saisir de véritables données élèves ni y encaisser de l'argent réel. Il manque avant toute mise en service :
1. Authentification et protections locales (dont chiffrement et contrôle d'accès).
2. Sauvegardes restaurables testées, journal d'audit et stratégie de reprise de panne.
3. Import officiel des élèves, classes, années, frais, encaissements historiques, avec contrôle d'établissement.
4. Portage de toutes les règles de frais, composants facultatifs, remises, allocations et autres fonctionnalités du module en ligne.
5. Synchronisation volontaire bidirectionnelle avec identification stable, signature/autorisation et intégration serveur idempotente, conflits explicites et reconciliation.
6. Numérotation et validation définitives des reçus uniquement par un processus sûr.
7. Tests multi-scénarios et revue de sécurité, puis tests Windows et installation signée.

Les boutons importer / envoyer sont volontairement désactivés à ce stade : aucune fausse synchronisation.

## Démarrer en développement
Prérequis : Windows, Rust stable, Node.js, npm, WebView2 et prérequis officiels Tauri v2.

Depuis le dossier desktop-finance :
1. npm install
2. npm run tauri dev

Pour compiler la partie web seule : npm run build.
La création d'un installateur Windows n'est pas encore configurée (bundle.active=false).

## Architecture / séparation
Les appels Supabase et les Server Actions Next.js ne doivent pas être exécutés en mode desktop. Les écritures locales passent par des commandes Rust et des transactions SQLite. Les règles pures du projet web peuvent être utilisées en commun, tandis que les adaptateurs de stockage diffèrent.

Aucun changement effectué au site Render ni à la branche de production.
