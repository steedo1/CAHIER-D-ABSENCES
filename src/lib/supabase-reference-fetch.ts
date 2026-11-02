/** Short-lived cache for stable reference rows only. Authorization queries,
 * student data, sessions, grades and QR writes always go to Supabase. */
export function createReferenceFetch(network: typeof fetch = fetch): typeof fetch {
  // Cache bytes, never unread Response/tee streams. Bound native buffers too.
  type Snapshot = { bytes: ArrayBuffer; init: ResponseInit; expires: number };
  const entries = new Map<string, Snapshot>();
  const MAX_BYTES = 4 * 1024 * 1024;
  const MAX_ENTRY_BYTES = 256 * 1024;
  let retainedBytes = 0;
  const materialize = (entry: Snapshot) => new Response(
    [204, 205, 304].includes(entry.init.status || 200) ? null : entry.bytes.slice(0), entry.init,
  );
  function remove(key: string) {
    const entry = entries.get(key);
    if (entry) retainedBytes -= entry.bytes.byteLength;
    entries.delete(key);
  }
  const pending = new Map<string, Promise<Snapshot>>();
  let generation = 0;
  function invalidate() { generation++; entries.clear(); retainedBytes = 0; pending.clear(); }
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const table = url.pathname.match(/^\/rest\/v1\/(classes|institutions)$/)?.[1];
    if (method !== "GET") {
      // Invalidate before and after any business write, even if it was made
      // through another table/trigger. In-flight reads cannot refill old data.
      invalidate();
      try { return await network(input, init); } finally { invalidate(); }
    }
    const scoped = url.searchParams.has("institution_id") || /^eq\.[a-f0-9-]{36}$/i.test(url.searchParams.get("id") || "");
    const select = url.searchParams.get("select") || "";
    const sensitive = /password|login|device|token|secret|phone|settings_json/i;
    if (!table || !scoped || !select || select.includes("*") || sensitive.test(select) ||
        [...url.searchParams.keys()].some((column) => sensitive.test(column)) || init?.signal) return network(input, init);
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const key = JSON.stringify([url.href, [...headers.entries()].sort()]);
    for (const [entryKey, entry] of entries) if (entry.expires <= Date.now()) remove(entryKey);
    const cached = entries.get(key);
    if (cached) return materialize(cached);
    const running = pending.get(key);
    if (running) return materialize(await running);
    const version = generation;
    // Avoid retaining arbitrary numbers of concurrent, distinct cache loads.
    if (pending.size >= 16) return network(input, init);
    const task = network(input, init).then(async response => {
      const bytes = await response.arrayBuffer();
      const snapshot: Snapshot = { bytes, init: {
        status: response.status, statusText: response.statusText, headers: [...response.headers.entries()],
      }, expires: Date.now() + (table === "classes" ? 3_000 : 15_000) };
      if (response.ok && version === generation && bytes.byteLength <= MAX_ENTRY_BYTES) {
        while (entries.size && (entries.size >= 200 || retainedBytes + bytes.byteLength > MAX_BYTES)) {
          remove(entries.keys().next().value!);
        }
        entries.set(key, snapshot);
        retainedBytes += bytes.byteLength;
      }
      return snapshot;
    });
    pending.set(key, task);
    try { return materialize(await task); }
    finally { if (pending.get(key) === task) pending.delete(key); }
  };
}

