export type AttendanceZone = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_m: number;
  is_active?: boolean;
};

export type AttendancePresencePolicy = {
  enabled: boolean;
  teacher_accounts_only: boolean;
  allow_local_relay: boolean;
  allow_gps_fallback: boolean;
  relay_local_url?: string | null;
  relay_local_urls?: string[];
  relay_access_token?: string | null;
  max_gps_accuracy_m: number;
  gps_grace_m: number;
  zones: AttendanceZone[];
};

export type GpsPresenceEvidence = {
  method: "gps";
  position: {
    latitude: number;
    longitude: number;
    accuracy: number;
    captured_at: string;
  };
};

export type RelayPresenceEvidence = {
  method: "local_relay";
  proof: string;
};

export type AttendancePresenceEvidence = GpsPresenceEvidence | RelayPresenceEvidence;

export function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const deltaLat = radians(latitudeB - latitudeA);
  const deltaLon = radians(longitudeB - longitudeA);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(latitudeA)) *
      Math.cos(radians(latitudeB)) *
      Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function checkGpsInsideZones(
  position: GpsPresenceEvidence["position"],
  policy: AttendancePresencePolicy,
) {
  if (!Number.isFinite(position.accuracy) || position.accuracy <= 0) {
    return { ok: false as const, code: "gps_accuracy_invalid", message: "Précision GPS invalide." };
  }
  if (position.accuracy > policy.max_gps_accuracy_m) {
    return {
      ok: false as const,
      code: "gps_accuracy_insufficient",
      message: `Signal GPS trop imprécis (±${Math.round(position.accuracy)} m). Rapprochez-vous d'une zone dégagée ou utilisez le réseau local de l'école.`,
    };
  }

  const zones = (policy.zones || []).filter((zone) => zone.is_active !== false);
  if (!zones.length) {
    return {
      ok: false as const,
      code: "attendance_zones_missing",
      message: "Aucune zone d'appel n'est encore configurée pour cet établissement.",
    };
  }

  const ranked = zones
    .map((zone) => ({
      zone,
      distance: distanceMeters(
        position.latitude,
        position.longitude,
        zone.latitude,
        zone.longitude,
      ),
    }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = ranked[0]!;
  const grace = Math.min(Math.max(0, policy.gps_grace_m), position.accuracy);
  const allowedDistance = nearest.zone.radius_m + grace;

  if (nearest.distance > allowedDistance) {
    return {
      ok: false as const,
      code: "attendance_outside_geofence",
      message: `Vous êtes hors du périmètre autorisé (${Math.round(nearest.distance)} m de ${nearest.zone.name}).`,
      distance_m: Math.round(nearest.distance),
      zone: nearest.zone,
    };
  }

  return {
    ok: true as const,
    distance_m: Math.round(nearest.distance),
    zone: nearest.zone,
  };
}

export async function getFreshGpsEvidence(
  maxAccuracyM: number,
  timeoutMs = 12_000,
): Promise<GpsPresenceEvidence> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new Error("La localisation GPS n'est pas disponible sur cet appareil.");
  }

  return await new Promise<GpsPresenceEvidence>((resolve, reject) => {
    let best: GeolocationPosition | null = null;
    let watchId: number | null = null;
    let settled = false;
    let timer = 0;

    const finish = (position?: GeolocationPosition) => {
      if (settled) return;
      settled = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      window.clearTimeout(timer);
      const selected = position || best;
      if (!selected) {
        reject(new Error("Impossible d'obtenir votre position. Activez la localisation puis réessayez."));
        return;
      }
      resolve({
        method: "gps",
        position: {
          latitude: selected.coords.latitude,
          longitude: selected.coords.longitude,
          accuracy: selected.coords.accuracy,
          captured_at: new Date(selected.timestamp || Date.now()).toISOString(),
        },
      });
    };

    timer = window.setTimeout(() => finish(), timeoutMs);
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!best || position.coords.accuracy < best.coords.accuracy) best = position;
        if (position.coords.accuracy <= maxAccuracyM) finish(position);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          if (!settled) {
            settled = true;
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            window.clearTimeout(timer);
            reject(new Error("Localisation refusée. Autorisez-la pour effectuer l'appel hors du réseau local de l'école."));
          }
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
    );
  });
}
