/** Bounded, process-local reuse only; entitlement is rechecked before every call. */
const TTL_MS = 180_000;
const MAX_BYTES = 8 * 1024 * 1024;
const entries = new Map<string, { value: unknown; at: number; bytes: number }>();
const pending = new Map<string, Promise<{ value: unknown; generatedAt: string; reused: boolean }>>();

export class AiBusyError extends Error {}

export async function reuseAiAnalysis<T>(key: string, load: () => Promise<T>, now = Date.now()) {
  for (const [entryKey, entry] of entries) if (now - entry.at >= TTL_MS) entries.delete(entryKey);
  const cached = entries.get(key);
  if (cached) return { value: cached.value as T, generatedAt: new Date(cached.at).toISOString(), reused: true };
  const active = pending.get(key);
  if (active) return { ...await active, reused: true } as { value: T; generatedAt: string; reused: boolean };
  if (pending.size >= 2) throw new AiBusyError("Deux analyses sont déjà en cours. Réessayez dans un instant.");
  const work = (async () => {
    const value = await load();
    const at = Date.now();
    const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    if (bytes <= MAX_BYTES) {
      while (entries.size >= 4 || [...entries.values()].reduce((sum, e) => sum + e.bytes, 0) + bytes > MAX_BYTES) {
        entries.delete(entries.keys().next().value!);
      }
      entries.set(key, { value, at, bytes });
    }
    return { value, generatedAt: new Date(at).toISOString(), reused: false };
  })();
  pending.set(key, work);
  try { return await work; } finally { pending.delete(key); }
}
