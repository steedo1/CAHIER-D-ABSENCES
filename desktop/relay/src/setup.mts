import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  defaultRelayMdnsHostname,
  normalizeRelayMdnsHostname,
  relayMdnsUrl,
} from "./mdns.mjs";
import {
  DEFAULT_RELAY_ALLOWED_ORIGINS,
  defaultRelayConfigPath,
  readRelayConfigFile,
  relayInstitutionsFromConfigFile,
  type RelayConfigFile,
} from "./config.mjs";

export type ConfigureRelayInput = {
  institutionCode: string;
  institutionName: string;
  configPath?: string;
  databasePath?: string;
  rotateToken?: boolean;
  addInstitution?: boolean;
  env?: NodeJS.ProcessEnv;
};

export type ConfigureCloudSyncInput = {
  institutionCode: string;
  endpoint: string;
  deviceId: string;
  token: string;
  enabled?: boolean;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
};

export type ConfigureCloudSyncResult = {
  ok: true;
  config_path: string;
  institution_code: string;
  endpoint: string;
  pull_endpoint: string;
  device_id: string;
  enabled: boolean;
  token_configured: true;
};

export type ConfigureRelayResult = {
  ok: true;
  config_path: string;
  database_path: string;
  institution_code: string;
  institution_name: string;
  mode: "single_school" | "school_group";
  institutions: Array<{ code: string; name: string }>;
  host: string;
  port: number;
  admin_url: string;
  lan_urls: string[];
  lan_hostname: string;
  lan_url: string;
  mdns_enabled: boolean;
  token: string;
  token_reused: boolean;
};

function safeSchoolSlug(value: string) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!slug) throw new Error("institution_code_invalid");
  return slug;
}

function validExistingToken(value: unknown) {
  const token = String(value || "").trim();
  return token.length >= 32 ? token : null;
}

export function relayLanUrls(
  port: number,
  interfaces?: ReturnType<typeof networkInterfaces>,
) {
  let availableInterfaces = interfaces;
  if (!availableInterfaces) {
    try {
      availableInterfaces = networkInterfaces();
    } catch {
      return [];
    }
  }
  const preferred: string[] = [];
  const fallback: string[] = [];
  for (const entries of Object.values(availableInterfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal || entry.address.startsWith("169.254.")) continue;
      const url = `http://${entry.address}:${port}`;
      fallback.push(url);
      if (
        entry.address.startsWith("10.") ||
        entry.address.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(entry.address)
      ) {
        preferred.push(url);
      }
    }
  }
  return Array.from(new Set(preferred.length ? preferred : fallback));
}

function writeConfigAtomically(configPath: string, file: RelayConfigFile) {
  mkdirSync(dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporaryPath, configPath);
}

export function configureCloudSync(
  input: ConfigureCloudSyncInput,
): ConfigureCloudSyncResult {
  const env = input.env || process.env;
  const institutionCode = String(input.institutionCode || "").trim().toUpperCase();
  const endpoint = String(input.endpoint || "").trim().replace(/\/+$/, "");
  const pullEndpoint = endpoint.endsWith("/push")
    ? `${endpoint.slice(0, -"/push".length)}/pull`
    : "";
  const deviceId = String(input.deviceId || "").trim();
  const token = String(input.token || "").trim();
  if (!institutionCode) throw new Error("institution_code_required");
  if (!endpoint) throw new Error("cloud_sync_endpoint_required");
  if (!pullEndpoint) throw new Error("cloud_sync_pull_endpoint_unavailable");
  if (!/^https:\/\//i.test(endpoint) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(endpoint)) {
    throw new Error("cloud_sync_endpoint_must_use_https");
  }
  if (!deviceId) throw new Error("cloud_sync_device_id_required");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)) {
    throw new Error("cloud_sync_device_id_invalid");
  }
  if (token.length < 32) throw new Error("cloud_sync_token_invalid");
  if (token.slice(0, token.indexOf(".")) !== deviceId) {
    throw new Error("cloud_sync_token_device_mismatch");
  }

  const requestedConfigPath = input.configPath || defaultRelayConfigPath(env);
  if (!requestedConfigPath) throw new Error("MONCAHIER_RELAY_CONFIG_required");
  const configPath = resolve(requestedConfigPath);
  const existing = readRelayConfigFile(configPath);
  const institutions = relayInstitutionsFromConfigFile(existing);
  const index = institutions.findIndex((item) => item.code === institutionCode);
  if (index < 0) throw new Error("institution_not_configured");
  const current = institutions[index];
  if (!current) throw new Error("institution_not_configured");
  institutions[index] = {
    ...current,
    cloud_sync: {
      enabled: input.enabled !== false,
      endpoint,
      pull_endpoint: pullEndpoint,
      device_id: deviceId,
      token,
    },
  };
  const file: RelayConfigFile = {
    ...existing,
    version: Math.max(4, Number(existing.version || 0)),
    institutions,
  };
  writeConfigAtomically(configPath, file);
  return {
    ok: true,
    config_path: configPath,
    institution_code: institutionCode,
    endpoint,
    pull_endpoint: pullEndpoint,
    device_id: deviceId,
    enabled: input.enabled !== false,
    token_configured: true,
  };
}

