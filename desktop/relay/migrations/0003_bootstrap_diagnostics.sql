ALTER TABLE sync_bootstrap_runs
  ADD COLUMN source_skipped_entities INTEGER NOT NULL DEFAULT 0
  CHECK (source_skipped_entities >= 0);

ALTER TABLE sync_bootstrap_runs
  ADD COLUMN source_diagnostics_json TEXT NOT NULL DEFAULT '{}';
