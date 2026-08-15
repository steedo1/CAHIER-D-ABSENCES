import type { RelayConfig } from "./config.mjs";
import type { RelayStore } from "./store.mjs";
import {
  syncRelayOnce as syncRelayOnceV4,
  type RelayCloudSyncRunResult,
} from "./cloud-sync-grade-v4.mjs";
import { rekeyResolvedKeepLocalGradeOperations } from "./grade-conflict-rebase.mjs";

type SyncOptions = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export async function syncRelayOnce(
  config: RelayConfig,
  store: RelayStore,
  options: SyncOptions = {},
): Promise<RelayCloudSyncRunResult> {
  rekeyResolvedKeepLocalGradeOperations(store.db, (options.now || (() => new Date()))());
  return syncRelayOnceV4(config, store, options);
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
