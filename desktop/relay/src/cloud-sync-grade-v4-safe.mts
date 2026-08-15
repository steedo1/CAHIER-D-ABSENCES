import type { RelayConfig } from "./config.mjs";
import type { RelayStore } from "./store.mjs";
import type { RelayCloudSyncRunResult } from "./cloud-sync.mjs";
import { syncRelayOnce as syncRelayOnceV4 } from "./cloud-sync-grade-v4.mjs";
import { rekeyResolvedKeepLocalGradeOperations } from "./grade-conflict-rebase.mjs";

type SyncOptions = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

function withGradeV4Capability(fetchImpl: typeof fetch): typeof fetch {
  return (async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const headers = new Headers(init?.headers);
    headers.set("X-MonCahier-Grade-Sync-V4", "1");
    return fetchImpl(input, { ...init, headers });
  }) as typeof fetch;
}

export async function syncRelayOnce(
  config: RelayConfig,
  store: RelayStore,
  options: SyncOptions = {},
): Promise<RelayCloudSyncRunResult> {
  rekeyResolvedKeepLocalGradeOperations(store.db, (options.now || (() => new Date()))());
  return syncRelayOnceV4(config, store, {
    ...options,
    fetchImpl: withGradeV4Capability(options.fetchImpl || fetch),
  });
}

export function createRelayCloudSyncAgent(
  config: RelayConfig,
  store: RelayStore,
  options: SyncOptions = {},
) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let currentRun: Promise<void> | null = null;
  const tick = () => {
    if (currentRun) return currentRun;
    const run = syncRelayOnce(config, store, options)
      .then(() => undefined)
      .catch(() => {
        // Toute opération reste durablement dans SQLite et sera reprise plus tard.
      })
      .finally(() => {
        if (currentRun === run) currentRun = null;
      });
    currentRun = run;
    return run;
  };

  return {
    start() {
      if (timer) return;
      void tick();
      timer = setInterval(() => void tick(), config.cloudSyncIntervalMs || 15_000);
      timer.unref();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await currentRun;
    },
    runOnce: tick,
  };
}
