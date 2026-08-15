import { randomUUID } from "node:crypto";
import type { RelayDatabase } from "./db.mjs";
import { canonicalJson } from "./json.mjs";

type RebaseCandidate = {
  operation_id: string;
  institution_id: string;
  device_id: string;
  actor_profile_id: string | null;
  entity_type: string;
  entity_id: string;
  action: "upsert" | "delete";
  base_server_version: number;
  payload_json: string | null;
  occurred_at: string;
  state: string;
  attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  last_status: number | null;
  last_error: string | null;
  created_at: string;
  conflict_id: string;
  remote_server_version: number;
};

export type RebasedGradeOperation = {
  conflict_id: string;
  previous_operation_id: string;
  operation_id: string;
  entity_id: string;
  base_server_version: number;
};

/**
 * `keep_local` conserve l'intention métier mais la rebase sur la version Cloud
 * observée au conflit. Le reçu Cloud de l'ancienne opération est terminal et
 * immuable : la reprise doit donc porter un nouvel operation_id.
 */
export function rekeyResolvedKeepLocalGradeOperations(
  db: RelayDatabase,
  now = new Date(),
): RebasedGradeOperation[] {
  const candidates = db.prepare(`
    SELECT o.*, c.id AS conflict_id, c.remote_server_version
    FROM sync_outbox o
    JOIN sync_conflicts c
      ON c.institution_id = o.institution_id
     AND c.operation_id = o.operation_id
    WHERE o.entity_type = 'student_grade'
      AND o.state = 'pending'
      AND c.resolution = 'keep_local'
      AND c.resolved_at IS NOT NULL
      AND o.base_server_version = c.remote_server_version
    ORDER BY c.resolved_at, c.id
  `).all() as RebaseCandidate[];

  if (!candidates.length) return [];
  const nowIso = now.toISOString();
  const results: RebasedGradeOperation[] = [];

  db.transaction(() => {
    const dependencyCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM sync_outbox_dependencies
      WHERE institution_id = ?
        AND (operation_id = ? OR depends_on_operation_id = ?)
    `);
    const insert = db.prepare(`
      INSERT INTO sync_outbox(
        operation_id, institution_id, device_id, actor_profile_id,
        entity_type, entity_id, action, base_server_version, payload_json,
        occurred_at, state, attempts, next_attempt_at, last_attempt_at,
        last_status, last_error, created_at
      ) VALUES (?, ?, ?, ?, 'student_grade', ?, ?, ?, ?, ?,
                'pending', 0, NULL, NULL, NULL, NULL, ?)
    `);
    const remove = db.prepare(`
      DELETE FROM sync_outbox
      WHERE institution_id = ? AND operation_id = ?
        AND entity_type = 'student_grade' AND state = 'pending'
    `);
    const audit = db.prepare(`
      INSERT INTO audit_log(
        institution_id, actor_profile_id, device_id, event_type,
        entity_type, entity_id, details_json, occurred_at
      ) VALUES (?, ?, ?, 'sync.grade_keep_local_rebased',
                'student_grade', ?, ?, ?)
    `);

    for (const candidate of candidates) {
      const deps = Number((dependencyCount.get(
        candidate.institution_id,
        candidate.operation_id,
        candidate.operation_id,
      ) as { count: number }).count || 0);
      if (deps > 0) {
        db.prepare(`
          UPDATE sync_outbox
          SET state = 'blocked', next_attempt_at = NULL,
              last_status = 409,
              last_error = 'grade_keep_local_rebase_has_dependencies'
          WHERE institution_id = ? AND operation_id = ?
        `).run(candidate.institution_id, candidate.operation_id);
        continue;
      }

      const operationId = `grade-rebase-${randomUUID()}`;
      insert.run(
        operationId,
        candidate.institution_id,
        candidate.device_id,
        candidate.actor_profile_id,
        candidate.entity_id,
        candidate.action,
        candidate.remote_server_version,
        candidate.payload_json,
        candidate.occurred_at,
        nowIso,
      );
      const removed = remove.run(candidate.institution_id, candidate.operation_id);
      if (removed.changes !== 1) {
        throw new Error("grade_keep_local_rebase_source_changed");
      }
      audit.run(
        candidate.institution_id,
        candidate.actor_profile_id,
        candidate.device_id,
        candidate.entity_id,
        canonicalJson({
          conflict_id: candidate.conflict_id,
          previous_operation_id: candidate.operation_id,
          operation_id: operationId,
          base_server_version: candidate.remote_server_version,
        }),
        nowIso,
      );
      results.push({
        conflict_id: candidate.conflict_id,
        previous_operation_id: candidate.operation_id,
        operation_id: operationId,
        entity_id: candidate.entity_id,
        base_server_version: candidate.remote_server_version,
      });
    }
  })();

  return results;
}
