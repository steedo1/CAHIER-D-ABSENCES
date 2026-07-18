# Mon Cahier Desktop — Relais local (lots 6.1 et 6.2)

Ce dossier contient le service autonome du relais local Mon Cahier. Il conserve
les données pédagogiques dans SQLite, reçoit la copie initiale du Cloud,
matérialise les événements de synchronisation dans les tables locales et expose
les données nécessaires au dashboard Admin hors ligne.

Le relais ne contient volontairement aucune table de finance, paiement, caisse,
SMS, budget ou paie. Ces domaines restent servis par l'application centrale en
ligne.

## Garanties

- une base par installation, partitionnée par `institution_id` ;
- clés étrangères, mode WAL et attente en cas d'accès concurrent ;
- identifiant d'opération unique contre les doubles appels, doubles notes et
  doubles séances après un rejeu réseau ;
- journal entrant idempotent, curseurs, conflits bloqués et audit local ;
- bootstrap Cloud → SQLite transactionnel et idempotent par `snapshot_id` ;
- protection des modifications locales encore en attente lors d'un nouveau
  bootstrap ;
- matérialisation des données dans les vraies tables pédagogiques utilisées par
  le dashboard et la vue par créneau ;
- mise en attente et nouvelle tentative automatique si un événement arrive avant
  une dépendance nécessaire ;
- contrôle local des appels à partir de l'emploi du temps, des séances et des
  demandes d'absence ;
- dashboard Admin local sans aucune donnée financière ;
- écoute sur `127.0.0.1` par défaut. Une écoute sur le réseau local exige un
  jeton explicite et sera complétée par l'appairage des appareils au lot 6.5.

## Développement

Node.js 20 à 26 est requis pour ce service autonome.

```powershell
cd desktop\relay
npm ci
npm run verify
npm run build
npm run dev -- init --institution-id VOTRE_UUID --institution-name "Mon établissement"
npm run dev -- status
npm run dev -- serve
```

Variables disponibles :

- `MONCAHIER_RELAY_DATA_DIR` : dossier contenant la base ;
- `MONCAHIER_RELAY_DB` : chemin complet de la base, prioritaire ;
- `MONCAHIER_RELAY_HOST` : `127.0.0.1` par défaut ;
- `MONCAHIER_RELAY_PORT` : `4317` par défaut ;
- `MONCAHIER_RELAY_TOKEN` : obligatoire si l'hôte n'est pas local.

Le relais n'est pas encore l'application Windows finale. L'enveloppe Tauri et
l'appairage Wi-Fi/LAN arriveront dans les lots suivants sans modifier le contrat
posé ici.

## API locale du lot 6.2

Toutes les routes `/v1/*` utilisent le jeton du relais lorsqu'il est configuré.

- `POST /v1/sync/bootstrap` : copie initiale complète Cloud → SQLite ;
- `POST /v1/sync/apply` : application d'un événement Cloud incrémental ;
- `POST /v1/sync/enqueue` : enregistrement d'une opération locale ;
- `GET /v1/admin/dashboard?institution_id=...&date=YYYY-MM-DD` : compteurs,
  état de synchronisation et surveillance des appels du jour ;
- `GET /v1/admin/attendance/monitor?institution_id=...&from=...&to=...` :
  réponse compatible avec la vue actuelle de contrôle des appels ;
- `GET /v1/status` : santé globale du relais.

Le bootstrap accepte un objet de cette forme :

```json
{
  "protocol_version": 1,
  "snapshot_id": "uuid-du-snapshot",
  "institution_id": "uuid-etablissement",
  "generated_at": "2026-07-18T00:00:00.000Z",
  "cursor": "curseur-cloud-optionnel",
  "institution": {
    "id": "uuid-etablissement",
    "name": "Nom de l'établissement",
    "server_version": 1,
    "updated_at": "2026-07-18T00:00:00.000Z"
  },
  "entities": {
    "academic_years": [],
    "profiles": [],
    "user_roles": [],
    "classes": [],
    "subjects": [],
    "teacher_subjects": [],
    "students": [],
    "class_enrollments": [],
    "institution_periods": [],
    "teacher_timetables": [],
    "teacher_absence_requests": [],
    "teacher_sessions": [],
    "attendance_marks": [],
    "grade_periods": [],
    "grade_evaluations": [],
    "student_grades": [],
    "textbook_assignments": [],
    "textbook_items": [],
    "textbook_sessions": [],
    "textbook_completions": [],
    "offline_documents": []
  }
}
```

Toute collection financière est refusée explicitement.

## Contrat de synchronisation

`protocol/sync-v1.schema.json` et `protocol/bootstrap-v1.schema.json` sont les contrats communs au Cloud et au relais. Une
mutation `upsert` transporte l'état complet de l'entité, pas un patch partiel.
Le Cloud conserve `operation_id` et le renvoie dans
`caused_by_operation_id` : le relais reconnaît ainsi un accusé de réception même
si la réponse HTTP initiale a été perdue. Toute modification concurrente
différente devient un conflit visible et n'est jamais écrasée silencieusement.
