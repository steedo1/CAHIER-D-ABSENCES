import { loadRelayConfig } from "./config.mjs";
import { openRelayDatabase } from "./db.mjs";
import { createRelayCloudSyncAgent, requeueTimetableReplacementChain, syncRelayOnce } from "./cloud-sync.mjs";
import { createRelayServer } from "./server.mjs";
import { configureCloudSync, configureRelay, relayLanUrls } from "./setup.mjs";
import {
  defaultRelayMdnsHostname,
  relayMdnsUrl,
  startRelayMdns,
  type RelayMdnsAnnouncer,
} from "./mdns.mjs";
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
  const mdnsHostname = config.mdnsHostname || defaultRelayMdnsHostname(config.institutionCode);
  const mdnsEnabled = config.mdnsEnabled !== false;
  const mdnsUrl = config.mdnsUrl || relayMdnsUrl(mdnsHostname, config.port);

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
      lan_url: mdnsUrl,
      lan_hostname: `${mdnsHostname}.local`,
      mdns_enabled: mdnsEnabled,
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
      lan_url: mdnsUrl,
      lan_hostname: `${mdnsHostname}.local`,
      mdns_enabled: mdnsEnabled,
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
        pull_endpoint: institution.cloud_sync?.pull_endpoint || null,
        pull_configured: Boolean(institution.cloud_sync?.pull_endpoint),
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

  if (command === "sync-requeue-timetable-replacement") {
    const result = requeueTimetableReplacementChain(db, {
      institutionCode: flag("--institution-code"),
      rootOperationId: flag("--root-operation-id"),
      expectedError: flagOptional("--expected-error") || "timetable_not_found",
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    db.close();
    return;
  }

  if (command === "serve") {
    const server = createRelayServer(config, store);
    const cloudSyncAgent = createRelayCloudSyncAgent(config, store);
    let mdnsAnnouncer: RelayMdnsAnnouncer | null = null;
    let closing = false;

    const shutdown = (exitCode: 0 | 1, error?: unknown) => {
      if (closing) return;
      closing = true;
      if (error !== undefined) {
        console.error(error instanceof Error ? error.message : error);
      }
      const serverStopped = new Promise<void>((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
      void (async () => {
        await Promise.all([
          cloudSyncAgent.stop(),
          mdnsAnnouncer?.stop().catch(() => undefined),
          serverStopped,
        ]);
        db.close();
        if (exitCode === 0) {
          process.exit(0);
          return;
        }
        process.exitCode = 1;
      })();
    };
    server.once("error", (error) => {
      shutdown(1, error);
    });
    server.listen(config.port, config.host, () => {
      if (closing) return;
      console.log(`Mon Cahier Relay écoute sur http://${config.host}:${config.port}`);
      cloudSyncAgent.start();
      if (mdnsEnabled) {
        void startRelayMdns({
          hostname: mdnsHostname,
          port: config.port,
          institutionCode: config.institutionCode,
          log: (message) => console.warn(message),
        }).then((announcer) => {
          if (closing) {
            void announcer.stop();
            return;
          }
          mdnsAnnouncer = announcer;
          const status = announcer.status();
          console.log(`Relais LAN stable annoncé sur ${status.url}`);
        }).catch((error) => {
          console.warn(
            `Annonce mDNS indisponible : ${error instanceof Error ? error.message : error}`,
          );
        });
      }
    });
    const close = () => {
      shutdown(0);
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    return;
  }

  db.close();
  throw new Error(
    "Commande attendue: configure, sync-configure, sync-once, sync-requeue-timetable-replacement, access, init, status, doctor ou serve",
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
