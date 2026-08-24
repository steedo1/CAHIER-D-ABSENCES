import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadRelayConfig } from "../src/config.mjs";
import { configureRelay, relayLanUrls } from "../src/setup.mjs";
import {
  buildRelayMdnsResponse,
  defaultRelayMdnsHostname,
  normalizeRelayMdnsHostname,
  parseRelayMdnsQuestions,
  relayMdnsFqdn,
  relayMdnsIpv4Addresses,
  relayMdnsUrl,
  RELAY_MDNS_SERVICE_TYPE,
} from "../src/mdns.mjs";

function encodeName(name: string) {
  const labels = name.replace(/\.$/, "").split(".");
  return Buffer.concat([
    ...labels.flatMap((label) => {
      const value = Buffer.from(label, "utf8");
      return [Buffer.from([value.length]), value];
    }),
    Buffer.from([0]),
  ]);
}

function query(name: string, type = 1, unicastResponse = false) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(1 | (unicastResponse ? 0x8000 : 0), 2);
  return Buffer.concat([header, encodeName(name), tail]);
}

test("le relais construit un nom .local stable à partir du code établissement", () => {
  assert.equal(defaultRelayMdnsHostname("LMA-000101"), "moncahier-relay-lma-000101");
  assert.equal(
    normalizeRelayMdnsHostname("MonCahier Relay LMA-000101.local."),
    "moncahier-relay-lma-000101",
  );
  assert.equal(
    relayMdnsFqdn("moncahier-relay-lma-000101"),
    "moncahier-relay-lma-000101.local.",
  );
  assert.equal(
    relayMdnsUrl("moncahier-relay-lma-000101", 4317),
    "http://moncahier-relay-lma-000101.local:4317",
  );
});

test("le parseur mDNS reconnaît une requête A .local et le bit réponse unicast", () => {
  const questions = parseRelayMdnsQuestions(
    query("moncahier-relay-lma-000101.local.", 1, true),
  );
  assert.deepEqual(questions, [
    {
      name: "moncahier-relay-lma-000101.local.",
      type: 1,
      class: 1,
      unicastResponse: true,
    },
  ]);
});

test("l'annonce mDNS contient l'adresse IPv4 actuelle et le service Mon Cahier", () => {
  const packet = buildRelayMdnsResponse({
    hostname: "moncahier-relay-lma-000101",
    port: 4317,
    addresses: ["192.168.3.246"],
    institutionCode: "LMA-000101",
  });
  assert.equal(packet.readUInt16BE(2), 0x8400);
  assert.equal(packet.readUInt16BE(6), 5);
  assert.notEqual(packet.indexOf(Buffer.from([192, 168, 3, 246])), -1);
  assert.notEqual(packet.indexOf(Buffer.from("moncahier-relay-lma-000101", "utf8")), -1);
  assert.notEqual(packet.indexOf(Buffer.from("_moncahier", "utf8")), -1);
  assert.notEqual(packet.indexOf(Buffer.from("institution=LMA-000101", "utf8")), -1);
  assert.equal(RELAY_MDNS_SERVICE_TYPE, "_moncahier._tcp.local.");
});

test("la sélection d'adresse préfère le LAN privé et ignore loopback/APIPA", () => {
  const interfaces = {
    Ethernet: [
      {
        address: "192.168.1.25",
        netmask: "255.255.255.0",
        family: "IPv4" as const,
        mac: "00:00:00:00:00:01",
        internal: false,
        cidr: "192.168.1.25/24",
      },
    ],
    WiFi: [
      {
        address: "169.254.10.20",
        netmask: "255.255.0.0",
        family: "IPv4" as const,
        mac: "00:00:00:00:00:02",
        internal: false,
        cidr: "169.254.10.20/16",
      },
      {
        address: "10.20.30.40",
        netmask: "255.255.255.0",
        family: "IPv4" as const,
        mac: "00:00:00:00:00:03",
        internal: false,
        cidr: "10.20.30.40/24",
      },
    ],
    Loopback: [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4" as const,
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8",
      },
    ],
  };
  assert.deepEqual(relayMdnsIpv4Addresses(interfaces), ["10.20.30.40", "192.168.1.25"]);
});

