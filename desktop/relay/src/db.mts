import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = [{ version: 1, name: "core", file: "0001_core.sql" }] as const;

export type RelayDatabase = Database.Database;

export function openRelayDatabase(path: string): RelayDatabase {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("wal_autocheckpoint = 1000");
  migrate(db);
  return db;
}

function migrate(db: RelayDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS relay_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  const applied = db
    .prepare("SELECT version FROM schema_migrations")
    .all()
    .map((row) => Number((row as { version: number }).version));
  const appliedVersions = new Set(applied);

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;
    const file = fileURLToPath(new URL(`../migrations/${migration.file}`, import.meta.url));
    const sql = readFileSync(file, "utf8");
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, new Date().toISOString());
    });
    apply();
  }

  const violations = db.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) throw new Error("relay_database_foreign_key_violation");
}

export function schemaVersion(db: RelayDatabase) {
  const row = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
    .get() as { version: number };
  return Number(row.version || 0);
}

export function setMeta(db: RelayDatabase, key: string, value: string | null) {
  db.prepare(`
    INSERT INTO relay_meta(key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, new Date().toISOString());
}

export function getMeta(db: RelayDatabase, key: string) {
  const row = db.prepare("SELECT value FROM relay_meta WHERE key = ?").get(key) as
    | { value: string | null }
    | undefined;
  return row?.value ?? null;
}
