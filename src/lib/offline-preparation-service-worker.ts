"use client";

import { MON_CAHIER_SW_URL } from "@/lib/offline";

export const OFFLINE_PREPARATION_WORKER_TIMEOUT_MS = 15_000;
export const OFFLINE_PREPARATION_SHELL_TIMEOUT_MS = 30_000;

type Timer = ReturnType<typeof globalThis.setTimeout>;

function browser() {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

function abortError(signal?: AbortSignal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Opération hors ligne annulée.", "AbortError");
}

function withDeadlineSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeout: Timer = globalThis.setTimeout(
    () =>
      controller.abort(
        new Error("Le service hors ligne a dépassé son délai maximal."),
      ),
    Math.max(1, timeoutMs),
  );
  const abort = () => controller.abort(abortError(parent));
  if (parent?.aborted) abort();
  else parent?.addEventListener("abort", abort, { once: true });

  return {
    signal: controller.signal,
    dispose() {
      globalThis.clearTimeout(timeout);
      parent?.removeEventListener("abort", abort);
    },
  };
}

async function bounded<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  timeoutMs = OFFLINE_PREPARATION_WORKER_TIMEOUT_MS,
): Promise<T> {
  const deadline = withDeadlineSignal(signal, timeoutMs);
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        deadline.signal.addEventListener(
          "abort",
          () => reject(abortError(deadline.signal)),
          { once: true },
        );
      }),
    ]);
  } finally {
    deadline.dispose();
  }
}

async function registerPreparationWorker(signal?: AbortSignal) {
  if (!browser() || !("serviceWorker" in navigator)) return null;
  const registration = await bounded(
    navigator.serviceWorker.register(MON_CAHIER_SW_URL, { scope: "/" }),
    signal,
  );
  await bounded(navigator.serviceWorker.ready, signal);
  return registration;
}

async function waitForPreparationWorker(
  registration: ServiceWorkerRegistration,
  signal?: AbortSignal,
) {
  const expectedScriptUrl = new URL(MON_CAHIER_SW_URL, window.location.href).href;
  const expected = (worker: ServiceWorker | null) =>
    Boolean(worker && worker.scriptURL === expectedScriptUrl);
  const find = () =>
    [registration.installing, registration.waiting, registration.active].find(
      (worker): worker is ServiceWorker => expected(worker),
    ) || null;

  let worker = find();
  if (!worker) {
    await bounded(registration.update(), signal);
    worker = find();
  }
  if (!worker) return null;
  if (worker.state === "installed" || worker.state === "activated") return worker;

  await bounded(
    new Promise<void>((resolve, reject) => {
      const check = () => {
        if (worker?.state === "installed" || worker?.state === "activated") {
          worker?.removeEventListener("statechange", check);
          resolve();
        } else if (worker?.state === "redundant") {
          worker.removeEventListener("statechange", check);
          reject(new Error("Le service hors ligne n’a pas pu être activé."));
        }
      };
      worker?.addEventListener("statechange", check);
      check();
    }),
    signal,
  );

  return expected(worker) ? worker : null;
}

export async function getPreparationWorkerRelease(
  signal?: AbortSignal,
): Promise<string | null> {
  if (!browser() || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await registerPreparationWorker(signal);
    if (!registration) return null;
    const worker = await waitForPreparationWorker(registration, signal);
    if (!worker) return null;

    return await bounded(
      new Promise<string | null>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
          channel.port1.close();
          resolve(
            event.data?.ok === true && typeof event.data?.release === "string"
              ? event.data.release
              : null,
          );
        };
        worker.postMessage({ type: "MON_CAHIER_GET_RELEASE" }, [channel.port2]);
      }),
      signal,
      3_000,
    );
  } catch {
    return null;
  }
}

function operationId() {
  return globalThis.crypto?.randomUUID?.() ||
    `offline-shell-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function warmAttendanceOfflineShell(
  urls: string[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  if (!browser()) return;
  if (!("serviceWorker" in navigator)) {
    throw new Error("Le mode hors ligne n’est pas pris en charge par ce navigateur.");
  }

  const registration = await registerPreparationWorker(options.signal);
  if (!registration) {
    throw new Error("Le service hors ligne n’a pas pu être enregistré.");
  }
  const worker = await waitForPreparationWorker(registration, options.signal);
  if (!worker) throw new Error("Le service hors ligne n’est pas encore actif.");

  const normalized = Array.from(
    new Set(
      urls
        .map((url) => String(url || "").trim())
        .filter((url) => url.startsWith("/")),
    ),
  );
  if (!normalized.length) return;

  const id = operationId();
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const deadline = withDeadlineSignal(
      options.signal,
      options.timeoutMs ?? OFFLINE_PREPARATION_SHELL_TIMEOUT_MS,
    );
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      deadline.dispose();
      channel.port1.close();
      callback();
    };

    deadline.signal.addEventListener(
      "abort",
      () => {
        worker.postMessage({
          type: "MON_CAHIER_CANCEL_WARM_SHELL",
          operationId: id,
        });
        finish(() => reject(abortError(deadline.signal)));
      },
      { once: true },
    );

    channel.port1.onmessage = (event) => {
      if (event.data?.ok === true) finish(resolve);
      else {
        finish(() =>
          reject(
            new Error(
              String(
                event.data?.error ||
                  "La préparation de l’application est impossible.",
              ),
            ),
          ),
        );
      }
    };

    worker.postMessage(
      {
        type: "MON_CAHIER_WARM_SHELL",
        urls: normalized,
        operationId: id,
      },
      [channel.port2],
    );
  });
}
