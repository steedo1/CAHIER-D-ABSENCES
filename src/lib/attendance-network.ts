"use client";

/**
 * Budget réseau court réservé aux gestes interactifs d'appel.
 * Les files de rejeu de fond gardent volontairement des délais plus longs.
 */
export const ATTENDANCE_INTERACTIVE_NETWORK_TIMEOUT_MS = 1_800;

type ConnectionLike = {
  effectiveType?: string;
  rtt?: number;
  downlink?: number;
  saveData?: boolean;
};

export function attendanceConnectionConstrained() {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & {
    connection?: ConnectionLike;
    mozConnection?: ConnectionLike;
    webkitConnection?: ConnectionLike;
  }).connection ||
    (navigator as Navigator & { mozConnection?: ConnectionLike }).mozConnection ||
    (navigator as Navigator & { webkitConnection?: ConnectionLike }).webkitConnection;
  if (!connection) return false;

  const effectiveType = String(connection.effectiveType || "").toLowerCase();
  const rtt = Number(connection.rtt);
  const downlink = Number(connection.downlink);
  return connection.saveData === true ||
    effectiveType === "slow-2g" ||
    effectiveType === "2g" ||
    (Number.isFinite(rtt) && rtt >= 900) ||
    (Number.isFinite(downlink) && downlink > 0 && downlink <= 0.5);
}

export async function fetchAttendanceInteractive(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = ATTENDANCE_INTERACTIVE_NETWORK_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const external = init.signal;
  const abortFromExternal = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) abortFromExternal();
    else external.addEventListener("abort", abortFromExternal, { once: true });
  }
  const timeout = setTimeout(
    () => controller.abort(new DOMException("attendance_network_timeout", "TimeoutError")),
    Math.max(500, timeoutMs),
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    external?.removeEventListener("abort", abortFromExternal);
  }
}
