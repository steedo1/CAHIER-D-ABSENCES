import { resolve } from "node:path";

export type RelayConfig = {
  databasePath: string;
  host: string;
  port: number;
  token: string | null;
};

function positivePort(value: string | undefined) {
  const parsed = Number(value || "4317");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("MONCAHIER_RELAY_PORT_invalid");
  }
  return parsed;
}

export function isLoopbackHost(host: string) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function loadRelayConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const dataDir = resolve(env.MONCAHIER_RELAY_DATA_DIR || "data");
  const host = String(env.MONCAHIER_RELAY_HOST || "127.0.0.1").trim();
  const token = String(env.MONCAHIER_RELAY_TOKEN || "").trim() || null;
  if (!isLoopbackHost(host) && !token) {
    throw new Error("MONCAHIER_RELAY_TOKEN_required_for_lan");
  }
  return {
    databasePath: resolve(env.MONCAHIER_RELAY_DB || resolve(dataDir, "moncahier-relay.db")),
    host,
    port: positivePort(env.MONCAHIER_RELAY_PORT),
    token,
  };
}
