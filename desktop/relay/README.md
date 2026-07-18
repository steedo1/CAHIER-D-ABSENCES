# Mon Cahier Desktop — Relais local (lot 6.1)

Ce dossier contient la première base exécutable du relais local. Il conserve les
données pédagogiques dans SQLite, expose un état de santé local et fournit le
socle idempotent de synchronisation que l'interface Desktop/Tauri utilisera.

Le relais ne contient volontairement aucune table de finance, paiement, caisse,
SMS ou paie. Ces domaines restent servis par l'application centrale en ligne.

## Garanties de cette base

- une base par installation, partitionnée par `institution_id` ;
- clés étrangères, mode WAL et attente en cas d'accès concurrent ;
- identifiant d'opération unique pour empêcher les doubles appels, doubles notes
  et doubles séances de cahier de texte après un rejeu réseau ;
- journal entrant idempotent, curseurs, conflits bloqués et audit local ;
- contrôle local des appels à partir de l'emploi du temps, des séances et des
  demandes d'absence ;
- écoute sur `127.0.0.1` par défaut. Une écoute sur le réseau local exige un
  jeton explicite et sera complétée par l'appairage des appareils au lot 6.5.

## Développement

Node.js 20 à 26 est requis pour ce service autonome.

```powershell
cd desktop\relay
npm install
npm run verify
npm run build
npm run dev -- init --institution-id VOTRE_UUID --institution-name "Mon établissement"
npm run dev -- status
npm run dev -- serve
```

Variables disponibles :

- `MONCAHIER_RELAY_DATA_DIR` : dossier contenant la base ;
- `MONCAHIER_RELAY_DB` : chemin complet de la base (prioritaire) ;
- `MONCAHIER_RELAY_HOST` : `127.0.0.1` par défaut ;
- `MONCAHIER_RELAY_PORT` : `4317` par défaut ;
- `MONCAHIER_RELAY_TOKEN` : obligatoire si l'hôte n'est pas local.

Le relais n'est pas encore le programme Windows final : l'enveloppe Tauri, le
tableau de bord graphique et l'appairage Wi-Fi/LAN arrivent dans les lots
suivants, sans changer le schéma ni le contrat de synchronisation définis ici.

## Contrat de synchronisation

`protocol/sync-v1.schema.json` est le contrat commun au cloud et au relais. Une
mutation `upsert` transporte l'état complet de l'entité, pas un patch partiel.
Le cloud conserve `operation_id` et le renvoie dans
`caused_by_operation_id` : le relais peut ainsi reconnaître un accusé de
réception même si la réponse HTTP initiale a été perdue. Toute modification
concurrente différente devient un conflit visible ; elle n'est jamais écrasée
silencieusement.
