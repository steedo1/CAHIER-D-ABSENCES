/* eslint-disable no-console -- bounded operational telemetry, no user data */
import { readFileSync } from "node:fs";
import { getHeapStatistics } from "node:v8";

function cgroupBytes() {
  for (const path of ["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes"]) {
    try { const value = Number(readFileSync(path, "utf8").trim()); if (Number.isFinite(value)) return value; } catch { /* non-Linux/local */ }
  }
  return null;
}
export function runtimeMemorySample() {
  return {
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    ...process.memoryUsage(), heapLimit: getHeapStatistics().heap_size_limit,
    cgroupBytes: cgroupBytes(),
    release: process.env.RENDER_GIT_COMMIT || process.env.NEXT_PUBLIC_MON_CAHIER_RELEASE || "development",
  };
}
const key = Symbol.for("mon-cahier.memory-telemetry");
const scope = globalThis as typeof globalThis & { [key]?: ReturnType<typeof setInterval> };
export function startMemoryTelemetry() {
  if (scope[key]) return;
  const report = () => console.info("[runtime-memory] " + JSON.stringify(runtimeMemorySample()));
  report();
  scope[key] = setInterval(report, 300_000);
  scope[key]!.unref();
}
