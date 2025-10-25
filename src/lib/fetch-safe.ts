// Force toujours une URL string vers window.fetch (évite "Invalid value" sur Edge)
export function applyFetchPatch() {
  if (typeof window === "undefined") return;
  const w = window as any;
  if (w.__FETCH_SAFE_PATCH__) return;

  const native = window.fetch.bind(window);
  w.__FETCH_SAFE_PATCH__ = true;

  window.fetch = ((input: any, init?: RequestInit) => {
    try {
      const url =
        typeof input === "string"
          ? input
          : (input && typeof input.url === "string")
          ? input.url
          : String(input);
      return native(url, init as any);
    } catch {
      return native(String(input), init as any);
    }
  }) as any;
}
