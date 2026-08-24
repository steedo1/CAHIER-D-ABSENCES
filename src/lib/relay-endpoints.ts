export const RELAY_ENDPOINTS_HEADER = "x-moncahier-relay-endpoints";
export const MAX_RELAY_ENDPOINTS = 8;

function privateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [first, second] = parts as [number, number, number, number];
  return (
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

export function normalizeRelayEndpoint(
  value: unknown,
  options: { requireLocal?: boolean } = {},
) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 500) return null;
  try {
    const parsed = new URL(raw);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (
      options.requireLocal === true &&
      !hostname.endsWith(".local") &&
      !privateIpv4(hostname)
    ) {
      return null;
    }
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function normalizeRelayEndpointList(
  values: unknown,
  options: { requireLocal?: boolean } = {},
) {
  const source = Array.isArray(values) ? values : [];
  const unique: string[] = [];
  for (const value of source) {
    const normalized = normalizeRelayEndpoint(value, options);
    if (normalized && !unique.includes(normalized)) unique.push(normalized);
    if (unique.length >= MAX_RELAY_ENDPOINTS) break;
  }
  return unique;
}

export function relayEndpointCandidates(input: {
  configuredUrl?: unknown;
  observedUrls?: unknown;
}) {
  const observed = normalizeRelayEndpointList(input.observedUrls, {
    requireLocal: true,
  });
  const configured = normalizeRelayEndpoint(input.configuredUrl, {
    requireLocal: true,
  });
  const mdns = observed.filter((url) => {
    try {
      return new URL(url).hostname.toLowerCase().endsWith(".local");
    } catch {
      return false;
    }
  });
  const direct = observed.filter((url) => !mdns.includes(url));
  return Array.from(
    new Set([...mdns, ...direct, ...(configured ? [configured] : [])]),
  ).slice(0, MAX_RELAY_ENDPOINTS);
}

export function parseReportedRelayEndpoints(headerValue: unknown) {
  const raw = String(headerValue || "").trim();
  if (!raw || raw.length > 2_048) return [];
  try {
    return normalizeRelayEndpointList(JSON.parse(raw), { requireLocal: true });
  } catch {
    return [];
  }
}
