import { randomBytes } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
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
            ? { code: institutionCode, name: institutionName, admin_token: schoolToken }
            : item
        )
      : [{ code: institutionCode, name: institutionName, admin_token: schoolToken }];
  const primaryInstitution = institutions[0] || {
    code: institutionCode,
    name: institutionName,
    admin_token: schoolToken,
  };

  const file: RelayConfigFile = {
    version: 2,
    institution_code: primaryInstitution.code,
    institution_name: primaryInstitution.name,
    institutions,
    database_path: databasePath,
    host: "0.0.0.0",
    port: 4317,
    token: masterToken,
    allowed_origins: [...DEFAULT_RELAY_ALLOWED_ORIGINS],
  };

  mkdirSync(dirname(configPath), { recursive: true });
  mkdirSync(dirname(databasePath), { recursive: true });
  const temporaryPath = `${configPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, configPath);

  return {
    ok: true,
    config_path: configPath,
    database_path: databasePath,
    institution_code: institutionCode,
    institution_name: institutionName,
    mode: institutions.length > 1 ? "school_group" : "single_school",
    institutions: institutions.map(({ code, name }) => ({ code, name })),
    host: "0.0.0.0",
    port: 4317,
    admin_url: "http://127.0.0.1:4317",
    lan_urls: relayLanUrls(4317),
    token: schoolToken,
    token_reused: Boolean(sameInstitution && existingSchoolToken && schoolToken === existingSchoolToken),
  };
}
