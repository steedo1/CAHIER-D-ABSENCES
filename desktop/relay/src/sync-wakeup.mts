type RelayCloudSyncTrigger = () => Promise<void> | void;

const DEFAULT_MIN_WAKE_INTERVAL_MS = 10_000;

let registeredTrigger: RelayCloudSyncTrigger | null = null;
let activeRun: Promise<void> | null = null;
let lastWakeAt = 0;

export function registerRelayCloudSyncWake(trigger: RelayCloudSyncTrigger) {
  registeredTrigger = trigger;
  lastWakeAt = 0;
}

export function clearRelayCloudSyncWake(trigger?: RelayCloudSyncTrigger) {
  if (trigger && registeredTrigger !== trigger) return;
  registeredTrigger = null;
  activeRun = null;
  lastWakeAt = 0;
}

export function wakeRelayCloudSync(
  nowMs = Date.now(),
  minIntervalMs = DEFAULT_MIN_WAKE_INTERVAL_MS,
): Promise<void> | null {
  if (!registeredTrigger) return null;
  if (activeRun) return activeRun;
  if (
    lastWakeAt > 0 &&
    Number.isFinite(nowMs) &&
    nowMs - lastWakeAt < Math.max(0, minIntervalMs)
  ) {
    return null;
  }

  lastWakeAt = Number.isFinite(nowMs) ? nowMs : Date.now();
  const trigger = registeredTrigger;
  const run = Promise.resolve()
    .then(() => trigger())
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      if (activeRun === run) activeRun = null;
    });
  activeRun = run;
  return run;
}
