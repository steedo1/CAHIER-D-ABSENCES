# Mon Cahier Desktop — Relais local (lots 6.1 et 6.2)

Ce dossier contient le service autonome du relais local Mon Cahier. Il conserve
les données pédagogiques dans SQLite, reçoit la copie initiale du Cloud,
matérialise les événements de synchronisation dans les tables locales et expose
les données nécessaires au dashboard Admin hors ligne.

Le relais ne contient volontairement aucune table de finance, paiement, caisse,
SMS, budget ou paie. Ces domaines restent servis par l'application centrale en
ligne.

## Garanties

- un établissement indépendant par défaut, ou plusieurs établissements
  explicitement autorisés lorsqu'un groupe scolaire partage le même relais ;
- isolation de toutes les données, files d'attente, curseurs et conflits par
  `institution_id`, y compris dans une base de groupe scolaire ;
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

## Installation Windows sans commande à saisir

Le dossier `windows` fournit désormais un assistant destiné au poste relais de
l'établissement. L'administrateur double-clique sur
`windows/Installer-Mon-Cahier.cmd`, renseigne le code unique et le nom de
l'établissement, puis accepte l'autorisation Windows.

L'assistant effectue automatiquement les opérations suivantes :

- vérification de Node.js et construction du relais ;
- création d'une configuration protégée dans
  `%LOCALAPPDATA%\MonCahier\Relay\config.json` ;
- génération du jeton Admin de l'école et création de sa base SQLite ;
- suppression des anciennes variables utilisateur susceptibles de forcer la
  base d'un autre établissement ;
- autorisation du port 4317 uniquement sur les réseaux Windows privés ;
- proposition explicite avant de classer le réseau courant comme privé ;
- installation du démarrage silencieux à l'ouverture de session ;
- démarrage immédiat, contrôle `/health`, copie du jeton dans le presse-papiers
  et ouverture de la page de paramétrage Mon Cahier.

Le jeton existant est conservé lors d'une réinstallation pour le même code
établissement. Il est renouvelé automatiquement si le poste est basculé vers
un autre établissement, dont la base locale est également séparée.
Si le PC possède déjà un relais, l'assistant demande explicitement si le nouvel
établissement appartient au même groupe scolaire. Une réponse positive ajoute
le code à la liste autorisée, conserve la base partagée et active le mode
`school_group`. Chaque école reçoit alors son propre jeton Admin : le jeton
d'une école ne permet pas de consulter les données locales d'une autre école.
Une réponse négative conserve le comportement isolé : la
configuration active bascule vers une nouvelle base et un nouveau jeton, sans
supprimer l'ancienne base.
Le relais compare en plus le code unique reçu lors du bootstrap Cloud avec le
ou les codes configurés localement et refuse toute synchronisation provenant
d'un établissement non autorisé avant la première écriture SQLite.

Dans un groupe scolaire, partager le PC ne signifie jamais partager les données
entre écoles. Chaque requête locale reste limitée à son `institution_id` et le
diagnostic expose séparément l'état de synchronisation de chaque établissement.
Le groupe peut aussi choisir un PC relais distinct par école ; chaque
installation possède alors sa propre configuration, sa propre base et son
propre réseau local.

Deux raccourcis de dépannage ne nécessitent aucune commande manuelle :

- `windows/Diagnostic-Mon-Cahier.cmd` vérifie la configuration, la base et si
  le service répond ;
- `windows/Copier-Jeton-Admin.cmd` remet le jeton Admin dans le presse-papiers ;
  en mode groupe, il demande le code de l'école concernée.

Le jeton Admin reste réservé au navigateur d'administration. Il n'est jamais
communiqué aux enseignants et n'intervient pas dans leur preuve de présence.

## API locale du lot 6.2

Les routes Admin et bootstrap utilisent le jeton propre à l'école concernée.
Les routes techniques de synchronisation utilisent un jeton maître interne qui
n'est pas affiché dans l'assistant et ne doit pas être copié dans le navigateur.

- `POST /v1/sync/bootstrap` : copie initiale complète Cloud → SQLite ;
- `POST /v1/sync/apply` : application d'un événement Cloud incrémental ;
- `POST /v1/sync/enqueue` : enregistrement d'une opération locale ;
- `GET /v1/admin/dashboard?institution_id=...&date=YYYY-MM-DD` : compteurs,
  état de synchronisation et surveillance des appels du jour ;
- `GET /v1/admin/attendance/monitor?institution_id=...&from=...&to=...` :
  réponse compatible avec la vue actuelle de contrôle des appels ;
- `GET /v1/status` : santé globale du relais.
- `POST /v1/attendance/presence-proof` : preuve signée et brève qu'un compte
  enseignant a joint le relais depuis le réseau local de son établissement.
  Cette route utilise un accès enseignant signé par le Cloud et ne communique
  jamais le jeton administrateur du relais au téléphone.

Pour les téléphones, l'administration renseigne dans Mon Cahier l'adresse LAN
du PC relais (par exemple `http://192.168.1.20:4317`). Le navigateur obtient
automatiquement un accès limité à l'enseignant connecté. Le PC relais doit être
lancé avec `MONCAHIER_RELAY_HOST=0.0.0.0` et une configuration protégée. Le
jeton Admin propre à chaque école ne doit jamais être partagé avec les
enseignants.

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

## Raccordement navigateur au relais

Le navigateur Admin contacte directement le relais local lorsqu'une lecture Cloud
échoue. L'ordre de lecture est : Cloud, relais SQLite, puis dernière réponse mise
en cache dans la PWA. Quand le Cloud répond, le navigateur transmet aussi un
bootstrap pédagogique au relais afin de garder SQLite à jour.

Routes supplémentaires :

- `GET /v1/founder/attendance-slots?institution_id=...` : vue par créneau de
  l'établissement local, compatible avec l'écran Founder ;
- `OPTIONS /*` : prévol CORS pour l'accès depuis l'application web ou Tauri.

Origines autorisées par défaut :

- `https://mon-cahier.com` ;
- `https://www.mon-cahier.com` ;
- `http://localhost:3000` ;
- `http://127.0.0.1:3000` ;
- `http://tauri.localhost` ;
- `tauri://localhost`.

Pour une autre adresse de déploiement, définir une liste séparée par des virgules :

```powershell
$env:MONCAHIER_RELAY_ALLOWED_ORIGINS = "https://votre-domaine.ci,http://localhost:3000"
```

Dans le navigateur, l'URL et le jeton du relais sont enregistrés localement sous
les clés `moncahier:relay:url` et `moncahier:relay:token`. Le jeton n'est jamais
envoyé au Cloud : il sert uniquement aux requêtes directes vers le PC relais.
