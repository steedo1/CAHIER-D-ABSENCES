type OriginRequest = { headers: Pick<Headers, "get">; nextUrl: { origin: string } };

const OFFICIAL_ORIGINS = ["https://www.mon-cahier.com", "https://mon-cahier.com"];

function originOnly(raw: string): string | null {
  try {
    const value = new URL(raw);
    if (!["http:", "https:"].includes(value.protocol) || value.username || value.password ||
        value.pathname !== "/" || value.search || value.hash) return null;
    return value.origin;
  } catch { return null; }
}

/**
 * Render terminates TLS at its proxy: nextUrl.origin may be the internal listener.
 * Trust the configured public app and exact official domains, never forwarded
 * headers supplied by a caller. Authentication and school scope remain mandatory.
 */
export function isTrustedAppOrigin(req: OriginRequest, configuredUrls: readonly string[] = [
  process.env.NEXT_PUBLIC_APP_URL || "", process.env.PUBLIC_APP_URL || "", process.env.APP_URL || "",
]): boolean {
  const supplied = req.headers.get("origin");
  if (!supplied) return true; // Preserve existing authenticated non-browser clients.
  const origin = originOnly(supplied);
  if (!origin) return false;
  // In production the internal listener is not a trusted browser destination.
  if (process.env.NODE_ENV !== "production" && origin === originOnly(req.nextUrl.origin)) return true;
  return [...OFFICIAL_ORIGINS, ...configuredUrls].some((value) => originOnly(value) === origin);
}
