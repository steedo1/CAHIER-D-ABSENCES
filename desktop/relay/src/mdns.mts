import { createSocket, type RemoteInfo, type Socket } from "node:dgram";
import { isIPv4 } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

export const RELAY_MDNS_PORT = 5353;
export const RELAY_MDNS_IPV4_GROUP = "224.0.0.251";
export const RELAY_MDNS_SERVICE_TYPE = "_moncahier._tcp.local.";
const DNS_SD_META_SERVICE = "_services._dns-sd._udp.local.";
const DEFAULT_HOST_TTL_SECONDS = 120;
const DEFAULT_SERVICE_TTL_SECONDS = 4_500;

export type RelayMdnsQuestion = {
  name: string;
  type: number;
  class: number;
  unicastResponse: boolean;
};

export type RelayMdnsRuntimeStatus = {
  enabled: true;
  hostname: string;
  fqdn: string;
  url: string;
  service_type: string;
  addresses: string[];
  multicast_address: string;
  multicast_port: number;
};

export type RelayMdnsAnnouncer = {
  status(): RelayMdnsRuntimeStatus;
  stop(): Promise<void>;
};

type NetworkInterfaces = ReturnType<typeof networkInterfaces>;

type RelayMdnsResponseInput = {
  hostname: string;
  port: number;
  addresses: string[];
  institutionCode?: string | null | undefined;
  hostTtlSeconds?: number;
  serviceTtlSeconds?: number;
  includeHost?: boolean;
  includeService?: boolean;
};

function normalizeDnsName(value: string) {
  const trimmed = String(value || "").trim().toLowerCase();
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

function safeAsciiLabel(value: string, fallback: string) {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 63);
  return normalized || fallback;
}

export function normalizeRelayMdnsHostname(value: string) {
  const withoutLocal = String(value || "")
    .trim()
    .replace(/\.local\.?$/i, "");
  return safeAsciiLabel(withoutLocal, "moncahier-relay");
}

export function defaultRelayMdnsHostname(institutionCode?: string | null) {
  const institution = safeAsciiLabel(String(institutionCode || ""), "");
  return normalizeRelayMdnsHostname(
    institution ? `moncahier-relay-${institution}` : "moncahier-relay",
  );
}

export function relayMdnsFqdn(hostname: string) {
  return `${normalizeRelayMdnsHostname(hostname)}.local.`;
}

export function relayMdnsUrl(hostname: string, port: number) {
  return `http://${normalizeRelayMdnsHostname(hostname)}.local:${port}`;
}

function isPrivateIpv4(address: string) {
  return (
    address.startsWith("10.") ||
    address.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(address)
  );
}

export function relayMdnsIpv4Addresses(
  interfaces: NetworkInterfaces = networkInterfaces(),
) {
  const preferred: string[] = [];
  const fallback: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (
        entry.family !== "IPv4" ||
        entry.internal ||
        !isIPv4(entry.address) ||
        entry.address.startsWith("169.254.")
      ) {
        continue;
      }
      fallback.push(entry.address);
      if (isPrivateIpv4(entry.address)) preferred.push(entry.address);
    }
  }
  return Array.from(new Set(preferred.length ? preferred : fallback)).sort();
}

function encodeDnsName(name: string) {
  const normalized = normalizeDnsName(name);
  const labels = normalized.slice(0, -1).split(".");
  const buffers: Buffer[] = [];
  for (const label of labels) {
    const encoded = Buffer.from(label, "utf8");
    if (encoded.length < 1 || encoded.length > 63) {
      throw new Error("relay_mdns_label_invalid");
    }
    buffers.push(Buffer.from([encoded.length]), encoded);
  }
  buffers.push(Buffer.from([0]));
  return Buffer.concat(buffers);
}

