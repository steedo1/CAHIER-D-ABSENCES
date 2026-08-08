import type { OfflinePreparationTrigger } from "./offline-preparation-machine.ts";

export const OFFLINE_PREPARATION_TRIGGER_DEBOUNCE_MS = 300;

const PRIORITY: Record<OfflinePreparationTrigger, number> = {
  periodic: 1,
  initial: 2,
  focus: 3,
  visibility: 4,
  online: 5,
  context_change: 6,
  retry: 7,
  service_worker: 8,
  manual: 9,
};

type RetrySnapshot = { next_retry_at: number | null };

type Options = {
  run(trigger: OfflinePreparationTrigger): Promise<RetrySnapshot | null>;
  subscribeOnline(listener: EventListener): () => void;
  subscribeFocus(listener: EventListener): () => void;
  subscribeVisibility(listener: EventListener): () => void;
  subscribeServiceWorker(listener: EventListener): () => void;
  subscribeSnapshot(listener: (snapshot: RetrySnapshot) => void): () => void;
  isVisible(): boolean;
  now?: () => number;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  initialDelayMs?: number;
  intervalMs?: number;
  debounceMs?: number;
};

export function createOfflinePreparationTriggerController(options: Options) {
  const now = options.now || Date.now;
  const setTimeoutFn = options.setTimeout || globalThis.setTimeout;
  const clearTimeoutFn = options.clearTimeout || globalThis.clearTimeout;
  const setIntervalFn = options.setInterval || globalThis.setInterval;
  const clearIntervalFn = options.clearInterval || globalThis.clearInterval;
  const debounceMs = Math.max(0, options.debounceMs ?? OFFLINE_PREPARATION_TRIGGER_DEBOUNCE_MS);
  const initialDelayMs = Math.max(0, options.initialDelayMs ?? 0);
  const intervalMs = Math.max(1_000, options.intervalMs ?? 5 * 60_000);

  let started = false;
  let stopped = false;
  let running = false;
  let queued: OfflinePreparationTrigger | null = null;
  let debounced: OfflinePreparationTrigger | null = null;
  let debounceTimer: ReturnType<typeof setTimeoutFn> | null = null;
  let retryTimer: ReturnType<typeof setTimeoutFn> | null = null;
  let initialTimer: ReturnType<typeof setTimeoutFn> | null = null;
  let intervalTimer: ReturnType<typeof setIntervalFn> | null = null;
  let removers: Array<() => void> = [];

  const stronger = (current: OfflinePreparationTrigger | null, candidate: OfflinePreparationTrigger) =>
    !current || PRIORITY[candidate] > PRIORITY[current] ? candidate : current;

  function clearRetry() {
    if (retryTimer !== null) clearTimeoutFn(retryTimer);
    retryTimer = null;
  }

  async function execute(trigger: OfflinePreparationTrigger) {
    if (stopped) return;
    if (running) {
      queued = stronger(queued, trigger);
      return;
    }
    running = true;
    try {
      const snapshot = await options.run(trigger);
      if (snapshot) scheduleRetry(snapshot);
    } finally {
      running = false;
      const next = queued;
      queued = null;
      if (next && !stopped) schedule(next);
    }
  }

  function flushDebounce() {
    debounceTimer = null;
    const trigger = debounced;
    debounced = null;
    if (trigger) void execute(trigger);
  }

  function schedule(trigger: OfflinePreparationTrigger) {
    if (stopped) return;
    if (trigger === "visibility" && !options.isVisible()) return;
    if (running) {
      queued = stronger(queued, trigger);
      return;
    }
    debounced = stronger(debounced, trigger);
    if (debounceTimer !== null) clearTimeoutFn(debounceTimer);
    debounceTimer = setTimeoutFn(flushDebounce, debounceMs);
  }

  function scheduleRetry(snapshot: RetrySnapshot) {
    clearRetry();
    if (stopped || snapshot.next_retry_at === null || !Number.isFinite(snapshot.next_retry_at)) return;
    retryTimer = setTimeoutFn(() => {
      retryTimer = null;
      void execute("retry");
    }, Math.max(0, snapshot.next_retry_at - now()));
  }

  function stop() {
    if (!started) return;
    stopped = true;
    started = false;
    removers.splice(0).forEach((remove) => remove());
    if (debounceTimer !== null) clearTimeoutFn(debounceTimer);
    if (initialTimer !== null) clearTimeoutFn(initialTimer);
    if (intervalTimer !== null) clearIntervalFn(intervalTimer);
    clearRetry();
    debounceTimer = null;
    initialTimer = null;
    intervalTimer = null;
    debounced = null;
    queued = null;
  }

  function start() {
    if (started) return stop;
    stopped = false;
    started = true;
    removers = [
      options.subscribeOnline(() => schedule("online")),
      options.subscribeFocus(() => schedule("focus")),
      options.subscribeVisibility(() => {
        if (options.isVisible()) schedule("visibility");
      }),
      options.subscribeServiceWorker(() => schedule("service_worker")),
      options.subscribeSnapshot(scheduleRetry),
    ];
    initialTimer = setTimeoutFn(() => schedule("initial"), initialDelayMs);
    intervalTimer = setIntervalFn(() => schedule("periodic"), intervalMs);
    return stop;
  }

  return { start, stop, notifySnapshot: scheduleRetry, scheduleRetry, schedule };
}
