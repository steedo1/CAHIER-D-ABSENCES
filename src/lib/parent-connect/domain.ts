export const PARENT_CONNECT_READ_ROLES = ["super_admin", "founder", "admin", "finance_manager", "file_correspondent"] as const;
export const PARENT_CONNECT_WRITE_ROLES = ["super_admin", "founder", "admin", "finance_manager"] as const;
export const PARENT_CONNECT_SETTINGS_ROLES = ["super_admin"] as const;
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
    ? "Parent Connect a expiré. Renouvelez l’abonnement auprès de l’établissement."
    : "Ce matricule n’est pas activé pour Parent Connect. Contactez l’établissement pour activer l’abonnement.";
}

export function hasParentConnectRole(roles: Iterable<string>, allowed: readonly string[]) {
  return Array.from(roles).some((role) => allowed.includes(role));
}

/** The stored boundary is midnight after the last school day (exclusive). */
export function parentConnectEndLabel(endsAt: string | null | undefined) {
  return endsAt ? new Date(Date.parse(endsAt) - 1).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "—";
}
