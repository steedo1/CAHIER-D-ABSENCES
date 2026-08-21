import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  defaultRelayMdnsHostname,
  normalizeRelayMdnsHostname,
  relayMdnsUrl,
} from "./mdns.mjs";

export const DEFAULT_RELAY_ALLOWED_ORIGINS = [
  "https://mon-cahier.com",
  "https://www.mon-cahier.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://tauri.localhost",
  "tauri://localhost",
] as const;

export type RelayCloudSyncInstitutionConfig = {
  enabled?: boolean;
  endpoint?: string;
  pull_endpoint?: string;
  device_id?: string;
  token?: string;
};

export type RelayInstitutionConfig = {
  code: string;
  name: string;
  admin_token?: string;
  cloud_sync?: RelayCloudSyncInstitutionConfig;
};

export type RelayConfigFile = {
  version?: number;
  institution_code?: string;
  institution_name?: string;
  institutions?: RelayInstitutionConfig[];
  database_path?: string;
  host?: string;
  port?: number;
  token?: string;
  allowed_origins?: string[];
  teacher_attendance_writes_enabled?: boolean;
  grade_score_writes_enabled?: boolean;
  cloud_sync_interval_seconds?: number;
  cloud_sync_batch_size?: number;
  cloud_sync_timeout_seconds?: number;
  mdns_enabled?: boolean;
  mdns_hostname?: string;
};

export type RelayConfig = {
  databasePath: string;
  host: string;
  port: number;
  token: string | null;
  allowedOrigins?: string[];
  configPath?: string | null;
  institutionCode?: string | null;
  institutionName?: string | null;
  institutions?: RelayInstitutionConfig[];
  institutionCodes?: string[];
  teacherAttendanceWritesEnabled?: boolean;
  gradeScoreWritesEnabled?: boolean;
  cloudSyncIntervalMs?: number;
  cloudSyncBatchSize?: number;
  cloudSyncTimeoutMs?: number;
  mdnsEnabled?: boolean;
  mdnsHostname?: string;
  mdnsUrl?: string;
};

function positivePort(value: string | number | undefined) {
  const parsed = Number(value || "4317");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("MONCAHIER_RELAY_PORT_invalid");
  }
  return parsed;
}

export function isLoopbackHost(host: string) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function defaultRelayConfigPath(env: NodeJS.ProcessEnv = process.env) {
  const explicit = String(env.MONCAHIER_RELAY_CONFIG || "").trim();
  if (explicit) return resolve(explicit);
  const localAppData = String(env.LOCALAPPDATA || "").trim();
  return localAppData ? resolve(localAppData, "MonCahier", "Relay", "config.json") : null;
}

export function readRelayConfigFile(path: string | null): RelayConfigFile {
  if (!path) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not_an_object");
    }
    return parsed as RelayConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return {};
    throw new Error("MONCAHIER_RELAY_CONFIG_invalid", { cause: error });
  }
}

function stringList(value: string | undefined) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizedInstitutionCode(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function normalizedCloudSync(value: unknown): RelayCloudSyncInstitutionConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const endpoint = String(row.endpoint || "").trim().replace(/\/+$/, "");
  const explicitPullEndpoint = String(row.pull_endpoint || "").trim().replace(/\/+$/, "");
  const pullEndpoint = explicitPullEndpoint || (
    endpoint.endsWith("/push")
      ? `${endpoint.slice(0, -"/push".length)}/pull`
      : ""
  );
  const deviceId = String(row.device_id || "").trim();
  const token = String(row.token || "").trim();
  const enabled = row.enabled === true;
  if (!endpoint && !pullEndpoint && !deviceId && !token && !enabled) return undefined;
  return {
    enabled,
    ...(endpoint ? { endpoint } : {}),
    ...(pullEndpoint ? { pull_endpoint: pullEndpoint } : {}),
    ...(deviceId ? { device_id: deviceId } : {}),
    ...(token ? { token } : {}),
  };
}


