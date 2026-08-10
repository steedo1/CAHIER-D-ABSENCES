"use client";

import {
  OFFLINE_ACCESS_COOKIE,
  OFFLINE_DEVICE_COOKIE,
  OFFLINE_PBKDF2_ITERATIONS,
  OFFLINE_ROLE_DESTINATIONS,
  decodeBase64Url,
  decodeOfflineAccessGrant,
  deriveOfflinePasswordVerifier,
  encodeBase64Url,
  equalOfflineSecret,
  type OfflineAccessGrantPayload,
} from "@/lib/offline-auth-contract";
import { assertOfflineFunctionPrepared } from "@/lib/offline-auth-readiness";

const DB_NAME = "moncahier_offline_auth_v1";
const DB_VERSION = 1;
const STORE_NAME = "grants";
const DEVICE_ID_KEY = "mc:offline-auth:device-id:v1";
const ACTIVE_SESSION_KEY = "mc:offline-auth:active:v1";
const OFFLINE_LOGOUT_LOCK_KEY = "mc:offline-auth:logout-lock:v1";
export const OFFLINE_AUTH_STATE_EVENT = "moncahier:offline-auth-state";

type LoginMode = "email" | "phone";

type OfflineCredentialRecord = {
  login_hash: string;
  version: 1;
  grant_token: string;
  payload: OfflineAccessGrantPayload;
  salt: string;
  verifier: string;
  iterations: number;
  enabled: boolean;
  prepared_at: string;
};

type ActiveSession = {
  login_hash: string;
  grant_token: string;
  expires_at: number;
};

function browser() {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function requestPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("offline_auth_db_error"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("offline_auth_db_error"));
    transaction.onabort = () => reject(transaction.error || new Error("offline_auth_db_aborted"));
  });
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (!browser()) return Promise.reject(new Error("offline_auth_browser_required"));
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "login_hash" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error || new Error("offline_auth_db_open_failed"));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("offline_auth_db_upgrade_blocked"));
    };
  });
  return databasePromise;
}

async function getRecord(loginHash: string) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const record = await requestPromise<OfflineCredentialRecord | undefined>(
    transaction.objectStore(STORE_NAME).get(loginHash),
  );
  await transactionDone(transaction);
  return record || null;
}

async function putRecord(record: OfflineCredentialRecord) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(record);
  await transactionDone(transaction);
}

function normalizeLogin(mode: LoginMode, identifier: string) {
  const value = identifier.trim();
  if (!value) throw new Error("offline_login_required");
  return mode === "email"
    ? `email:${value.toLocaleLowerCase("fr")}`
    : `phone:${value.replace(/\D/g, "")}`;
}

async function digestText(value: string) {
  const encoded = new TextEncoder().encode(value);
  const owned = new Uint8Array(encoded.byteLength);
  owned.set(encoded);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    owned.buffer,
  );
  return encodeBase64Url(new Uint8Array(digest));
}

