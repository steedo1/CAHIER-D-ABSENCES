CREATE TABLE IF NOT EXISTS sync_bootstrap_runs (
  snapshot_id TEXT NOT NULL,
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  generated_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  imported_entities INTEGER NOT NULL DEFAULT 0 CHECK (imported_entities >= 0),
  preserved_local_entities INTEGER NOT NULL DEFAULT 0 CHECK (preserved_local_entities >= 0),
  collections_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  PRIMARY KEY (snapshot_id, institution_id)
);

CREATE INDEX IF NOT EXISTS sync_bootstrap_runs_institution_time
  ON sync_bootstrap_runs(institution_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS sync_materialization_failures (
  institution_id TEXT NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('upsert', 'delete')),
  payload_json TEXT,
  server_version INTEGER NOT NULL DEFAULT 0 CHECK (server_version >= 0),
  occurred_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  last_error TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (institution_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS sync_materialization_failures_retry
  ON sync_materialization_failures(institution_id, updated_at);
