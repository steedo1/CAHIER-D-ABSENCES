use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use serde_json::json;
use std::sync::Mutex;
use tauri::{Manager, State};
use uuid::Uuid;

struct LocalStore {
    connection: Mutex<Connection>,
}

#[derive(Serialize)]
struct School {
    school_id: String,
    school_name: String,
    academic_year: String,
}

#[derive(Serialize)]
struct Student {
    id: String,
    matricule: String,
    full_name: String,
    class_name: String,
}

#[derive(Serialize)]
struct Charge {
    id: String,
    student_id: String,
    label: String,
    amount_fcfa: i64,
    paid_fcfa: i64,
}

#[derive(Serialize)]
struct Payment {
    id: String,
    charge_id: String,
    amount_fcfa: i64,
    receipt_no: String,
    created_at: String,
    sync_status: String,
}

#[derive(Serialize)]
struct Overview {
    school: Option<School>,
    students: Vec<Student>,
    charges: Vec<Charge>,
    payments: Vec<Payment>,
    pending_events: i64,
}

fn db_error(error: rusqlite::Error) -> String {
    format!("Erreur SQLite locale : {error}")
}

fn init_db(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        r#"
        PRAGMA foreign_keys=ON;
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        PRAGMA busy_timeout=5000;

        CREATE TABLE IF NOT EXISTS school_config (
            id TEXT PRIMARY KEY CHECK (id = 'current'),
            school_id TEXT NOT NULL UNIQUE,
            school_name TEXT NOT NULL,
            academic_year TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS students (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            matricule TEXT NOT NULL COLLATE NOCASE,
            full_name TEXT NOT NULL,
            class_name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            UNIQUE (school_id, matricule)
        );
        CREATE TABLE IF NOT EXISTS charges (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            student_id TEXT NOT NULL REFERENCES students(id),
            label TEXT NOT NULL,
            amount_fcfa INTEGER NOT NULL CHECK (amount_fcfa > 0),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );
        CREATE TABLE IF NOT EXISTS payments (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            charge_id TEXT NOT NULL REFERENCES charges(id),
            amount_fcfa INTEGER NOT NULL CHECK (amount_fcfa > 0),
            request_id TEXT NOT NULL UNIQUE,
            receipt_no TEXT NOT NULL UNIQUE,
            sync_status TEXT NOT NULL DEFAULT 'pending' CHECK (sync_status IN ('pending','synced','conflict')),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );
        CREATE TABLE IF NOT EXISTS outbox (
            id TEXT PRIMARY KEY,
            school_id TEXT NOT NULL,
            event_kind TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','synced','conflict')),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            synced_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
        CREATE INDEX IF NOT EXISTS idx_charges_student ON charges(student_id);
        CREATE INDEX IF NOT EXISTS idx_payments_charge ON payments(charge_id);
        CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);
        "#,
    )
}

