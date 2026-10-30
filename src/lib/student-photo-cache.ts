// Called ONLY after fresh authentication, student and institution/guardian
// checks. Browser responses remain private/no-store. No permissions are cached.
export function createStudentPhotoCache({ maxBytes = 8 * 1024 * 1024, maxEntryBytes = 1024 * 1024, ttlMs = 60_000 } = {}) {
  const entries = new Map<string, { file: Blob; expires: number }>();
  const pending = new Map<string, Promise<Blob | null>>();
  let bytes = 0;
  const remove = (key: string) => { const value = entries.get(key); if (value) bytes -= value.file.size; entries.delete(key); };
  return async (key: string | null, download: () => Promise<Blob | null>): Promise<Blob | null> => {
    if (!key) return download();
    for (const [id, entry] of entries) if (entry.expires <= Date.now()) remove(id);
    const cached = entries.get(key);
    if (cached) return cached.file;
    const existing = pending.get(key);
    if (existing) return existing;
    // Bound the in-flight index too; unusual bursts can bypass the cache.
    if (pending.size >= 100) return download();
    const task = Promise.resolve().then(download).then(file => {
      if (file && file.size <= maxEntryBytes && file.size <= maxBytes) {
        while (entries.size && (bytes + file.size > maxBytes || entries.size >= 200)) remove(entries.keys().next().value!);
        entries.set(key, { file, expires: Date.now() + ttlMs });
        bytes += file.size;
      }
      return file;
    });
    pending.set(key, task);
    try { return await task; }
    finally { if (pending.get(key) === task) pending.delete(key); }
  };
}

export const readStudentPhoto = createStudentPhotoCache();
