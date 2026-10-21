// A private student photo is served by Mon Cahier with the viewer's session.
// Behind a reverse proxy, the server-generated absolute URL may point to a
// different host. A print document (blob:) must use the browser's true origin.
const PROTECTED_STUDENT_PHOTO_PATH =
  /^\/api\/media\/student-photo\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function attestationPhotoUrlForCurrentOrigin(
  rawPhotoUrl: string | null | undefined,
  browserOrigin: string,
): string | null {
  const raw = String(rawPhotoUrl || "").trim();
  if (!raw) return null;

  try {
    const site = new URL(browserOrigin);
    if (site.protocol !== "https:" && site.protocol !== "http:") return null;

    const source = new URL(raw, site);
    if (!PROTECTED_STUDENT_PHOTO_PATH.test(source.pathname)) return null;

    // Preserve only the protected student photo path and version query.
    // Do not trust an absolute host supplied through the API/proxy.
    return new URL(source.pathname + source.search, site.origin).toString();
  } catch {
    return null;
  }
}
