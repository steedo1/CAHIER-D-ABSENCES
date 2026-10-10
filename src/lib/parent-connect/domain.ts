export const PARENT_CONNECT_PRICE = 2000;
export const PARENT_CONNECT_SCHOOL_SHARE = 500;
export const PARENT_CONNECT_NEXA_SHARE = 1500;
export const PARENT_CONNECT_READ_ROLES = ["super_admin", "founder", "admin", "finance_manager", "file_correspondent"] as const;
export const PARENT_CONNECT_WRITE_ROLES = ["super_admin", "founder", "admin", "finance_manager"] as const;
export const PARENT_CONNECT_SETTINGS_ROLES = ["super_admin", "founder", "admin"] as const;
export const PAYMENT_METHODS = ["cash", "wave", "orange_money", "mtn_money", "bank_transfer"] as const;
export type ParentConnectStatus = {
  status: "legacy" | "inactive" | "active" | "expired";
  allowed: boolean;
  ends_at: string | null;
};

export function parentConnectStatus(enforced: boolean, endsAt?: string | null, now = Date.now()): ParentConnectStatus {
  const expiry = endsAt ? Date.parse(endsAt) : NaN;
  const active = Number.isFinite(expiry) && expiry > now;
  return {
    status: !enforced ? "legacy" : active ? "active" : endsAt ? "expired" : "inactive",
    allowed: !enforced || active,
    ends_at: endsAt || null,
  };
}

export function parentConnectMessage(status: ParentConnectStatus) {
  return status.status === "expired"
    ? "Parent Connect a expiré. Renouvelez l’abonnement de 2 000 FCFA auprès de l’établissement."
    : "Ce matricule n’est pas activé pour Parent Connect. Réglez l’abonnement de 2 000 FCFA auprès de l’établissement.";
}

export function hasParentConnectRole(roles: Iterable<string>, allowed: readonly string[]) {
  return Array.from(roles).some((role) => allowed.includes(role));
}
