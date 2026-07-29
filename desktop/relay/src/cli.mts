import { loadRelayConfig } from "./config.mjs";
import { openRelayDatabase } from "./db.mjs";
import { createRelayCloudSyncAgent, syncRelayOnce } from "./cloud-sync.mjs";
import { createRelayServer } from "./server.mjs";
import { configureCloudSync, configureRelay, relayLanUrls } from "./setup.mjs";
import { RelayStore } from "./store.mjs";

async function main() {
  const command = process.argv[2] || "status";

  if (command === "configure") {
    const configPath = flagOptional("--config");
    const databasePath = flagOptional("--database");
    const result = configureRelay({
      institutionCode: flag("--institution-code"),
      institutionName: flag("--institution-name"),
      ...(configPath ? { configPath } : {}),
      ...(databasePath ? { databasePath } : {}),
      rotateToken: process.argv.includes("--rotate-token"),
      addInstitution: process.argv.includes("--add-institution"),
    });
    const db = openRelayDatabase(result.database_path);
    db.close();
    console.log(JSON.stringify(result, null, 2));
    return;
  }


  if (command === "sync-configure") {
    const configPath = flagOptional("--config");
    const result = configureCloudSync({
      institutionCode: flag("--institution-code"),
      endpoint: flag("--endpoint"),
      deviceId: flag("--device-id"),
      token: flag("--token"),
      enabled: !process.argv.includes("--disabled"),
      ...(configPath ? { configPath } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const config = loadRelayConfig();

  if (command === "access") {
    const institutionCode = String(flagOptional("--institution-code") || "").trim().toUpperCase();
    const institutions = config.institutions || [];
    if (!institutionCode && institutions.length > 1) {
      throw new Error("institution_code_required_for_school_group");
    }
    const selectedInstitution = institutionCode
      ? institutions.find((item) => item.code === institutionCode)
      : institutions[0];
    if (institutionCode && !selectedInstitution) throw new Error("institution_not_configured");
    const accessToken = String(selectedInstitution?.admin_token || config.token || "").trim();
    if (!accessToken) throw new Error("relay_admin_token_missing");
    if (process.argv.includes("--token-only")) {
      console.log(accessToken);
      return;
    }
    console.log(JSON.stringify({
      admin_url: `http://127.0.0.1:${config.port}`,
      lan_urls: relayLanUrls(config.port),
      institution: selectedInstitution
        ? { code: selectedInstitution.code, name: selectedInstitution.name }
        : null,
      institutions: institutions.map(({ code, name }) => ({ code, name })),
      token: accessToken,
    }, null, 2));
    return;
  }

  const db = openRelayDatabase(config.databasePath);
  const store = new RelayStore(db);

  if (command === "init") {
    const institutionId = flag("--institution-id");
    const institutionName = flag("--institution-name");
    store.ensureInstitution(institutionId, institutionName);
    const deviceId = store.getOrCreateRelayDevice(institutionId);
    console.log(JSON.stringify({ ok: true, institution_id: institutionId, device_id: deviceId }, null, 2));
    db.close();
    return;
  }

  if (command === "status") {
    console.log(JSON.stringify(store.status(), null, 2));
    db.close();
    return;
  }

  if (command === "doctor") {
    const serviceReachable = await relayIsReachable(config.port);
    console.log(JSON.stringify({
      ok: true,
      service_reachable: serviceReachable,
      mode: (config.institutions?.length || 0) > 1 ? "school_group" : "single_school",
      institutions: (config.institutions || []).map(({ code, name }) => ({ code, name })),
      config_path: config.configPath || null,
      database_path: config.databasePath,
      admin_url: `http://127.0.0.1:${config.port}`,
      lan_urls: relayLanUrls(config.port),
      cloud_sync: (config.institutions || []).map((institution) => ({
        institution_code: institution.code,
        enabled: institution.cloud_sync?.enabled === true,
        configured: Boolean(
          institution.cloud_sync?.endpoint &&
          institution.cloud_sync?.device_id &&
          institution.cloud_sync?.token,
        ),
        endpoint: institution.cloud_sync?.endpoint || null,
        device_id: institution.cloud_sync?.device_id || null,
      })),
      status: store.status(),
    }, null, 2));
    db.close();
    return;
  }

  if (command === "sync-once") {
    console.log(JSON.stringify(await syncRelayOnce(config, store), null, 2));
    db.close();
    return;
  }

  if (command === "serve") {
    const server = createRelayServer(config, store);
    const cloudSyncAgent = createRelayCloudSyncAgent(config, store);
    server.once("error", (error) => {
      cloudSyncAgent.stop();
      console.error(error instanceof Error ? error.message : error);
      db.close();
      process.exitCode = 1;
    });
    server.listen(config.port, config.host, () => {
      console.log(`Mon Cahier Relay écoute sur http://${config.host}:${config.port}`);
      cloudSyncAgent.start();
    });
    const close = () => {
      cloudSyncAgent.stop();
      server.close(() => {
        db.close();
        process.exit(0);
      });
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    return;
  }

  db.close();
  throw new Error(
    "Commande attendue: configure, sync-configure, sync-once, access, init, status, doctor ou serve",
  );
}

async function relayIsReachable(port: number) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return false;
    const body = await response.json() as { ok?: unknown };
    return body.ok === true;
  } catch {
    return false;
  }
}

function flag(name: string) {
  const value = flagOptional(name);
  if (!value || value.startsWith("--")) throw new Error(`${name.slice(2)}_required`);
  return value;
}

function flagOptional(name: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
