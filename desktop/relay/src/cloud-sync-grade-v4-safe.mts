import type { RelayConfig } from "./config.mjs";
import type { RelayStore } from "./store.mjs";
import type { RelayCloudSyncRunResult } from "./cloud-sync.mjs";
import {
  requeueTimetableReplacementChain,
} from "./cloud-sync.mjs";
import { syncRelayOnce as syncRelayOnceV4 } from "./cloud-sync-grade-v4.mjs";
import { rekeyResolvedKeepLocalGradeOperations } from "./grade-conflict-rebase.mjs";
import {
  clearRelayCloudSyncWake,
  registerRelayCloudSyncWake,
} from "./sync-wakeup.mjs";

type SyncOptions = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

function needsGradeVersionBootstrap(store: RelayStore) {
  const row = store.db.prepare(`
    SELECT COUNT(*) AS count
    FROM student_grades
    WHERE deleted_at IS NULL
      AND server_version <= 0
  `).get() as { count: number };
  return Number(row.count || 0) > 0;
}

function forceAcademicSnapshotInput(input: Parameters<typeof fetch>[0]) {
  if (input instanceof URL) {
    const endpoint = new URL(input.toString());
    endpoint.searchParams.delete("known_revision");
    return endpoint;
  }
  if (typeof input === "string") {
    const endpoint = new URL(input);
    endpoint.searchParams.delete("known_revision");
    return endpoint.toString();
  }
  return input;
}

function withGradeV4Capability(
  fetchImpl: typeof fetch,
  forceAcademicBootstrap: boolean,
): typeof fetch {
  return (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const headers = new Headers(init?.headers);
    headers.set("X-MonCahier-Grade-Sync-V4", "1");
    const method = String(init?.method || "GET").toUpperCase();
    const requestInput = forceAcademicBootstrap && method === "GET"
      ? forceAcademicSnapshotInput(input)
      : input;
    return fetchImpl(requestInput, { ...init, headers });
  }) as typeof fetch;
}

export function requeueRecoverableAttendanceChains(
  config: RelayConfig,
  store: RelayStore,
  now = new Date(),
) {
  let requeued = 0;
  for (const institution of config.institutions || []) {
    const code = String(institution.code || "").trim().toUpperCase();
    if (!code) continue;
    const localInstitution = store.db.prepare(`
      SELECT id FROM institutions
      WHERE UPPER(COALESCE(code, '')) = ? AND deleted_at IS NULL
      LIMIT 1
    `).get(code) as { id: string } | undefined;
    if (!localInstitution) continue;

    const roots = store.db.prepare(`
      SELECT operation_id
      FROM sync_outbox
      WHERE institution_id = ?
        AND entity_type = 'teacher_session'
        AND state = 'blocked'
        AND last_status = 422
        AND last_error = 'timetable_not_found'
      ORDER BY occurred_at, operation_id
    `).all(localInstitution.id) as Array<{ operation_id: string }>;

    for (const root of roots) {
      try {
        const result = requeueTimetableReplacementChain(store.db, {
          institutionCode: code,
          rootOperationId: root.operation_id,
          expectedError: "timetable_not_found",
          now,
        });
        requeued += result.requeued_operation_ids.length;
      } catch {
        // Aucun remplacement unique et sûr : conserver la chaîne bloquée telle quelle.
      }
    }
  }
  return requeued;
}

export function releaseNetworkRetryBackoffAfterConnectivity(
  store: RelayStore,
  now = new Date(),
) {
  const nowIso = now.toISOString();
  const changed = store.db.prepare(`
    UPDATE sync_outbox
    SET next_attempt_at = ?
    WHERE state = 'pending'
      AND last_status IS NULL
      AND next_attempt_at IS NOT NULL
      AND next_attempt_at > ?
      AND last_error IS NOT NULL
  `).run(nowIso, nowIso);
  return changed.changes;
}

function provesCloudConnectivity(result: RelayCloudSyncRunResult) {
  return result.acknowledged_operations > 0 ||
    result.pull_not_modified > 0 ||
    result.pull_snapshots_applied > 0;
}

async function runProtectedSync(
  config: RelayConfig,
  store: RelayStore,
  options: SyncOptions,
) {
  const now = options.now || (() => new Date());
  requeueRecoverableAttendanceChains(config, store, now());
  const forceAcademicBootstrap = needsGradeVersionBootstrap(store);
  const fetchImpl = withGradeV4Capability(
    options.fetchImpl || fetch,
    forceAcademicBootstrap,
  );
  const result = await syncRelayOnceV4(config, store, {
    ...options,
    fetchImpl,
  });

  // Une réponse Cloud valide prouve que la connexion est revenue. Les opérations
  // qui attendaient uniquement à cause d'une panne réseau ne doivent alors pas
  // rester prisonnières d'un ancien backoff exponentiel.
  if (provesCloudConnectivity(result)) {
    const released = releaseNetworkRetryBackoffAfterConnectivity(store, now());
    requeueRecoverableAttendanceChains(config, store, now());
    if (released > 0) {
      await syncRelayOnceV4(config, store, {
        ...options,
        fetchImpl,
      });
    }
  }
  return result;
}

export async function syncRelayOnce(
  config: RelayConfig,
  store: RelayStore,
  options: SyncOptions = {},
): Promise<RelayCloudSyncRunResult> {
  rekeyResolvedKeepLocalGradeOperations(store.db, (options.now || (() => new Date()))());
  return runProtectedSync(config, store, options);
}

export function createRelayCloudSyncAgent(
  config: RelayConfig,
  store: RelayStore,
  options: SyncOptions = {},
) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let currentRun: Promise<void> | null = null;
  let pauseUntil = 0;
  let failures = 0;
  const nowMs = () => (options.now || (() => new Date()))().getTime();
  const postpone = () => {
    failures += 1;
    pauseUntil = nowMs() + Math.min(120_000, (config.cloudSyncIntervalMs || 15_000) * 2 ** Math.min(failures, 8));
  };
  const tick = (force = false) => {
    if (currentRun) return currentRun;
    if (!force && nowMs() < pauseUntil) return Promise.resolve();
    let unavailable = false;
    let healthy = false;
    const network = options.fetchImpl || fetch;
    const fetchImpl: typeof fetch = async (input, init) => {
      try {
        const response = await network(input, init);
        if (response.status === 402 || response.status === 429 || response.status >= 500) unavailable = true;
        if (response.ok) healthy = true;
        return response;
      } catch (error) { unavailable = true; throw error; }
    };
    const run = syncRelayOnce(config, store, { ...options, fetchImpl })
      .then(() => {
        // A healthy institution keeps its normal automatic sync cadence.
        if (unavailable && !healthy) postpone();
        else { failures = 0; pauseUntil = 0; }
      })
      .catch(() => {
        // Toute opération reste durablement dans SQLite et sera reprise plus tard.
        postpone();
      })
      .finally(() => {
        if (currentRun === run) currentRun = null;
      });
    currentRun = run;
    return run;
  };

  return {
    start() {
      registerRelayCloudSyncWake(tick);
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), config.cloudSyncIntervalMs || 15_000);
      timer.unref();
    },
    async stop() {
      clearRelayCloudSyncWake(tick);
      if (timer) clearInterval(timer);
      timer = null;
      await currentRun;
    },
    runOnce: () => tick(true),
  };
}