function decodeDnsName(packet: Buffer, initialOffset: number) {
  const labels: string[] = [];
  let offset = initialOffset;
  let nextOffset = initialOffset;
  let jumped = false;
  const visited = new Set<number>();

  while (offset < packet.length) {
    if (visited.has(offset)) throw new Error("relay_mdns_pointer_loop");
    visited.add(offset);
    const length = packet[offset];
    if (length === undefined) throw new Error("relay_mdns_name_truncated");
    if (length === 0) {
      if (!jumped) nextOffset = offset + 1;
      return { name: `${labels.join(".").toLowerCase()}.`, nextOffset };
    }
    if ((length & 0xc0) === 0xc0) {
      const second = packet[offset + 1];
      if (second === undefined) throw new Error("relay_mdns_pointer_truncated");
      const pointer = ((length & 0x3f) << 8) | second;
      if (!jumped) nextOffset = offset + 2;
      jumped = true;
      offset = pointer;
      continue;
    }
    if ((length & 0xc0) !== 0) throw new Error("relay_mdns_label_invalid");
    const start = offset + 1;
    const end = start + length;
    if (end > packet.length) throw new Error("relay_mdns_name_truncated");
    labels.push(packet.subarray(start, end).toString("utf8"));
    offset = end;
    if (!jumped) nextOffset = offset;
  }
  throw new Error("relay_mdns_name_truncated");
}

export function parseRelayMdnsQuestions(packet: Buffer): RelayMdnsQuestion[] {
  if (packet.length < 12) return [];
  const questionCount = packet.readUInt16BE(4);
  let offset = 12;
  const questions: RelayMdnsQuestion[] = [];
  try {
    for (let index = 0; index < questionCount; index += 1) {
      const decoded = decodeDnsName(packet, offset);
      offset = decoded.nextOffset;
      if (offset + 4 > packet.length) return [];
      const type = packet.readUInt16BE(offset);
      const rawClass = packet.readUInt16BE(offset + 2);
      offset += 4;
      questions.push({
        name: decoded.name,
        type,
        class: rawClass & 0x7fff,
        unicastResponse: (rawClass & 0x8000) !== 0,
      });
    }
  } catch {
    return [];
  }
  return questions;
}

function encodeIpv4(address: string) {
  if (!isIPv4(address)) throw new Error("relay_mdns_ipv4_invalid");
  return Buffer.from(address.split(".").map((part) => Number(part)));
}

function encodeTxt(entries: string[]) {
  const chunks = entries.map((entry) => {
    const encoded = Buffer.from(entry, "utf8");
    if (encoded.length > 255) throw new Error("relay_mdns_txt_entry_too_long");
    return Buffer.concat([Buffer.from([encoded.length]), encoded]);
  });
  return Buffer.concat(chunks);
}

function encodeResourceRecord(input: {
  name: string;
  type: number;
  ttlSeconds: number;
  data: Buffer;
  flushCache?: boolean;
}) {
  const header = Buffer.alloc(10);
  header.writeUInt16BE(input.type, 0);
  header.writeUInt16BE(1 | (input.flushCache ? 0x8000 : 0), 2);
  header.writeUInt32BE(Math.max(0, input.ttlSeconds), 4);
  header.writeUInt16BE(input.data.length, 8);
  return Buffer.concat([encodeDnsName(input.name), header, input.data]);
}

function serviceInstanceName(institutionCode?: string | null) {
  const suffix = String(institutionCode || "").trim().toUpperCase();
  const label = `Mon Cahier Relay${suffix ? ` ${suffix}` : ""}`.slice(0, 63);
  return `${label}.${RELAY_MDNS_SERVICE_TYPE}`;
}

