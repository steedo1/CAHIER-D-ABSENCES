/** Short-lived cache for stable reference rows only. Authorization queries,
 * student data, sessions, grades and QR writes always go to Supabase. */
export function createReferenceFetch(network: typeof fetch = fetch): typeof fetch {
  const entries = new Map<string, { expires: number; response: Response }>();
  const pending = new Map<string, Promise<Response>>();
  let generation = 0;
  function invalidate() { generation++; entries.clear(); pending.clear(); }
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
    if (!table || !scoped || !select || select.includes("*") || /password|login|device/i.test(select) || init?.signal) return network(input, init);
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const key = JSON.stringify([url.href, [...headers.entries()].sort()]);
    const cached = entries.get(key);
    if (cached && cached.expires > Date.now()) return cached.response.clone();
    const running = pending.get(key);
    if (running) return (await running).clone();
    const version = generation;
    const task = network(input, init).then(async response => {
      if (response.ok && version === generation) {
        // The body is consumed into an independent response so storing a clone
        // never leaves an unbounded tee stream attached to the network response.
        const bytes = await response.arrayBuffer();
        const stored = new Response(bytes, {status:response.status,statusText:response.statusText,headers:response.headers});
        if (entries.size >= 200) entries.delete(entries.keys().next().value!);
        entries.set(key, {response:stored, expires:Date.now()+(table === "classes" ? 3_000 : 15_000)});
        return stored;
      }
      return response;
    });
    pending.set(key, task);
    try { return (await task).clone(); }
    finally { if (pending.get(key) === task) pending.delete(key); }
  };
}

