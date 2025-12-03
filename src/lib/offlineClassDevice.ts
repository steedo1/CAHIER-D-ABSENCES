"use client";

export type ClassDeviceSnapshot<TState = any> = {
  classId: string;
  updatedAt: string; // ISO
  state: TState;
};

const SNAPSHOT_PREFIX = "moncahier.classDevice.snapshot.";

/**
 * Sauvegarde un snapshot pour une classe.
 * - classId : identifiant de la classe (ex: "5e2" ou l'id Supabase)
 * - state : ton state principal de la page (tableau d'élèves, notes, etc.)
 */
export function saveClassDeviceSnapshot<TState = any>(
  classId: string,
  state: TState
) {
  if (typeof window === "undefined") return;

  const snapshot: ClassDeviceSnapshot<TState> = {
    classId,
    updatedAt: new Date().toISOString(),
    state,
  };

  try {
    localStorage.setItem(
      SNAPSHOT_PREFIX + classId,
      JSON.stringify(snapshot)
    );
  } catch (e) {
    console.warn("[offlineClassDevice] save error", e);
  }
}

/**
 * Charge le snapshot d'une classe si disponible.
 */
export function loadClassDeviceSnapshot<TState = any>(
  classId: string
): ClassDeviceSnapshot<TState> | null {
  if (typeof window === "undefined") return null;

  const raw = localStorage.getItem(SNAPSHOT_PREFIX + classId);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ClassDeviceSnapshot<TState>;
  } catch (e) {
    console.warn("[offlineClassDevice] load error", e);
    return null;
  }
}

/**
 * Supprime le snapshot (après sync réussie par exemple).
 */
export function clearClassDeviceSnapshot(classId: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SNAPSHOT_PREFIX + classId);
  } catch (e) {
    console.warn("[offlineClassDevice] clear error", e);
  }
}
