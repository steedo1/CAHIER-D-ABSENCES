import { loadRelayConfig } from "./config.mjs";
import { openRelayDatabase } from "./db.mjs";
import { createRelayServer } from "./server.mjs";
import { RelayStore } from "./store.mjs";

async function main() {
  const config = loadRelayConfig();
  const command = process.argv[2] || "status";
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

  if (command === "serve") {
    const server = createRelayServer(config, store);
    server.listen(config.port, config.host, () => {
      console.log(`Mon Cahier Relay écoute sur http://${config.host}:${config.port}`);
    });
    const close = () => {
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
  throw new Error("Commande attendue: init, status ou serve");
}

function flag(name: string) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name.slice(2)}_required`);
  return value;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