test("les URL IPv4 LAN suivent le réseau courant sans conserver l'ancienne adresse DHCP", () => {
  const firstNetwork = {
    WiFi: [
      {
        address: "192.168.168.246",
        netmask: "255.255.255.0",
        family: "IPv4" as const,
        mac: "00:00:00:00:00:10",
        internal: false,
        cidr: "192.168.168.246/24",
      },
    ],
  };
  const secondNetwork = {
    WiFi: [
      {
        address: "192.168.206.246",
        netmask: "255.255.255.0",
        family: "IPv4" as const,
        mac: "00:00:00:00:00:10",
        internal: false,
        cidr: "192.168.206.246/24",
      },
    ],
  };

  assert.deepEqual(relayLanUrls(4317, firstNetwork), ["http://192.168.168.246:4317"]);
  assert.deepEqual(relayLanUrls(4317, secondNetwork), ["http://192.168.206.246:4317"]);
  assert.equal(
    relayLanUrls(4317, secondNetwork).includes("http://192.168.168.246:4317"),
    false,
  );
  assert.equal(
    relayMdnsUrl("moncahier-relay-lma-000101", 4317),
    "http://moncahier-relay-lma-000101.local:4317",
  );
});

test("la configuration persiste le hostname stable sans dépendre de l'IP DHCP", () => {
  const root = mkdtempSync(join(tmpdir(), "moncahier-mdns-config-"));
  const configPath = join(root, "config.json");
  try {
    const configured = configureRelay({
      institutionCode: "LMA-000101",
      institutionName: "COLLEGE NOTRE-DAME",
      configPath,
      env: {},
      platform: "linux",
    });
    assert.equal(configured.lan_hostname, "moncahier-relay-lma-000101.local");
    assert.equal(configured.lan_url, "http://moncahier-relay-lma-000101.local:4317");
    assert.equal(configured.mdns_enabled, true);

    const file = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    assert.equal(file.version, 4);
    assert.equal(file.mdns_enabled, true);
    assert.equal(file.mdns_hostname, "moncahier-relay-lma-000101");

    const loaded = loadRelayConfig({ MONCAHIER_RELAY_CONFIG: configPath });
    assert.equal(loaded.mdnsEnabled, true);
    assert.equal(loaded.mdnsHostname, "moncahier-relay-lma-000101");
    assert.equal(loaded.mdnsUrl, "http://moncahier-relay-lma-000101.local:4317");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("une installation existante v3 obtient mDNS sans reconfiguration ni changement de jeton", () => {
  const root = mkdtempSync(join(tmpdir(), "moncahier-mdns-legacy-"));
  const configPath = join(root, "config.json");
  try {
    const legacyToken = "x".repeat(43);
    const legacy = {
      version: 3,
      institution_code: "LMA-000101",
      institution_name: "COLLEGE NOTRE-DAME",
      institutions: [
        { code: "LMA-000101", name: "COLLEGE NOTRE-DAME", admin_token: legacyToken },
      ],
      host: "0.0.0.0",
      port: 4317,
      token: legacyToken,
      database_path: join(root, "relay.db"),
    };
    requireWrite(configPath, legacy);

    const loaded = loadRelayConfig({ MONCAHIER_RELAY_CONFIG: configPath });
    assert.equal(loaded.token, legacyToken);
    assert.equal(loaded.mdnsEnabled, true);
    assert.equal(loaded.mdnsHostname, "moncahier-relay-lma-000101");
    assert.equal(loaded.mdnsUrl, "http://moncahier-relay-lma-000101.local:4317");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function requireWrite(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
