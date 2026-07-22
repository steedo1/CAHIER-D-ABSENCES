import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const DEFAULT_RELAY_ALLOWED_ORIGINS = [
  "https://mon-cahier.com",
  "https://www.mon-cahier.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://tauri.localhost",
  "tauri://localhost",
] as const;

export type RelayInstitutionConfig = {
  code: string;
  name: string;
  admin_token?: string;
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

function teacherAttendanceWritesEnabled(file: RelayConfigFile, env: NodeJS.ProcessEnv) {
  const configured = String(env.MONCAHIER_RELAY_TEACHER_ATTENDANCE_WRITES_ENABLED || "")
    .trim()
    .toLowerCase();
  if (configured) return ["1", "true", "yes", "on"].includes(configured);
  return file.teacher_attendance_writes_enabled === true;
}

export function relayInstitutionsFromConfigFile(file: RelayConfigFile) {
  const result = new Map<string, RelayInstitutionConfig>();
  const candidates = Array.isArray(file.institutions) ? file.institutions : [];
  for (const item of candidates) {
    const code = normalizedInstitutionCode(item?.code);
    if (!code) continue;
    result.set(code, {
      code,
      name: String(item?.name || code).trim() || code,
      ...(String(item?.admin_token || "").trim()
        ? { admin_token: String(item.admin_token).trim() }
        : {}),
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
  };
}
