// Shared across Next route bundles in one Node process. DB leases still protect
// queue items across restarts/instances. No request objects or waiting queue.
const key = Symbol.for("mon-cahier.server-work-locks");
const scope = globalThis as typeof globalThis & { [key]?: Set<string> };
const active = scope[key] ??= new Set();
export function acquireServerWork(name: string): (() => void) | null {
  if (active.has(name)) return null;
  active.add(name);
  return () => { active.delete(name); };
}
