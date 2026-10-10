/** Shared with the browser SDK. Legacy cookies are only a migration fallback. */
export const SESSION_STORAGE_KEY = "mca-auth-v1";
type Cookie = { name: string; value: string };

export function isSessionCookie(name: string) {
  return name === SESSION_STORAGE_KEY || /^mca-auth-v1\.\d+$/.test(name);
}

export function sessionCookies(cookies: Cookie[], url: string): Cookie[] {
  // Never replace a newer SDK session with the old HttpOnly token copies.
  if (cookies.some((cookie) => isSessionCookie(cookie.name))) return cookies;
  const values = new Map(cookies.map(({ name, value }) => [name, value]));
  let access = values.get("sb-access-token");
  let refresh = values.get("sb-refresh-token");
  const ref = url.match(/^https:\/\/([^.]+)\.supabase\.co/i)?.[1];
  try {
    const legacy = JSON.parse(values.get(`sb-${ref}-auth-token`) || "null");
    access ||= legacy?.currentSession?.access_token;
    refresh ||= legacy?.currentSession?.refresh_token;
    if (!access || !refresh) return cookies;
    const payload = access.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(payload));
    if (!Number.isFinite(exp)) return cookies;
    // exp schedules refresh only. Never authorize from this unverified payload.
    return [...cookies, { name: SESSION_STORAGE_KEY, value: JSON.stringify({
      access_token: access, refresh_token: refresh, expires_at: exp,
      expires_in: 0, token_type: "bearer",
    }) }];
  } catch {
    return cookies;
  }
}