export function buildRelayMdnsResponse(input: RelayMdnsResponseInput) {
  const hostname = normalizeRelayMdnsHostname(input.hostname);
  const fqdn = relayMdnsFqdn(hostname);
  const addresses = Array.from(new Set(input.addresses.filter(isIPv4))).sort();
  const hostTtl = input.hostTtlSeconds ?? DEFAULT_HOST_TTL_SECONDS;
  const serviceTtl = input.serviceTtlSeconds ?? DEFAULT_SERVICE_TTL_SECONDS;
  const includeHost = input.includeHost !== false;
  const includeService = input.includeService !== false;
  const records: Buffer[] = [];

  if (includeHost) {
    for (const address of addresses) {
      records.push(
        encodeResourceRecord({
          name: fqdn,
          type: 1,
          ttlSeconds: hostTtl,
          data: encodeIpv4(address),
          flushCache: true,
        }),
      );
    }
  }

  if (includeService) {
    const instance = serviceInstanceName(input.institutionCode);
    records.push(
      encodeResourceRecord({
        name: DNS_SD_META_SERVICE,
        type: 12,
        ttlSeconds: serviceTtl,
        data: encodeDnsName(RELAY_MDNS_SERVICE_TYPE),
      }),
      encodeResourceRecord({
        name: RELAY_MDNS_SERVICE_TYPE,
        type: 12,
        ttlSeconds: serviceTtl,
        data: encodeDnsName(instance),
      }),
    );

    const srvPrefix = Buffer.alloc(6);
    srvPrefix.writeUInt16BE(0, 0);
    srvPrefix.writeUInt16BE(0, 2);
    srvPrefix.writeUInt16BE(input.port, 4);
    records.push(
      encodeResourceRecord({
        name: instance,
        type: 33,
        ttlSeconds: serviceTtl,
        data: Buffer.concat([srvPrefix, encodeDnsName(fqdn)]),
        flushCache: true,
      }),
      encodeResourceRecord({
        name: instance,
        type: 16,
        ttlSeconds: serviceTtl,
        data: encodeTxt([
          "app=moncahier",
          "protocol=1",
          ...(input.institutionCode
            ? [`institution=${String(input.institutionCode).trim().toUpperCase()}`]
            : []),
        ]),
        flushCache: true,
      }),
    );
  }

  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(0, 4);
  header.writeUInt16BE(records.length, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  return Buffer.concat([header, ...records]);
}

function questionMatchesHost(question: RelayMdnsQuestion, fqdn: string) {
  return (
    question.class === 1 &&
    question.name === normalizeDnsName(fqdn) &&
    (question.type === 1 || question.type === 255)
  );
}

function questionMatchesService(
  question: RelayMdnsQuestion,
  institutionCode?: string | null,
) {
  if (question.class !== 1) return false;
  const name = question.name;
  const instance = normalizeDnsName(serviceInstanceName(institutionCode));
  return (
    (name === RELAY_MDNS_SERVICE_TYPE && (question.type === 12 || question.type === 255)) ||
    (name === DNS_SD_META_SERVICE && (question.type === 12 || question.type === 255)) ||
    (name === instance && [16, 33, 255].includes(question.type))
  );
}

function sendPacket(
  socket: Socket,
  packet: Buffer,
  target: { address: string; port: number },
) {
  return new Promise<void>((resolve) => {
    socket.send(packet, target.port, target.address, () => resolve());
  });
}

export async function startRelayMdns(input: {
  hostname: string;
  port: number;
  institutionCode?: string | null | undefined;
  refreshIntervalMs?: number;
  log?: (message: string) => void;
}): Promise<RelayMdnsAnnouncer> {
  const hostname = normalizeRelayMdnsHostname(input.hostname);
  const fqdn = relayMdnsFqdn(hostname);
  const log = input.log || (() => undefined);
  const socket = createSocket({ type: "udp4", reuseAddr: true });
  let stopped = false;
  let addresses = relayMdnsIpv4Addresses();
  let joinedAddresses = new Set<string>();
  let refreshTimer: NodeJS.Timeout | null = null;
  let announceTimer: NodeJS.Timeout | null = null;

  const runtimeStatus = (): RelayMdnsRuntimeStatus => ({
    enabled: true,
    hostname,
    fqdn,
    url: relayMdnsUrl(hostname, input.port),
    service_type: RELAY_MDNS_SERVICE_TYPE,
    addresses: [...addresses],
    multicast_address: RELAY_MDNS_IPV4_GROUP,
    multicast_port: RELAY_MDNS_PORT,
  });

  const joinCurrentInterfaces = () => {
    const current = relayMdnsIpv4Addresses();
    for (const oldAddress of joinedAddresses) {
      if (current.includes(oldAddress)) continue;
      try {
        socket.dropMembership(RELAY_MDNS_IPV4_GROUP, oldAddress);
      } catch {
        // Une interface déjà disparue n'empêche pas la nouvelle annonce.
      }
      joinedAddresses.delete(oldAddress);
    }
    for (const address of current) {
      if (joinedAddresses.has(address)) continue;
      try {
        socket.addMembership(RELAY_MDNS_IPV4_GROUP, address);
        joinedAddresses.add(address);
      } catch {
        // Certains adaptateurs virtuels Windows refusent l'adhésion multicast.
      }
    }
    if (joinedAddresses.size === 0) {
      try {
        socket.addMembership(RELAY_MDNS_IPV4_GROUP);
      } catch {
        // Le relais HTTP reste fonctionnel même si mDNS est indisponible.
      }
    }
    addresses = current;
  };

  const multicast = async (packet: Buffer) => {
    if (stopped) return;
    let sent = false;
    for (const interfaceAddress of addresses) {
      try {
        socket.setMulticastInterface(interfaceAddress);
        await sendPacket(socket, packet, {
          address: RELAY_MDNS_IPV4_GROUP,
          port: RELAY_MDNS_PORT,
        });
        sent = true;
      } catch {
        // Un adaptateur virtuel peut refuser l'émission multicast.
      }
    }
    if (!sent) {
      await sendPacket(socket, packet, {
        address: RELAY_MDNS_IPV4_GROUP,
        port: RELAY_MDNS_PORT,
      });
    }
  };

  const announce = async (ttlSeconds = DEFAULT_HOST_TTL_SECONDS) => {
    const packet = buildRelayMdnsResponse({
      hostname,
      port: input.port,
      addresses,
      institutionCode: input.institutionCode,
      hostTtlSeconds: ttlSeconds,
      serviceTtlSeconds: ttlSeconds === 0 ? 0 : DEFAULT_SERVICE_TTL_SECONDS,
    });
    await multicast(packet);
  };

  socket.on("message", (packet, rinfo: RemoteInfo) => {
    const questions = parseRelayMdnsQuestions(packet);
    const hostMatch = questions.some((question) => questionMatchesHost(question, fqdn));
    const serviceMatch = questions.some((question) =>
      questionMatchesService(question, input.institutionCode),
    );
    if (!hostMatch && !serviceMatch) return;

    addresses = relayMdnsIpv4Addresses();
    const response = buildRelayMdnsResponse({
      hostname,
      port: input.port,
      addresses,
      institutionCode: input.institutionCode,
      includeHost: true,
      includeService: serviceMatch,
    });
    const wantsUnicast =
      rinfo.port !== RELAY_MDNS_PORT ||
      questions.some((question) => question.unicastResponse);
    if (wantsUnicast) {
      void sendPacket(socket, response, { address: rinfo.address, port: rinfo.port });
    } else {
      void multicast(response);
    }
  });

  socket.on("error", (error) => {
    log(`mDNS: ${error.message}`);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      socket.off("error", onError);
      resolve();
    };
    socket.once("error", onError);
    socket.once("listening", onListening);
    socket.bind(RELAY_MDNS_PORT, "0.0.0.0");
  });

  socket.setMulticastTTL(255);
  socket.setMulticastLoopback(false);
  joinCurrentInterfaces();
  await announce();
  announceTimer = setTimeout(() => void announce(), 1_000);
  announceTimer.unref();

  const refreshIntervalMs = Math.max(10_000, input.refreshIntervalMs ?? 30_000);
  refreshTimer = setInterval(() => {
    const previous = addresses;
    joinCurrentInterfaces();
    const changed =
      previous.length !== addresses.length ||
      previous.some((address, index) => address !== addresses[index]);
    if (changed) {
      const goodbye = buildRelayMdnsResponse({
        hostname,
        port: input.port,
        addresses: previous,
        institutionCode: input.institutionCode,
        hostTtlSeconds: 0,
        serviceTtlSeconds: 0,
      });
      void multicast(goodbye).then(() => announce());
      log(`mDNS: adresse LAN actualisée (${addresses.join(", ") || "aucune"}).`);
    }
  }, refreshIntervalMs);
  refreshTimer.unref();

  return {
    status: runtimeStatus,
    async stop() {
      if (stopped) return;
      if (refreshTimer) clearInterval(refreshTimer);
      if (announceTimer) clearTimeout(announceTimer);
      try {
        const goodbye = buildRelayMdnsResponse({
          hostname,
          port: input.port,
          addresses,
          institutionCode: input.institutionCode,
          hostTtlSeconds: 0,
          serviceTtlSeconds: 0,
        });
        await multicast(goodbye);
      } catch {
        // Arrêt best-effort.
      }
      stopped = true;
      await new Promise<void>((resolve) => socket.close(() => resolve()));
    },
  };
}
