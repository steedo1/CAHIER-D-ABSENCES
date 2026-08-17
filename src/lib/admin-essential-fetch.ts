"use client";

import { cacheGet, cacheSet } from "@/lib/offline";
import { getOfflineAccessIntent } from "@/lib/offline-auth-client";
import { getRelayConfig } from "@/lib/local-relay";

const CACHE_PREFIX = "admin:essential:http:v1";
const CACHE_SOURCE_HEADER = "X-Mon-Cahier-Data-Source";
const SESSION_SCOPE_KEY = "mc:admin-essential:scope:v1";
const RELAY_TIMEOUT_MS = 4_000;

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

type RelayDashboardRoster = {
  academic_year?: string | null;
  academic_years?: Array<Record<string, any>>;
  grading_periods?: Array<Record<string, any>>;
  classes?: Array<Record<string, any>>;
  students?: Array<Record<string, any>>;
  institution_settings?: Record<string, any>;
};

type RelayDashboardPayload = {
  institution?: Record<string, any>;
  roster?: RelayDashboardRoster;
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

function isRelayBackedAdminReadPath(pathname: string) {
  return (
    pathname === "/api/admin/classes" ||
    pathname === "/api/admin/students" ||
    pathname === "/api/admin/institution/settings" ||
    pathname === "/api/admin/institution/academic-years" ||
    pathname === "/api/admin/institution/grading-periods" ||
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

function dataResponse(
  payload: unknown,
  source: "relay" | "cache",
  status = 200,
  contentType = "application/json; charset=utf-8",
) {
  const headers = new Headers({
    "Content-Type": contentType,
    [CACHE_SOURCE_HEADER]: source,
  });
  return new Response(
    typeof payload === "string" ? payload : JSON.stringify(payload),
    { status, headers },
  );
}

function syntheticResponse(cached: AdminEssentialCachedResponse) {
  return dataResponse(
    cached.body,
    "cache",
    cached.status >= 200 && cached.status < 300 ? cached.status : 200,
    cached.content_type || "application/json; charset=utf-8",
  );
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

function todayInAbidjan() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Abidjan",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function mergeAbortSignal(external?: AbortSignal | null) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);
  const onAbort = () => controller.abort(external?.reason);
  external?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      window.clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

async function relayDashboard(
  originalFetch: typeof window.fetch,
  scope: AdminEssentialScope,
  externalSignal?: AbortSignal | null,
): Promise<RelayDashboardPayload | null> {
  const config = getRelayConfig();
  const query = new URLSearchParams({
    institution_id: scope.institution_id,
    date: todayInAbidjan(),
  });
  const headers = new Headers({ Accept: "application/json" });
  if (config.token) headers.set("Authorization", `Bearer ${config.token}`);
  const merged = mergeAbortSignal(externalSignal);
  try {
    const init: RequestInit & { targetAddressSpace?: "local" | "loopback" } = {
      method: "GET",
      headers,
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      signal: merged.signal,
    };
    try {
      const hostname = new URL(config.baseUrl).hostname.toLowerCase();
      init.targetAddressSpace =
        hostname === "localhost" ||
        hostname === "::1" ||
        hostname === "[::1]" ||
        /^127(?:\.|$)/.test(hostname)
          ? "loopback"
          : "local";
    } catch {
      // URL déjà normalisée par getRelayConfig ; le fetch standard reste possible.
    }

    const response = await originalFetch(
      `${config.baseUrl}/v1/admin/dashboard?${query.toString()}`,
      init as RequestInit,
    );
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as RelayDashboardPayload | null;
    return payload?.roster ? payload : null;
  } catch {
    return null;
  } finally {
    merged.cleanup();
  }
}

function filterRelayClasses(url: URL, roster: RelayDashboardRoster) {
  const currentYear = String(roster.academic_year || "").trim();
  const requestedYear = String(url.searchParams.get("academic_year") || "").trim();
  if (requestedYear === "all") return null;
  if (requestedYear && currentYear && requestedYear !== currentYear) return null;

  const educationType = String(url.searchParams.get("education_type") || "").trim();
  const formationCode = String(url.searchParams.get("formation_code") || "").trim();
  const levelCode = String(
    url.searchParams.get("formation_level_code") ||
      url.searchParams.get("level_code") ||
      "",
  ).trim();
  const classId = String(
    url.searchParams.get("class_id") || url.searchParams.get("classId") || "",
  ).trim();

  let items = Array.isArray(roster.classes) ? [...roster.classes] : [];
  if (classId) items = items.filter((row) => String(row.id || "") === classId);
  if (educationType && educationType !== "all") {
    items = items.filter((row) => {
      const value = String(row.education_type || "").trim();
      return educationType === "general_secondary"
        ? !value || value === "general_secondary"
        : value === educationType;
    });
  }
  if (formationCode) {
    items = items.filter(
      (row) => String(row.formation_code || "").trim() === formationCode,
    );
  }
  if (levelCode) {
    items = items.filter((row) => {
      const value =
        educationType === "general_secondary"
          ? row.level
          : row.formation_level_code || row.level;
      return String(value || "").trim() === levelCode;
    });
  }

  return {
    items,
    academic_year: currentYear || null,
    scope: {
      education_type: educationType || null,
      formation_code: formationCode || null,
      formation_level_code: levelCode || null,
      class_id: classId || null,
    },
  };
}

function relayAcademicYear(roster: RelayDashboardRoster, code?: string | null) {
  const wanted = String(code || roster.academic_year || "").trim();
  const years = Array.isArray(roster.academic_years) ? roster.academic_years : [];
  return (
    years.find((row) => String(row.code || "").trim() === wanted) ||
    years.find((row) => row.is_current === true) ||
    null
  );
}

function relayInstitutionPayload(
  dashboard: RelayDashboardPayload,
  roster: RelayDashboardRoster,
): Record<string, any> {
  const settings = roster.institution_settings || {};
  const institution = dashboard.institution || {};
  return {
    ...settings,
    institution_name:
      settings.institution_name || settings.name || institution.name || null,
    name: settings.name || settings.institution_name || institution.name || null,
    institution_code:
      settings.institution_code || settings.code || institution.code || null,
  };
}

function relayRosterResponse(
  url: URL,
  dashboard: RelayDashboardPayload,
): Response | null {
  const roster = dashboard.roster;
  if (!roster) return null;

  if (url.pathname === "/api/admin/classes") {
    const payload = filterRelayClasses(url, roster);
    return payload ? dataResponse(payload, "relay") : null;
  }

  if (url.pathname === "/api/admin/students") {
    const requestedYear = String(url.searchParams.get("academic_year") || "").trim();
    const currentYear = String(roster.academic_year || "").trim();
    if (requestedYear === "all") return null;
    if (requestedYear && currentYear && requestedYear !== currentYear) return null;
    const classId = String(
      url.searchParams.get("class_id") || url.searchParams.get("classId") || "",
    ).trim();
    const students = (Array.isArray(roster.students) ? roster.students : []).filter(
      (row) => !classId || String(row.class_id || "").trim() === classId,
    );
    return dataResponse(
      { items: students, academic_year: currentYear || null },
      "relay",
    );
  }

  if (url.pathname === "/api/admin/institution/settings") {
    return dataResponse(relayInstitutionPayload(dashboard, roster), "relay");
  }

  if (url.pathname === "/api/admin/institution/academic-years") {
    return dataResponse(
      {
        ok: true,
        items: Array.isArray(roster.academic_years) ? roster.academic_years : [],
      },
      "relay",
    );
  }

  if (url.pathname === "/api/admin/institution/grading-periods") {
    const requestedYear = String(
      url.searchParams.get("academic_year") || roster.academic_year || "",
    ).trim();
    const classId = String(url.searchParams.get("class_id") || "").trim();
    const classRow = (Array.isArray(roster.classes) ? roster.classes : []).find(
      (row) => String(row.id || "").trim() === classId,
    );
    const allPeriods = Array.isArray(roster.grading_periods)
      ? roster.grading_periods
      : [];
    const yearPeriods = allPeriods.filter(
      (row) =>
        (!requestedYear || String(row.academic_year || "").trim() === requestedYear) &&
        row.is_active !== false,
    );
    const common = yearPeriods.filter((row) => {
      const scopeType = String(row.scope_type || "").trim();
      const educationType = String(row.education_type || "").trim();
      return (
        (!scopeType || scopeType === "common") &&
        (!educationType ||
          educationType === "general_secondary" ||
          !classRow?.education_type ||
          educationType === String(classRow.education_type || ""))
      );
    });
    const items = common.length ? common : yearPeriods;
    return dataResponse(
      {
        ok: true,
        academic_year: requestedYear || roster.academic_year || null,
        class_id: classId || null,
        education_type: classRow?.education_type || null,
        formation_code: classRow?.formation_code || null,
        resolved_scope: "relay_snapshot",
        fallback_to_common: common.length > 0,
        items,
      },
      "relay",
    );
  }

  const rosterMatch = url.pathname.match(/^\/api\/admin\/classes\/([^/]+)\/roster$/);
  if (rosterMatch) {
    const classId = decodeURIComponent(rosterMatch[1] || "");
    const classRow = (Array.isArray(roster.classes) ? roster.classes : []).find(
      (row) => String(row.id || "").trim() === classId,
    );
    if (!classRow) return null;
    const students = (Array.isArray(roster.students) ? roster.students : [])
      .filter((row) => String(row.class_id || "").trim() === classId)
      .map((row) => ({
        id: row.id,
        matricule: row.matricule ?? null,
        full_name: row.full_name || "—",
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        gender: row.gender ?? null,
        birthdate: row.birthdate ?? row.birth_date ?? null,
        birth_place: row.birth_place ?? null,
        nationality: row.nationality ?? null,
        is_repeater: row.is_repeater ?? null,
        lv2: row.lv2 ?? null,
        is_affecte: row.is_affecte ?? null,
        is_boarder: row.is_boarder ?? null,
        official_track_code: row.official_track_code ?? null,
        enrollment_start_date: row.enrollment_start_date ?? null,
      }));
    const settings = relayInstitutionPayload(dashboard, roster);
    const year = relayAcademicYear(roster, String(classRow.academic_year || ""));
    return dataResponse(
      {
        ok: true,
        can_edit: false,
        class: {
          id: classRow.id,
          label: classRow.label || classRow.name || "Classe",
          level: classRow.level ?? null,
          code: classRow.code ?? null,
          academic_year: classRow.academic_year ?? roster.academic_year ?? null,
          official_track_code: classRow.official_track_code ?? null,
        },
        academic_year: year
          ? {
              code: year.code ?? roster.academic_year ?? null,
              label: year.label ?? year.code ?? roster.academic_year ?? null,
              start_date: year.start_date ?? null,
              end_date: year.end_date ?? null,
              is_current: year.is_current === true,
            }
          : {
              code: roster.academic_year ?? null,
              label: roster.academic_year ?? null,
              start_date: null,
              end_date: null,
              is_current: true,
            },
        institution: {
          id: dashboard.institution?.id ?? null,
          name: settings.institution_name || settings.name || "Établissement",
          acronym: null,
          logo_url: settings.institution_logo_url || settings.logo_url || null,
          phone: settings.institution_phone || settings.phone || null,
          email: settings.institution_email || settings.email || null,
          regional_direction:
            settings.institution_region || settings.regional_direction || null,
          postal_address:
            settings.institution_postal_address || settings.postal_address || null,
          status: settings.institution_status || settings.status || null,
          head_name: settings.institution_head_name || settings.head_name || null,
          head_title: settings.institution_head_title || settings.head_title || null,
          country_name: settings.country_name || null,
          country_motto: settings.country_motto || null,
          ministry_name: settings.ministry_name || null,
          code: settings.institution_code || dashboard.institution?.code || null,
        },
        staff: { head_teacher: null, educators: [] },
        students,
        totals: {
          students: students.length,
          girls: students.filter((row) => /^f/i.test(String(row.gender || ""))).length,
          boys: students.filter((row) => /^m/i.test(String(row.gender || ""))).length,
        },
      },
      "relay",
    );
  }

  return null;
}

async function readRelay(
  originalFetch: typeof window.fetch,
  url: URL,
  init?: RequestInit,
) {
  if (!isRelayBackedAdminReadPath(url.pathname)) return null;
  const scope = await adminScope();
  if (!scope) return null;
  const dashboard = await relayDashboard(originalFetch, scope, init?.signal);
  if (!dashboard) return null;
  return relayRosterResponse(url, dashboard);
}

async function fallbackResponse(
  originalFetch: typeof window.fetch,
  url: URL,
  init?: RequestInit,
) {
  const relay = await readRelay(originalFetch, url, init);
  if (relay) {
    void storeResponse(url, relay).catch(() => undefined);
    return relay;
  }
  const cached = await readCached(url);
  return cached ? syntheticResponse(cached) : null;
}

/**
 * Publie une réponse JSON déjà calculée sous une autre URL de lecture
 * fonctionnellement équivalente. Utilisé notamment par Conseil de classe pour
 * réemployer le snapshot Bulletin/Conduite préparé, sans seconde requête Cloud.
 */
export async function cacheAdminEssentialJson(
  rawUrl: string,
  payload: unknown,
) {
  if (typeof window === "undefined") return;
  const url = new URL(rawUrl, window.location.origin);
  if (
    url.origin !== window.location.origin ||
    !isAdminEssentialReadPath(url.pathname)
  ) {
    throw new Error("admin_essential_alias_path_forbidden");
  }
  const key = await cacheKey(url);
  if (!key) throw new Error("admin_essential_scope_missing");
  await cacheSet(key, {
    body: JSON.stringify(payload),
    status: 200,
    content_type: "application/json; charset=utf-8",
    saved_at: new Date().toISOString(),
  } satisfies AdminEssentialCachedResponse);
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
    // par une ancienne copie locale ou par le relais.
    if (!cacheAllowedStatus(response.status)) return response;
    return (await fallbackResponse(originalFetch, url, init)) || response;
  } catch (error) {
    const fallback = await fallbackResponse(originalFetch, url, init);
    if (fallback) return fallback;
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
