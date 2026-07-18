import {
  SYNC_ENTITY_TYPES,
  SYNC_PROTOCOL_VERSION,
  type RemoteEvent,
  type SyncAction,
  type SyncEntityType,
  type SyncOperation,
} from "./types.mjs";

const entityTypes = new Set<string>(SYNC_ENTITY_TYPES);

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}_must_be_object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${label}_required`);
  return normalized;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`${label}_must_be_non_negative_integer`);
  }
  return Number(value);
}

function iso(value: unknown, label: string): string {
  const normalized = text(value, label);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${label}_must_be_iso_date`);
  return normalized;
}

function entityType(value: unknown): SyncEntityType {
  const normalized = text(value, "entity_type");
  if (!entityTypes.has(normalized)) throw new Error("entity_type_not_supported");
  return normalized as SyncEntityType;
}

function action(value: unknown): SyncAction {
  if (value !== "upsert" && value !== "delete") throw new Error("action_not_supported");
  return value;
}

function payload(value: unknown, selectedAction: SyncAction) {
  if (selectedAction === "delete") return null;
  return object(value, "payload");
}

function protocolVersion(value: unknown) {
  if (value !== SYNC_PROTOCOL_VERSION) throw new Error("protocol_version_not_supported");
  return SYNC_PROTOCOL_VERSION;
}

export function parseSyncOperation(value: unknown): SyncOperation {
  const row = object(value, "operation");
  const selectedAction = action(row.action);
  const actor = row.actor_profile_id;
  return {
    protocol_version: protocolVersion(row.protocol_version),
    operation_id: text(row.operation_id, "operation_id"),
    institution_id: text(row.institution_id, "institution_id"),
    device_id: text(row.device_id, "device_id"),
    ...(actor === undefined
      ? {}
      : { actor_profile_id: actor === null ? null : text(actor, "actor_profile_id") }),
    entity_type: entityType(row.entity_type),
    entity_id: text(row.entity_id, "entity_id"),
    action: selectedAction,
    base_server_version: nonNegativeInteger(row.base_server_version, "base_server_version"),
    occurred_at: iso(row.occurred_at, "occurred_at"),
    payload: payload(row.payload, selectedAction),
  };
}

export function parseRemoteEvent(value: unknown): RemoteEvent {
  const row = object(value, "event");
  const selectedAction = action(row.action);
  const causedBy = row.caused_by_operation_id;
  return {
    protocol_version: protocolVersion(row.protocol_version),
    event_id: text(row.event_id, "event_id"),
    ...(causedBy === undefined
      ? {}
      : {
          caused_by_operation_id:
            causedBy === null ? null : text(causedBy, "caused_by_operation_id"),
        }),
    institution_id: text(row.institution_id, "institution_id"),
    entity_type: entityType(row.entity_type),
    entity_id: text(row.entity_id, "entity_id"),
    action: selectedAction,
    server_version: nonNegativeInteger(row.server_version, "server_version"),
    occurred_at: iso(row.occurred_at, "occurred_at"),
    payload: payload(row.payload, selectedAction),
  };
}