fn required_school(connection: &Connection) -> Result<School, String> {
    connection
        .query_row(
            "SELECT school_id, school_name, academic_year FROM school_config WHERE id='current'",
            [],
            |row| {
                Ok(School {
                    school_id: row.get(0)?,
                    school_name: row.get(1)?,
                    academic_year: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(db_error)?
        .ok_or_else(|| "Configurer d'abord l'établissement pilote.".to_string())
}

fn enqueue(
    tx: &Transaction<'_>,
    school_id: &str,
    event_kind: &str,
    entity_id: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    tx.execute(
        "INSERT INTO outbox (id,school_id,event_kind,entity_id,payload_json) VALUES (?1,?2,?3,?4,?5)",
        params![
            Uuid::new_v4().to_string(),
            school_id,
            event_kind,
            entity_id,
            payload.to_string()
        ],
    )
    .map_err(db_error)?;
    Ok(())
}

fn checked(value: &str, title: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{title} obligatoire."));
    }
    if trimmed.chars().count() > 160 {
        return Err(format!("{title} trop long."));
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
fn configure_school(
    state: State<'_, LocalStore>,
    school_id: String,
    school_name: String,
    academic_year: String,
) -> Result<(), String> {
    let school_id = checked(&school_id, "Identifiant de l'établissement")?;
    let school_name = checked(&school_name, "Nom de l'établissement")?;
    let academic_year = checked(&academic_year, "Année scolaire")?;
    let connection = state.connection.lock().map_err(|_| "Base locale verrouillée")?;
    if connection
        .query_row("SELECT COUNT(*) FROM school_config", [], |row| row.get::<_, i64>(0))
        .map_err(db_error)?
        != 0
    {
        return Err("L'établissement de cette base locale est déjà fixé.".into());
    }
    connection
        .execute(
            "INSERT INTO school_config (id,school_id,school_name,academic_year) VALUES ('current',?1,?2,?3)",
            params![school_id, school_name, academic_year],
        )
        .map_err(db_error)?;
    Ok(())
}

#[tauri::command]
fn add_student(
    state: State<'_, LocalStore>,
    matricule: String,
    full_name: String,
    class_name: String,
) -> Result<(), String> {
    let matricule = checked(&matricule, "Matricule")?;
    let full_name = checked(&full_name, "Nom complet")?;
    let class_name = checked(&class_name, "Classe")?;
    let mut connection = state.connection.lock().map_err(|_| "Base locale verrouillée")?;
    let tx = connection.transaction().map_err(db_error)?;
    let school = required_school(&tx)?;
    let id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO students (id,school_id,matricule,full_name,class_name) VALUES (?1,?2,?3,?4,?5)",
        params![&id, &school.school_id, &matricule, &full_name, &class_name],
    )
    .map_err(db_error)?;
    enqueue(
        &tx,
        &school.school_id,
        "student.created",
        &id,
        json!({"local_id":id,"matricule":matricule,"full_name":full_name,"class_name":class_name}),
    )?;
    tx.commit().map_err(db_error)?;
    Ok(())
}

#[tauri::command]
fn add_charge(
    state: State<'_, LocalStore>,
    student_id: String,
    label: String,
    amount_fcfa: i64,
) -> Result<(), String> {
    if amount_fcfa <= 0 {
        return Err("Le montant doit être un entier positif en FCFA.".into());
    }
    let label = checked(&label, "Libellé de frais")?;
    let mut connection = state.connection.lock().map_err(|_| "Base locale verrouillée")?;
    let tx = connection.transaction().map_err(db_error)?;
    let school = required_school(&tx)?;
    let count: i64 = tx.query_row(
        "SELECT COUNT(*) FROM students WHERE id=?1 AND school_id=?2",
        params![&student_id, &school.school_id],
        |row| row.get(0),
    ).map_err(db_error)?;
    if count != 1 {
        return Err("Élève introuvable dans cet établissement.".into());
    }
    let id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO charges (id,school_id,student_id,label,amount_fcfa) VALUES (?1,?2,?3,?4,?5)",
        params![&id, &school.school_id, &student_id, &label, amount_fcfa],
    )
    .map_err(db_error)?;
    enqueue(
        &tx,
        &school.school_id,
        "charge.created",
        &id,
        json!({"local_id":id,"student_local_id":student_id,"label":label,"amount_fcfa":amount_fcfa}),
    )?;
    tx.commit().map_err(db_error)?;
    Ok(())
}

#[tauri::command]
fn record_cash_payment(
    state: State<'_, LocalStore>,
    charge_id: String,
    amount_fcfa: i64,
    request_id: String,
) -> Result<Payment, String> {
    if amount_fcfa <= 0 {
        return Err("Versement invalide : montant positif obligatoire.".into());
    }
    let request_id = checked(&request_id, "Identifiant d'opération")?;
    let mut connection = state.connection.lock().map_err(|_| "Base locale verrouillée")?;
    let tx = connection.transaction().map_err(db_error)?;
    let school = required_school(&tx)?;

    // La même requête rejouée retourne le paiement initial, sans le dupliquer.
    let existing: Option<Payment> = tx.query_row(
        "SELECT id,charge_id,amount_fcfa,receipt_no,created_at,sync_status FROM payments WHERE request_id=?1",
        params![&request_id],
        |row| Ok(Payment {
            id: row.get(0)?, charge_id: row.get(1)?, amount_fcfa: row.get(2)?,
            receipt_no: row.get(3)?, created_at: row.get(4)?, sync_status: row.get(5)?,
        }),
    ).optional().map_err(db_error)?;
    if let Some(payment) = existing {
        if payment.charge_id != charge_id || payment.amount_fcfa != amount_fcfa {
            return Err("Identifiant d'opération déjà employé pour un autre paiement.".into());
        }
        return Ok(payment);
    }

    let remaining: Option<i64> = tx.query_row(
        "SELECT c.amount_fcfa - COALESCE((SELECT SUM(p.amount_fcfa) FROM payments p WHERE p.charge_id=c.id),0)
         FROM charges c WHERE c.id=?1 AND c.school_id=?2",
        params![&charge_id, &school.school_id],
        |row| row.get(0),
    ).optional().map_err(db_error)?;
    let remaining = remaining.ok_or_else(|| "Créance introuvable dans cet établissement.".to_string())?;
    if amount_fcfa > remaining {
        return Err(format!("Le versement dépasse le solde local de {remaining} FCFA."));
    }

    let id = Uuid::new_v4().to_string();
    let receipt_no = format!("PROV-{id}");
    tx.execute(
        "INSERT INTO payments (id,school_id,charge_id,amount_fcfa,request_id,receipt_no)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![&id, &school.school_id, &charge_id, amount_fcfa, &request_id, &receipt_no],
    ).map_err(db_error)?;
    enqueue(
        &tx,
        &school.school_id,
        "payment.cash.created",
        &id,
        json!({"local_id":id,"charge_local_id":charge_id,"amount_fcfa":amount_fcfa,
              "request_id":request_id,"receipt_no":receipt_no}),
    )?;

    let created_at: String = tx.query_row(
        "SELECT created_at FROM payments WHERE id=?1", params![&id], |row| row.get(0),
    ).map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(Payment {
        id, charge_id, amount_fcfa, receipt_no, created_at, sync_status: "pending".into()
    })
}

#[tauri::command]
fn get_overview(state: State<'_, LocalStore>) -> Result<Overview, String> {
    let connection = state.connection.lock().map_err(|_| "Base locale verrouillée")?;
    let school = connection.query_row(
        "SELECT school_id,school_name,academic_year FROM school_config WHERE id='current'",
        [],
        |row| Ok(School {
            school_id: row.get(0)?, school_name: row.get(1)?, academic_year: row.get(2)?
        }),
    ).optional().map_err(db_error)?;

    let mut s_stmt = connection.prepare(
        "SELECT id,matricule,full_name,class_name FROM students ORDER BY full_name,matricule"
    ).map_err(db_error)?;
    let students = s_stmt.query_map([], |row| Ok(Student {
        id: row.get(0)?, matricule: row.get(1)?, full_name: row.get(2)?,
        class_name: row.get(3)?
    })).map_err(db_error)?.collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)?;

    let mut c_stmt = connection.prepare(
        "SELECT c.id,c.student_id,c.label,c.amount_fcfa,
          COALESCE((SELECT SUM(p.amount_fcfa) FROM payments p WHERE p.charge_id=c.id),0)
         FROM charges c ORDER BY c.created_at,c.id"
    ).map_err(db_error)?;
    let charges = c_stmt.query_map([], |row| Ok(Charge {
        id: row.get(0)?, student_id: row.get(1)?, label: row.get(2)?,
        amount_fcfa: row.get(3)?, paid_fcfa: row.get(4)?
    })).map_err(db_error)?.collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)?;

    let mut p_stmt = connection.prepare(
        "SELECT id,charge_id,amount_fcfa,receipt_no,created_at,sync_status
         FROM payments ORDER BY created_at DESC,id DESC"
    ).map_err(db_error)?;
    let payments = p_stmt.query_map([], |row| Ok(Payment {
        id: row.get(0)?, charge_id: row.get(1)?, amount_fcfa: row.get(2)?,
        receipt_no: row.get(3)?, created_at: row.get(4)?, sync_status: row.get(5)?
    })).map_err(db_error)?.collect::<rusqlite::Result<Vec<_>>>().map_err(db_error)?;

    let pending_events: i64 = connection.query_row(
        "SELECT COUNT(*) FROM outbox WHERE status='pending'", [], |row| row.get(0)
    ).map_err(db_error)?;

    Ok(Overview { school, students, charges, payments, pending_events })
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let connection = Connection::open(data_dir.join("finance.sqlite"))?;
            init_db(&connection)?;
            app.manage(LocalStore { connection: Mutex::new(connection) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_overview, configure_school, add_student, add_charge, record_cash_payment
        ])
        .run(tauri::generate_context!())
        .expect("Impossible d'initialiser Mon Cahier Finance Desktop");
}
