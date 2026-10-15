export type ClassDeviceSyncScope = {
  id: string;
  institution_id: string;
  actor_profile_id?: string | null;
};

type ScopedRecord = {
  class_id?: unknown;
  institution_id?: unknown;
  actor_profile_id?: unknown;
  meta?: Record<string, unknown>;
};

const text = (value: unknown) => String(value ?? "").trim();

/** Local scoping never grants server access. Unknown historical rows stay stored. */
export function classDeviceRecordInScope(
  record: ScopedRecord | null | undefined,
  scope: ClassDeviceSyncScope | null | undefined,
) {
  if (!record || !scope?.id || !scope.institution_id) return false;
  const classId = text(record.class_id || record.meta?.classId);
  const institutionId = text(record.institution_id || record.meta?.institutionId);
  const actorId = text(record.actor_profile_id || record.meta?.actorProfileId);
  return classId === scope.id &&
    (!institutionId || institutionId === scope.institution_id) &&
    (!actorId || !scope.actor_profile_id || actorId === scope.actor_profile_id);
}

export type ClassDeviceFriendlySyncState =
  | "ready" | "in_progress" | "saved_on_device" | "syncing"
  | "secured_on_relay" | "synced" | "needs_attention";

export function classDeviceFriendlySyncState(input: {
  online: boolean;
  syncing: boolean;
  total: number;
  blocked: number;
  localOpen?: { id?: string | null; session_state?: string | null; delivery_origin?: string | null } | null;
  completion?: { relay_state?: string | null } | null;
}): ClassDeviceFriendlySyncState {
  if (input.localOpen?.id && input.localOpen.session_state !== "closed") {
    return !input.online || input.localOpen.delivery_origin === "local_pending" ||
      input.localOpen.id.startsWith("client:") ? "saved_on_device" : "in_progress";
  }
  if (input.blocked > 0) return "needs_attention";
  const pending = input.total > 0 || input.completion?.relay_state === "device_pending";
  if (pending) return input.online && input.syncing ? "syncing" : "saved_on_device";
  if (input.completion?.relay_state === "cloud_confirmed") return "synced";
  if (input.completion?.relay_state === "relay_confirmed") return "secured_on_relay";
  return "ready";
}
