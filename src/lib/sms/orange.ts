// src/lib/sms/orange.ts

type OrangeTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type OrangeApiErrorShape = {
  error?: string;
  error_description?: string;
  message?: string;
};

export type OrangeSmsSendInput = {
  to: string;
  message: string;
  senderAddress?: string;
};

export type OrangeSmsSendResult = {
  ok: true;
  provider: "orange_ci";
  to: string;
  senderAddress: string;
  resourceURL: string | null;
  resourceId: string | null;
  response: unknown;
};

const ORANGE_OAUTH_URL =
  process.env.ORANGE_OAUTH_URL?.trim() ||
  "https://api.orange.com/oauth/v3/token";

const ORANGE_SMS_BASE_URL =
  process.env.ORANGE_SMS_BASE_URL?.trim() ||
  "https://api.orange.com";

const DEFAULT_SENDER =
  process.env.ORANGE_SMS_SENDER?.trim() ||
  "tel:+2250000";

/**
 * Petit cache mémoire process-local.
 * Suffisant pour éviter de demander un token à chaque SMS.
 */
let cachedToken: {
  accessToken: string;
  expiresAtMs: number;
} | null = null;

function ensureServerSide() {
  if (typeof window !== "undefined") {
    throw new Error("orange.ts doit être utilisé uniquement côté serveur.");
  }
}

function short(value: string | null | undefined, keep = 10) {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= keep) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function hasAuthHeaderEnv() {
  return !!process.env.ORANGE_AUTH_HEADER?.trim();
}

function hasClientIdEnv() {
  return !!process.env.ORANGE_CLIENT_ID?.trim();
}

function hasClientSecretEnv() {
  return !!process.env.ORANGE_CLIENT_SECRET?.trim();
}

function getAuthHeader(): string {
  const fromHeader = process.env.ORANGE_AUTH_HEADER?.trim();
  if (fromHeader) return fromHeader;

  const clientId = process.env.ORANGE_CLIENT_ID?.trim();
  const clientSecret = process.env.ORANGE_CLIENT_SECRET?.trim();

  if (clientId && clientSecret) {
    const raw = `${clientId}:${clientSecret}`;
    const encoded = Buffer.from(raw, "utf8").toString("base64");
    return `Basic ${encoded}`;
  }

  throw new Error(
    "Configuration Orange manquante: définir ORANGE_AUTH_HEADER ou ORANGE_CLIENT_ID + ORANGE_CLIENT_SECRET."
  );
}

function normalizePhoneToE164(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) {
    throw new Error("Numéro destinataire vide.");
  }

  if (/^\+[1-9]\d{7,14}$/.test(value)) {
    return value;
  }

  const digits = value.replace(/\D/g, "");
  if (!digits) {
    throw new Error(`Numéro invalide: "${raw}"`);
  }

  if (digits.startsWith("00")) {
    const candidate = `+${digits.slice(2)}`;
    if (/^\+[1-9]\d{7,14}$/.test(candidate)) return candidate;
  }

  if (digits.startsWith("225") && digits.length >= 11) {
    const candidate = `+${digits}`;
    if (/^\+[1-9]\d{7,14}$/.test(candidate)) return candidate;
  }

  if (digits.length === 10) {
    return `+225${digits}`;
  }

  throw new Error(`Impossible de normaliser le numéro "${raw}" au format E.164.`);
}

function toOrangeTelAddress(input: string): string {
  const s = String(input || "").trim();

  if (s.startsWith("tel:+")) {
    return s;
  }

  if (s.startsWith("+")) {
    return `tel:${s}`;
  }

  return `tel:${normalizePhoneToE164(s)}`;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractResourceURL(parsed: any): string | null {
  const outbound =
    parsed?.outboundSMSMessageRequest ??
    parsed ??
    null;

  return typeof outbound?.resourceURL === "string"
    ? outbound.resourceURL
    : null;
}

function extractResourceId(resourceURL: string | null): string | null {
  if (!resourceURL) return null;
  const marker = "/requests/";
  const idx = resourceURL.lastIndexOf(marker);
  if (idx < 0) return null;
  const id = resourceURL.slice(idx + marker.length).trim();
  return id || null;
}

async function readErrorPayload(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) {
    return `${response.status} ${response.statusText}`;
  }

  const parsed = safeJsonParse(text) as OrangeApiErrorShape | string;
  if (typeof parsed === "string") {
    return `${response.status} ${response.statusText} - ${parsed}`;
  }

  const detail =
    parsed.error_description ||
    parsed.message ||
    parsed.error ||
    text;

  return `${response.status} ${response.statusText} - ${detail}`;
}

/**
 * Récupère un access token OAuth Orange.
 * Utilise un cache mémoire jusqu'à un peu avant l'expiration.
 */
