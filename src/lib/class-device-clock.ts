export type ClassDeviceClockSource =
  | "relay_live"
  | "relay_estimate"
  | "cloud_live"
  | "cloud_estimate"
  | "local_untrusted";

export type LiveRelayClockReference = {
  authority: "relay" | "cloud";
  relay_epoch_ms: number;
  received_wall_ms: number;
  received_monotonic_ms: number;
};

type ClockSample = {
  wallNowMs?: number;
  monotonicNowMs?: number;
};

function finite(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function captureLiveAuthoritativeClock(
  authority: "relay" | "cloud",
  relayTime: string | null | undefined,
  sample: ClockSample = {},
): LiveRelayClockReference | null {
  const relayEpochMs = Date.parse(String(relayTime || ""));
  if (!Number.isFinite(relayEpochMs)) return null;
  const wallNowMs = finite(sample.wallNowMs, Date.now());
  const monotonicNowMs = finite(
    sample.monotonicNowMs,
    typeof performance === "undefined" ? 0 : performance.now(),
  );
  return {
    authority,
    relay_epoch_ms: relayEpochMs,
    received_wall_ms: wallNowMs,
    received_monotonic_ms: monotonicNowMs,
  };
}

export function captureLiveRelayClock(
  relayTime: string | null | undefined,
  sample: ClockSample = {},
) {
  return captureLiveAuthoritativeClock("relay", relayTime, sample);
}

export function captureLiveCloudClock(
  cloudTime: string | null | undefined,
  sample: ClockSample = {},
) {
  return captureLiveAuthoritativeClock("cloud", cloudTime, sample);
}

export function estimateClassDeviceNow(
  reference: LiveRelayClockReference | null | undefined,
  sample: ClockSample = {},
) {
  const wallNowMs = finite(sample.wallNowMs, Date.now());
  const monotonicNowMs = finite(
    sample.monotonicNowMs,
    typeof performance === "undefined" ? 0 : performance.now(),
  );
  if (!reference) {
    return {
      now: new Date(wallNowMs),
      source: "local_untrusted" as const,
      reference_age_ms: null,
    };
  }

  const elapsedMonotonicMs = Math.max(
    0,
    monotonicNowMs - reference.received_monotonic_ms,
  );
  const wallAgeMs = Math.max(0, wallNowMs - reference.received_wall_ms);
  const referenceAgeMs = Math.max(elapsedMonotonicMs, wallAgeMs);
  return {
    now: new Date(reference.relay_epoch_ms + elapsedMonotonicMs),
    source: `${reference.authority}_${
      referenceAgeMs <= 15_000 ? "live" : "estimate"
    }` as Exclude<ClassDeviceClockSource, "local_untrusted">,
    reference_age_ms: referenceAgeMs,
  };
}
