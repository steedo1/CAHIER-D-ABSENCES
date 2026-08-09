const MAX_FUTURE_SKEW_MS = 5 * 60_000;
const MAX_OFFLINE_AGE_MS = 31 * 24 * 60 * 60_000;

export class CapturedAtDeviceError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Normalise le champ optionnel sans inventer une heure appareil pour les anciens clients. */
export function normalizeCapturedAtDevice(value: unknown) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new CapturedAtDeviceError("captured_at_device_invalid");
  }
  return parsed.toISOString();
}

/**
 * Les nouveaux clients conservent leur heure métier. Les anciens clients restent compatibles
 * et utilisent l'heure de réception du relais. La fenêtre de 31 jours couvre plusieurs jours
 * hors ligne sans permettre de rejouer arbitrairement un ancien planning.
 */
export function effectiveCapturedAtDevice(capturedAtDevice: string | null, receivedAt: Date) {
  if (!capturedAtDevice) return receivedAt;
  const captured = new Date(capturedAtDevice);
  if (captured.getTime() > receivedAt.getTime() + MAX_FUTURE_SKEW_MS) {
    throw new CapturedAtDeviceError("captured_at_device_in_future");
  }
  if (captured.getTime() < receivedAt.getTime() - MAX_OFFLINE_AGE_MS) {
    throw new CapturedAtDeviceError("captured_at_device_too_old");
  }
  return captured;
}
