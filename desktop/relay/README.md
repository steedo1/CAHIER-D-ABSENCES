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

## Synchronisation autonome Relais → Cloud — Lot 1A

Le service `serve` démarre désormais un agent de synchronisation sortante. Il
lit uniquement les opérations prêtes dans `sync_outbox`, respecte les
`sync_outbox_dependencies`, puis les transmet au Cloud dans l'ordre métier :

1. ouverture de la séance ;
2. appel des élèves ;
3. clôture de la séance.

Une opération est supprimée de SQLite uniquement après un accusé Cloud
individuel `acknowledged`. Une panne réseau, un délai dépassé, une erreur 5xx ou
un jeton à corriger laisse l'opération en attente avec un backoff exponentiel.
Une incohérence métier devient `blocked` ou `conflict` et reste visible dans le
diagnostic ; elle n'est jamais écrasée silencieusement. Les opérations qui en
dépendent sont elles aussi bloquées explicitement avec le statut HTTP 424 au
lieu de rester indéfiniment en attente.

Le Cloud vérifie l'empreinte SHA-256 canonique de chaque opération, réserve le
traitement pour empêcher deux requêtes concurrentes d'appliquer la même action,
puis conserve un reçu idempotent par couple `(institution_id, operation_id)`.
Si une séance équivalente existe déjà dans le Cloud sous un autre UUID, le
relais enregistre cet UUID dans
`teacher_session_open_operations.remote_session_id` et l'utilise
automatiquement pour l'appel et la clôture suivants.

### Préparation Cloud

Appliquer d'abord la migration :

```text
migrations/20260728_relay_cloud_push_v1.sql
```

La page **Admin → Paramètres → Périmètre des appels enseignants** permet de
créer, suivre et révoquer les identités Cloud des PC relais. Le secret est
affiché une seule fois avec une commande PowerShell prête à copier.

L'API sous-jacente `POST /api/admin/offline/relay-devices?institution_id=...`
crée une identité révocable pour le PC relais. Sa réponse contient :

- `item.id` : identifiant du PC relais ;
- `item.push_url` : route Cloud d'envoi ;
- `item.token` : secret affiché une seule fois.

Le jeton brut n'est jamais conservé dans Supabase. Seul son SHA-256 est stocké.
`DELETE /api/admin/offline/relay-devices` permet de révoquer un poste perdu ou
remplacé.

### Configuration protégée du PC relais

Sur le PC Windows, après avoir reçu les trois valeurs précédentes :

```powershell
cd C:\Projects\CAHIER-D-ABSENCES\desktop\relay
node dist\src\cli.mjs sync-configure `
  --institution-code "LMA-000101" `
  --endpoint "https://www.mon-cahier.com/api/relay/sync/push" `
  --device-id "UUID_DU_RELAIS" `
  --token "JETON_AFFICHÉ_UNE_SEULE_FOIS"
```

La commande vérifie HTTPS, le format UUID et la correspondance entre le jeton
et l'appareil, puis écrit atomiquement la configuration dans
`%LOCALAPPDATA%\MonCahier\Relay\config.json`. Le jeton n'est jamais affiché par
`doctor`.

Commandes de contrôle :

```powershell
node dist\src\cli.mjs doctor
node dist\src\cli.mjs sync-once
node dist\src\cli.mjs serve
```

`doctor` et `/v1/status` exposent les compteurs en attente/bloqués, la dernière
synchronisation réussie ainsi que la dernière erreur d'envoi, sans révéler le
secret Cloud.

Réglages facultatifs :

- `MONCAHIER_RELAY_CLOUD_SYNC_INTERVAL_SECONDS` : 15 secondes par défaut,
  borné entre 5 secondes et 1 heure ;
- `MONCAHIER_RELAY_CLOUD_SYNC_BATCH_SIZE` : 25 opérations par défaut, maximum
  100 ;
- `MONCAHIER_RELAY_CLOUD_SYNC_TIMEOUT_SECONDS` : 20 secondes par défaut, borné
  entre 5 et 120 secondes.

Lorsque des changements d'appel sont réellement intégrés, la route Cloud
déclenche aussi les workers de notifications push et SMS comme la route
d'appel en ligne. Un accusé rejoué ne redéclenche pas ces workers. L'activation Cloud
de la présence reste respectée : si la politique de l'établissement interdit
le relais local, l'envoi est refusé et les données demeurent dans SQLite.

Ce lot ferme le trajet **Relais → Cloud**. La récupération autonome et
incrémentale **Cloud → Relais** reste volontairement séparée dans le Lot 1B.


### Rejeu contrôlé après remplacement d'un UUID d'emploi du temps

Lorsqu'une opération historique a été bloquée avec `timetable_not_found`, le
Cloud recherche désormais un remplacement uniquement par l'identité métier
complète : établissement, classe, matière, enseignant, créneau et jour ISO.

Le remplacement n'est accepté que s'il existe exactement un créneau Cloud
compatible. Zéro candidat conserve le blocage ; plusieurs candidats créent un
conflit visible.

Après déploiement du correctif Cloud, la chaîne locale peut être réarmée avec :

```powershell
node dist\src\cli.mjs sync-requeue-timetable-replacement `
  --institution-code "LMA-000101" `
  --root-operation-id "UUID_OPERATION_OUVERTURE" `
  --expected-error "timetable_not_found"

node dist\src\cli.mjs sync-once
```

La commande refuse toute opération qui ne correspond pas exactement à une
ouverture bloquée en `422 timetable_not_found`. Elle exige que l'ancien créneau
soit retiré, qu'un unique remplaçant actif existe, réarme uniquement la chaîne
de dépendances concernée et inscrit l'action dans `audit_log`.
