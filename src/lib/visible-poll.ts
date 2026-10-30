/** Non-critical display counters only. Business writes and attendance delivery
 * must not use this scheduler. Each run settles before another is scheduled. */
export function startVisiblePoll(task: (signal: AbortSignal) => Promise<void>, intervalMs = 120_000) {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let nextAttempt = 0;
  let controller: AbortController | undefined;
  const visible = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const schedule = () => {
    clear();
    if (!stopped && !running && visible()) timer = setTimeout(run, Math.max(0, nextAttempt - Date.now()));
  };
  const run = async () => {
    if (stopped || running || !visible()) return;
    if (Date.now() < nextAttempt) { schedule(); return; }
    running = true;
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 15_000);
    try { await task(controller.signal); failures = 0; }
    catch { failures = Math.min(failures + 1, 3); }
    finally {
      running = false;
      clearTimeout(timeout);
      controller = undefined;
      nextAttempt = Date.now() + Math.min(intervalMs * 2 ** failures, 15 * 60_000);
      schedule();
    }
  };
  const wake = () => { if (!visible()) clear(); else void run(); };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
  window.addEventListener("offline", wake);
  window.addEventListener("focus", wake);
  void run();
  return () => {
    stopped = true;
    controller?.abort();
    clear();
    document.removeEventListener("visibilitychange", wake);
    window.removeEventListener("online", wake);
    window.removeEventListener("offline", wake);
    window.removeEventListener("focus", wake);
  };
}
