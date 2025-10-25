// Sanitize global fetch for browsers (Edge/Chromium):
// - strip RequestInit.duplex (browser doesn't allow it)
// - normalize headers/method
// - JSON-ify plain object bodies
let applied = false;

export function applyFetchPatch() {
  if (applied) return;
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;

  const original = window.fetch.bind(window);

  function sanitizeInit(init?: RequestInit): RequestInit | undefined {
    if (!init) return undefined;
    const o: any = { ...init };

    // ❌ Clés interdites côté navigateur (souvent injectées par Node/undici)
    if ("duplex" in o) delete o.duplex;
    if ("window" in o) delete o.window; // parfois mis à null par certains polyfills

    // Méthode → uppercase
    if (typeof o.method === "string") o.method = o.method.toUpperCase();

    // Headers → forcer un Headers()
    if (o.headers && !(o.headers instanceof Headers)) {
      try {
        o.headers = new Headers(o.headers as any);
      } catch {
        o.headers = new Headers();
      }
    }

    // Body objet brut → JSON (mais on ne touche pas aux FormData/Blob/etc.)
    const b = o.body;
    const isPlainObj =
      b &&
      typeof b === "object" &&
      !(b instanceof Blob) &&
      !(b instanceof FormData) &&
      !(b instanceof URLSearchParams) &&
      !(b instanceof ArrayBuffer) &&
      !(b instanceof ReadableStream);
    if (isPlainObj) {
      try { (o.headers as Headers).set("Content-Type", "application/json"); } catch {}
      o.body = JSON.stringify(b);
    }

    // Edge est tatillon: pas de propriétés `undefined`
    for (const k of Object.keys(o)) {
      if (o[k] === undefined) delete o[k];
    }

    return o;
  }

  (window as any).fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return original(input as any, sanitizeInit(init));
    } catch {
      // dernier recours: on appelle brut
      return original(input as any, init as any);
    }
  };

  (window as any).__FETCH_PATCHED__ = true;
  applied = true;
}