function booleanSetting(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function teacherAttendanceWritesEnabled(file: RelayConfigFile, env: NodeJS.ProcessEnv) {
  const configured = String(env.MONCAHIER_RELAY_TEACHER_ATTENDANCE_WRITES_ENABLED || "")
    .trim()
    .toLowerCase();
  if (configured) return ["1", "true", "yes", "on"].includes(configured);
  return file.teacher_attendance_writes_enabled === true;
}

function gradeScoreWritesEnabled(file: RelayConfigFile, env: NodeJS.ProcessEnv) {
  const configured = String(env.MONCAHIER_RELAY_GRADE_SCORE_WRITES_ENABLED || "")
    .trim()
    .toLowerCase();
  if (configured) return ["1", "true", "yes", "on"].includes(configured);
  return file.grade_score_writes_enabled === true;
}

export function relayInstitutionsFromConfigFile(file: RelayConfigFile) {
  const result = new Map<string, RelayInstitutionConfig>();
  const candidates = Array.isArray(file.institutions) ? file.institutions : [];
  for (const item of candidates) {
    const code = normalizedInstitutionCode(item?.code);
    if (!code) continue;
    const cloudSync = normalizedCloudSync(item?.cloud_sync);
    result.set(code, {
      code,
      name: String(item?.name || code).trim() || code,
      ...(String(item?.admin_token || "").trim()
        ? { admin_token: String(item.admin_token).trim() }
        : {}),
      ...(cloudSync ? { cloud_sync: cloudSync } : {}),
    });
  }
  const legacyCode = normalizedInstitutionCode(file.institution_code);
  if (legacyCode && !result.has(legacyCode)) {
    result.set(legacyCode, {
      code: legacyCode,
      name: String(file.institution_name || legacyCode).trim() || legacyCode,
      ...(String(file.token || "").trim() ? { admin_token: String(file.token).trim() } : {}),
    });
  }
  return Array.from(result.values());
}

export function loadRelayConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const configPath = defaultRelayConfigPath(env);
  const file = readRelayConfigFile(configPath);
  const fallbackDataDir = configPath ? join(dirname(configPath), "data") : "data";
  const dataDir = resolve(env.MONCAHIER_RELAY_DATA_DIR || fallbackDataDir);
  const host = String(env.MONCAHIER_RELAY_HOST || file.host || "127.0.0.1").trim();
  const token = String(env.MONCAHIER_RELAY_TOKEN || file.token || "").trim() || null;
  const configuredOrigins = stringList(env.MONCAHIER_RELAY_ALLOWED_ORIGINS);
  const allowedOrigins = configuredOrigins.length
    ? configuredOrigins
    : Array.isArray(file.allowed_origins) && file.allowed_origins.length
      ? file.allowed_origins.map((item) => String(item).trim()).filter(Boolean)
      : [...DEFAULT_RELAY_ALLOWED_ORIGINS];
  const institutions = relayInstitutionsFromConfigFile(file);
  const mdnsEnabled = booleanSetting(
    env.MONCAHIER_RELAY_MDNS_ENABLED ?? file.mdns_enabled,
    true,
  );
  const mdnsHostname = normalizeRelayMdnsHostname(
    String(
      env.MONCAHIER_RELAY_MDNS_HOSTNAME ||
        file.mdns_hostname ||
        defaultRelayMdnsHostname(institutions[0]?.code || null),
    ),
  );
  if (!isLoopbackHost(host) && !token) {
    throw new Error("MONCAHIER_RELAY_TOKEN_required_for_lan");
  }
  return {
    databasePath: resolve(env.MONCAHIER_RELAY_DB || file.database_path || resolve(dataDir, "moncahier-relay.db")),
    host,
    port: positivePort(env.MONCAHIER_RELAY_PORT || file.port),
    token,
    allowedOrigins,
    configPath,
    institutionCode: institutions[0]?.code || null,
    institutionName: institutions[0]?.name || null,
    institutions,
    institutionCodes: institutions.map((item) => item.code),
    teacherAttendanceWritesEnabled: teacherAttendanceWritesEnabled(file, env),
    gradeScoreWritesEnabled: gradeScoreWritesEnabled(file, env),
    cloudSyncIntervalMs: boundedInteger(
      env.MONCAHIER_RELAY_CLOUD_SYNC_INTERVAL_SECONDS ?? file.cloud_sync_interval_seconds,
      15,
      5,
      3600,
    ) * 1000,
    cloudSyncBatchSize: boundedInteger(
      env.MONCAHIER_RELAY_CLOUD_SYNC_BATCH_SIZE ?? file.cloud_sync_batch_size,
      25,
      1,
      100,
    ),
    cloudSyncTimeoutMs: boundedInteger(
      env.MONCAHIER_RELAY_CLOUD_SYNC_TIMEOUT_SECONDS ?? file.cloud_sync_timeout_seconds,
      20,
      5,
      120,
    ) * 1000,
    mdnsEnabled,
    mdnsHostname,
    mdnsUrl: relayMdnsUrl(mdnsHostname, positivePort(env.MONCAHIER_RELAY_PORT || file.port)),
  };
}
