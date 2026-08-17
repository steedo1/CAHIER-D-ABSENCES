"use client";

import { cacheGet, cacheSet } from "@/lib/offline";
import { getOfflineAccessIntent } from "@/lib/offline-auth-client";

const CACHE_PREFIX = "admin:essential:http:v1";
const CACHE_SOURCE_HEADER = "X-Mon-Cahier-Data-Source";
const SESSION_SCOPE_KEY = "mc:admin-essential:scope:v1";

export type AdminEssentialCachedResponse = {
  body: string;
  status: number;
  content_type: string;
  saved_at: string;
};

type AdminEssentialScope = {
  user_id: string;
  institution_id: string;
};

let currentSessionUserId: string | null = null;

function requestUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input), window.location.origin);
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  const fromInit = String(init?.method || "").trim();
  if (fromInit) return fromInit.toUpperCase();
  if (input instanceof Request) return String(input.method || "GET").toUpperCase();
  return "GET";
}

function normalizedPath(url: URL) {
  const entries = Array.from(url.searchParams.entries()).sort(([aKey, aValue], [bKey, bValue]) => {
    const keyOrder = aKey.localeCompare(bKey);
    return keyOrder || aValue.localeCompare(bValue);
  });
  const query = new URLSearchParams(entries).toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

export function isAdminEssentialReadPath(pathname: string) {
  if (
    pathname === "/api/admin/classes" ||
    pathname === "/api/admin/students" ||
    pathname === "/api/admin/institution/settings" ||
    pathname === "/api/admin/institution/academic-years" ||
    pathname === "/api/admin/institution/grading-periods" ||
    pathname === "/api/admin/grades/bulletin" ||
    pathname === "/api/admin/conduite/averages" ||
    pathname === "/api/admin/affectations/current"
  ) {
    return true;
  }

  return (
    /^\/api\/admin\/classes\/[^/]+\/students$/.test(pathname) ||
    /^\/api\/admin\/classes\/[^/]+\/roster$/.test(pathname)
  );
}

export function setAdminEssentialSessionUser(userId: string | null | undefined) {
  currentSessionUserId = String(userId || "").trim() || null;
}

export function rememberAdminEssentialScope(input: {
  userId: string;
  institutionId: string;
}) {
  if (typeof window === "undefined") return;
  const userId = String(input.userId || "").trim();
  const institutionId = String(input.institutionId || "").trim();
  if (!userId || !institutionId) return;
  currentSessionUserId = userId;
  const value: AdminEssentialScope = {
    user_id: userId,
    institution_id: institutionId,
  };
  try {
    window.sessionStorage.setItem(SESSION_SCOPE_KEY, JSON.stringify(value));
  } catch {
    // Le cache reste simplement indisponible dans cette session privée.
  }
}

function currentCloudScope(): AdminEssentialScope | null {
  if (typeof window === "undefined" || !currentSessionUserId) return null;
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(SESSION_SCOPE_KEY) || "null",
    ) as AdminEssentialScope | null;
    if (
      !parsed ||
      String(parsed.user_id || "").trim() !== currentSessionUserId ||
      !String(parsed.institution_id || "").trim()
    ) {
      return null;
    }
    return {
      user_id: currentSessionUserId,
      institution_id: String(parsed.institution_id).trim(),
    };
  } catch {
    return null;
  }
}

async function adminScope(): Promise<AdminEssentialScope | null> {
  // Une vraie connexion hors ligne est la source la plus forte : le grant est
  // signé, lié à l'appareil et contient déjà utilisateur + établissement.
  const active = await getOfflineAccessIntent().catch(() => null);
  if (active?.payload.role === "admin") {
    const userId = String(active.payload.user_id || "").trim();
    const institutionId = String(active.payload.institution_id || "").trim();
    if (userId && institutionId) {
      return { user_id: userId, institution_id: institutionId };
    }
  }

  // En session Cloud normale, le scope n'est accepté que s'il correspond au
  // user Supabase actuellement exposé par useAuth ET à l'établissement confirmé
  // par /api/auth/role pendant cette même session d'onglet.
  return currentCloudScope();
}

async function cacheKey(url: URL) {
  const scope = await adminScope();
  if (!scope) return null;
  const partition = `${scope.user_id}:${scope.institution_id}`;
  return `${CACHE_PREFIX}:${partition}:${encodeURIComponent(normalizedPath(url))}`;
}

function cacheAllowedStatus(status: number) {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

function syntheticResponse(cached: AdminEssentialCachedResponse) {
  const headers = new Headers({
    "Content-Type": cached.content_type || "application/json; charset=utf-8",
    [CACHE_SOURCE_HEADER]: "cache",
  });
  return new Response(cached.body, {
    status: cached.status >= 200 && cached.status < 300 ? cached.status : 200,
    headers,
  });
}

async function readCached(url: URL) {
  const key = await cacheKey(url);
  if (!key) return null;
  return await cacheGet<AdminEssentialCachedResponse>(key).catch(() => null);
}

async function storeResponse(url: URL, response: Response) {
  if (!response.ok) return;
  const contentType = String(response.headers.get("content-type") || "");
  if (!contentType.toLowerCase().includes("json")) return;
  const key = await cacheKey(url);
  if (!key) return;
  const body = await response.clone().text();
  await cacheSet(key, {
    body,
    status: response.status,
    content_type: contentType,
    saved_at: new Date().toISOString(),
  } satisfies AdminEssentialCachedResponse).catch(() => undefined);
}

export async function adminEssentialFetch(
  originalFetch: typeof window.fetch,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (typeof window === "undefined") return await originalFetch(input, init);

  let url: URL;
  try {
    url = requestUrl(input);
  } catch {
    return await originalFetch(input, init);
  }

  if (
    url.origin !== window.location.origin ||
    requestMethod(input, init) !== "GET" ||
    !isAdminEssentialReadPath(url.pathname)
  ) {
    return await originalFetch(input, init);
  }

  try {
    const response = await originalFetch(input, init);
    if (response.ok) {
      void storeResponse(url, response).catch(() => undefined);
      return response;
    }

    // 401/403/404/422 et autres erreurs métier ne doivent jamais être masquées
    // par une ancienne copie locale. Seules les erreurs réseau/serveur temporaires
    // peuvent retomber sur le paquet préparé.
    if (!cacheAllowedStatus(response.status)) return response;
    const cached = await readCached(url);
    return cached ? syntheticResponse(cached) : response;
  } catch (error) {
    const cached = await readCached(url);
    if (cached) return syntheticResponse(cached);
    throw error;
  }
}

let installed = false;
let originalFetch: typeof window.fetch | null = null;

export function installAdminEssentialFetchBridge() {
  if (typeof window === "undefined" || installed) return;
  const current = window.fetch.bind(window);
  originalFetch = current;
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    adminEssentialFetch(current, input, init)) as typeof window.fetch;
  installed = true;
}

export function uninstallAdminEssentialFetchBridgeForTests() {
  if (typeof window === "undefined" || !installed || !originalFetch) return;
  window.fetch = originalFetch;
  originalFetch = null;
  installed = false;
  currentSessionUserId = null;
}

// Le composant de préparation est monté dans le layout racine. Installer ici
// rend le secours disponible avant les useEffect des pages Admin elles-mêmes.
if (typeof window !== "undefined") installAdminEssentialFetchBridge();