export async function getOrangeAccessToken(forceRefresh = false): Promise<string> {
  ensureServerSide();

  const now = Date.now();

  if (
    !forceRefresh &&
    cachedToken &&
    cachedToken.accessToken &&
    now < cachedToken.expiresAtMs
  ) {
    console.info("[sms/orange] oauth_cache_hit", {
      forceRefresh,
      expiresInMs: cachedToken.expiresAtMs - now,
    });
    return cachedToken.accessToken;
  }

  const authHeader = getAuthHeader();

  console.info("[sms/orange] oauth_start", {
    oauthUrl: ORANGE_OAUTH_URL,
    forceRefresh,
    authMode: hasAuthHeaderEnv() ? "auth_header" : "client_credentials",
    hasAuthHeaderEnv: hasAuthHeaderEnv(),
    hasClientIdEnv: hasClientIdEnv(),
    hasClientSecretEnv: hasClientSecretEnv(),
  });

  const response = await fetch(ORANGE_OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!response.ok) {
    const err = await readErrorPayload(response);
    console.error("[sms/orange] oauth_fail", {
      oauthUrl: ORANGE_OAUTH_URL,
      status: response.status,
      statusText: response.statusText,
      error: err,
      authMode: hasAuthHeaderEnv() ? "auth_header" : "client_credentials",
    });
    throw new Error(`Orange OAuth échoué: ${err}`);
  }

  const data = (await response.json()) as OrangeTokenResponse;

  if (!data?.access_token) {
    console.error("[sms/orange] oauth_missing_token", {
      oauthUrl: ORANGE_OAUTH_URL,
      payloadKeys: Object.keys(data || {}),
    });
    throw new Error("Orange OAuth: access_token absent.");
  }

  const expiresInSec = Number(data.expires_in || 3600);
  const safetyWindowMs = 60_000;
  const expiresAtMs = now + Math.max(30, expiresInSec) * 1000 - safetyWindowMs;

  cachedToken = {
    accessToken: data.access_token,
    expiresAtMs,
  };

  console.info("[sms/orange] oauth_ok", {
    oauthUrl: ORANGE_OAUTH_URL,
    tokenType: data.token_type || "unknown",
    expiresInSec,
  });

  return data.access_token;
}

/**
 * Envoie un SMS via Orange CI.
 */
export async function sendOrangeSms(
  input: OrangeSmsSendInput
): Promise<OrangeSmsSendResult> {
  ensureServerSide();

  const message = String(input.message || "").trim();
  if (!message) {
    throw new Error("Message SMS vide.");
  }

  const senderAddress = toOrangeTelAddress(
    input.senderAddress?.trim() || DEFAULT_SENDER
  );
  const to = toOrangeTelAddress(input.to);

  const encodedSender = encodeURIComponent(senderAddress);
  const url = `${ORANGE_SMS_BASE_URL}/smsmessaging/v1/outbound/${encodedSender}/requests`;

  console.info("[sms/orange] send_start", {
    smsBaseUrl: ORANGE_SMS_BASE_URL,
    url,
    to: short(to, 18),
    senderAddress,
    messageLength: message.length,
    usedDefaultSender:
      !input.senderAddress?.trim() &&
      senderAddress === toOrangeTelAddress(DEFAULT_SENDER),
    hasConfiguredSender: !!process.env.ORANGE_SMS_SENDER?.trim(),
  });

  let accessToken = await getOrangeAccessToken(false);

  const payload = {
    outboundSMSMessageRequest: {
      address: to,
      senderAddress,
      outboundSMSTextMessage: {
        message,
      },
    },
  };

  let response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (response.status === 401) {
    console.warn("[sms/orange] send_401_retry", {
      url,
      to: short(to, 18),
      senderAddress,
    });

    accessToken = await getOrangeAccessToken(true);

    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  }

  if (!response.ok) {
    const err = await readErrorPayload(response);
    console.error("[sms/orange] send_fail", {
      url,
      to: short(to, 18),
      senderAddress,
      status: response.status,
      statusText: response.statusText,
      error: err,
    });
    throw new Error(
      `Envoi SMS Orange échoué vers ${short(to, 18)}: ${err}`
    );
  }

  const text = await response.text().catch(() => "");
  const parsed = text ? safeJsonParse(text) : null;

  const resourceURL = extractResourceURL(parsed);
  const resourceId = extractResourceId(resourceURL);

  console.info("[sms/orange] send_ok", {
    url,
    to: short(to, 18),
    senderAddress,
    resourceURL,
    resourceId,
  });

  return {
    ok: true,
    provider: "orange_ci",
    to,
    senderAddress,
    resourceURL,
    resourceId,
    response: parsed,
  };
}

/**
 * Permet juste de vérifier rapidement si la config Orange est présente.
 */
export function isOrangeSmsConfigured(): boolean {
  try {
    ensureServerSide();
    void getAuthHeader();
    return true;
  } catch {
    return false;
  }
}

/**
 * Vide le cache mémoire du token.
 * Pratique en debug/tests.
 */
export function clearOrangeAccessTokenCache() {
  cachedToken = null;
}