export function configureRelay(input: ConfigureRelayInput): ConfigureRelayResult {
  const env = input.env || process.env;
  const institutionCode = String(input.institutionCode || "").trim().toUpperCase();
  const institutionName = String(input.institutionName || "").trim();
  if (!institutionCode) throw new Error("institution_code_required");
  if (!institutionName) throw new Error("institution_name_required");

  const requestedConfigPath = input.configPath || defaultRelayConfigPath(env);
  if (!requestedConfigPath) throw new Error("MONCAHIER_RELAY_CONFIG_required");
  const configPath = resolve(requestedConfigPath);
  const existing = readRelayConfigFile(configPath);
  const existingInstitutions = relayInstitutionsFromConfigFile(existing);
  const existingInstitution = existingInstitutions.find((item) => item.code === institutionCode);
  const previousMasterToken = validExistingToken(existing.token);
  const sameInstitution = Boolean(existingInstitution);
  const extendingSchoolGroup = Boolean(
    input.addInstitution && existingInstitutions.length > 0 && !sameInstitution,
  );
  const preservingInstallation = sameInstitution || extendingSchoolGroup;
  const existingSchoolToken = validExistingToken(existingInstitution?.admin_token) ||
    (existingInstitutions.length === 1 ? previousMasterToken : null);
  const schoolToken = !input.rotateToken && sameInstitution && existingSchoolToken
    ? existingSchoolToken
    : randomBytes(32).toString("base64url");
  const masterToken = extendingSchoolGroup && existingInstitutions.length === 1
    ? randomBytes(32).toString("base64url")
    : preservingInstallation && previousMasterToken && !(input.rotateToken && existingInstitutions.length <= 1)
      ? previousMasterToken
      : schoolToken;
  const databasePath = resolve(
    input.databasePath ||
      (preservingInstallation ? String(existing.database_path || "").trim() : "") ||
      join(dirname(configPath), "data", `${safeSchoolSlug(institutionCode)}.db`),
  );
  const institutions = extendingSchoolGroup
    ? [
        ...existingInstitutions,
        { code: institutionCode, name: institutionName, admin_token: schoolToken },
      ]
    : sameInstitution
      ? existingInstitutions.map((item) =>
          item.code === institutionCode
            ? {
                ...item,
                code: institutionCode,
                name: institutionName,
                admin_token: schoolToken,
              }
            : item
        )
      : [{ code: institutionCode, name: institutionName, admin_token: schoolToken }];
  const primaryInstitution = institutions[0] || {
    code: institutionCode,
    name: institutionName,
    admin_token: schoolToken,
  };

  const configuredHost = String(existing.host || "0.0.0.0").trim() || "0.0.0.0";
  const configuredPort = typeof existing.port === "number" && Number.isInteger(existing.port)
    ? existing.port
    : 4317;
  const configuredMdnsHostname = normalizeRelayMdnsHostname(
    preservingInstallation && existing.mdns_hostname
      ? existing.mdns_hostname
      : defaultRelayMdnsHostname(primaryInstitution.code),
  );
  const mdnsEnabled = existing.mdns_enabled !== false;
  const file: RelayConfigFile = {
    ...existing,
    version: Math.max(4, Number(existing.version || 0)),
    institution_code: primaryInstitution.code,
    institution_name: primaryInstitution.name,
    institutions,
    database_path: databasePath,
    host: configuredHost,
    port: configuredPort,
    token: masterToken,
    allowed_origins: Array.isArray(existing.allowed_origins) && existing.allowed_origins.length
      ? existing.allowed_origins
      : [...DEFAULT_RELAY_ALLOWED_ORIGINS],
    mdns_enabled: mdnsEnabled,
    mdns_hostname: configuredMdnsHostname,
  };

  mkdirSync(dirname(databasePath), { recursive: true });
  writeConfigAtomically(configPath, file);

  return {
    ok: true,
    config_path: configPath,
    database_path: databasePath,
    institution_code: institutionCode,
    institution_name: institutionName,
    mode: institutions.length > 1 ? "school_group" : "single_school",
    institutions: institutions.map(({ code, name }) => ({ code, name })),
    host: configuredHost,
    port: configuredPort,
    admin_url: `http://127.0.0.1:${configuredPort}`,
    lan_urls: relayLanUrls(configuredPort),
    lan_hostname: `${configuredMdnsHostname}.local`,
    lan_url: relayMdnsUrl(configuredMdnsHostname, configuredPort),
    mdns_enabled: mdnsEnabled,
    token: schoolToken,
    token_reused: Boolean(sameInstitution && existingSchoolToken && schoolToken === existingSchoolToken),
  };
}