export function getOrCreateOfflineDeviceId() {
  if (typeof window === "undefined") throw new Error("offline_auth_browser_required");
  const existing = window.localStorage.getItem(DEVICE_ID_KEY) || "";
  if (/^[A-Za-z0-9:_-]{16,128}$/.test(existing)) return existing;
  const created = `device_${crypto.randomUUID()}`;
  window.localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

async function loginHash(mode: LoginMode, identifier: string) {
  return await digestText(normalizeLogin(mode, identifier));
}

export async function provisionOfflineAccess(input: {
  mode: LoginMode;
  identifier: string;
  password: string;
  grantToken: string;
}) {
  const payload = decodeOfflineAccessGrant(input.grantToken);
  const deviceId = getOrCreateOfflineDeviceId();
  if (
    !payload ||
    payload.device_id !== deviceId ||
    payload.expires_at <= Date.now() ||
    payload.account_active !== true
  ) {
    throw new Error("offline_grant_invalid");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const verifier = await deriveOfflinePasswordVerifier(
    input.password,
    salt,
    OFFLINE_PBKDF2_ITERATIONS,
  );
  const hash = await loginHash(input.mode, input.identifier);
  await putRecord({
    login_hash: hash,
    version: 1,
    grant_token: input.grantToken,
    payload,
    salt: encodeBase64Url(salt),
    verifier: encodeBase64Url(verifier),
    iterations: OFFLINE_PBKDF2_ITERATIONS,
    enabled: true,
    prepared_at: new Date().toISOString(),
  });
  return payload;
}

export async function disableOfflineAccessForIdentifier(input: {
  mode: LoginMode;
  identifier: string;
}) {
  const hash = await loginHash(input.mode, input.identifier);
  const record = await getRecord(hash);
  if (record) await putRecord({ ...record, enabled: false });
}

export async function authenticateOfflineAccess(input: {
  mode: LoginMode;
  identifier: string;
  password: string;
}) {
  const hash = await loginHash(input.mode, input.identifier);
  const record = await getRecord(hash);
  if (!record) throw new Error("offline_access_not_prepared");
  if (!record.enabled) throw new Error("offline_access_disabled");
  const payload = decodeOfflineAccessGrant(record.grant_token);
  if (
    !payload ||
    payload.account_active !== true ||
    payload.expires_at <= Date.now() ||
    payload.device_id !== getOrCreateOfflineDeviceId()
  ) {
    throw new Error("offline_access_expired");
  }
  const actual = await deriveOfflinePasswordVerifier(
    input.password,
    decodeBase64Url(record.salt),
    record.iterations,
  );
  if (!equalOfflineSecret(actual, decodeBase64Url(record.verifier))) {
    throw new Error("offline_credentials_invalid");
  }
  // Import statique volontaire : la vérification locale doit déjà appartenir
  // au bundle de connexion et ne jamais réclamer un chunk au moment précis
  // où Internet est indisponible.
  await assertOfflineFunctionPrepared(payload);
  return { loginHash: hash, grantToken: record.grant_token, payload };
}

function setPathCookie(name: string, value: string, path: string, maxAge: number) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${value}; Path=${path}; Max-Age=${Math.max(
    0,
    Math.floor(maxAge),
  )}; SameSite=Strict${secure}`;
}

export function activateOfflineAccess(input: {
  loginHash: string;
  grantToken: string;
  payload: OfflineAccessGrantPayload;
}) {
  const maxAge = Math.floor((input.payload.expires_at - Date.now()) / 1_000);
  if (maxAge <= 0) throw new Error("offline_access_expired");
  setPathCookie(
    OFFLINE_ACCESS_COOKIE,
    input.grantToken,
    input.payload.destination,
    maxAge,
  );
  setPathCookie(
    OFFLINE_DEVICE_COOKIE,
    input.payload.device_id,
    input.payload.destination,
    maxAge,
  );
  const active: ActiveSession = {
    login_hash: input.loginHash,
    grant_token: input.grantToken,
    expires_at: input.payload.expires_at,
  };
  window.sessionStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(active));
}

function readCookie(name: string) {
  const prefix = `${name}=`;
  const item = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

async function readActiveOfflineAccess(requirePathCookies: boolean) {
  if (!browser()) return null;
  try {
    const active = JSON.parse(
      window.sessionStorage.getItem(ACTIVE_SESSION_KEY) || "null",
    ) as ActiveSession | null;
    if (!active || active.expires_at <= Date.now()) return null;
    const record = await getRecord(active.login_hash);
    if (
      !record ||
      !record.enabled ||
      record.grant_token !== active.grant_token ||
      (requirePathCookies &&
        readCookie(OFFLINE_ACCESS_COOKIE) !== active.grant_token) ||
      (requirePathCookies &&
        readCookie(OFFLINE_DEVICE_COOKIE) !== record.payload.device_id) ||
      record.payload.device_id !== getOrCreateOfflineDeviceId() ||
      record.payload.expires_at <= Date.now()
    ) {
      return null;
    }
    return { grantToken: record.grant_token, payload: record.payload };
  } catch {
    return null;
  }
}


export function setOfflineLogoutLock(destination: string) {
  if (!browser()) return;
  const normalized = String(destination || "").trim();
  if (!normalized.startsWith("/")) return;
  window.sessionStorage.setItem(OFFLINE_LOGOUT_LOCK_KEY, normalized);
  window.dispatchEvent(new Event(OFFLINE_AUTH_STATE_EVENT));
}

export function getOfflineLogoutLock() {
  if (!browser()) return null;
  const value = String(
    window.sessionStorage.getItem(OFFLINE_LOGOUT_LOCK_KEY) || "",
  ).trim();
  return value.startsWith("/") ? value : null;
}

export function clearOfflineLogoutLock() {
  if (!browser()) return;
  window.sessionStorage.removeItem(OFFLINE_LOGOUT_LOCK_KEY);
  window.dispatchEvent(new Event(OFFLINE_AUTH_STATE_EVENT));
}

export async function getActiveOfflineAccess() {
  return await readActiveOfflineAccess(true);
}

export async function getOfflineAccessIntent() {
  return await readActiveOfflineAccess(false);
}

export async function clearActiveOfflineAccess() {
  if (!browser()) return;

  // La session active est éphémère. Le grant PBKDF2/IndexedDB reste intact afin
  // qu'un appareil déjà autorisé puisse se reconnecter sans Internet.
  let decodedDestination: string | null = null;
  try {
    const active = JSON.parse(
      window.sessionStorage.getItem(ACTIVE_SESSION_KEY) || "null",
    ) as ActiveSession | null;
    decodedDestination = active?.grant_token
      ? decodeOfflineAccessGrant(active.grant_token)?.destination || null
      : null;
  } catch {
    decodedDestination = null;
  } finally {
    window.sessionStorage.removeItem(ACTIVE_SESSION_KEY);
  }

  // Effacer toutes les variantes de chemin connues rend la déconnexion robuste
  // même si IndexedDB est momentanément indisponible ou si le grant a expiré.
  const paths = new Set<string>([
    "/",
    ...Object.values(OFFLINE_ROLE_DESTINATIONS),
  ]);
  if (decodedDestination) paths.add(decodedDestination);
  for (const path of paths) {
    setPathCookie(OFFLINE_ACCESS_COOKIE, "", path, 0);
    setPathCookie(OFFLINE_DEVICE_COOKIE, "", path, 0);
  }
}
