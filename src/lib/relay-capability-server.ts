import type { SupabaseClient } from "@supabase/supabase-js";

type RelayDeviceCapabilityRow = {
  is_active?: boolean | null;
  revoked_at?: string | null;
  last_seen_at?: string | null;
};

/**
 * Source de vérité Relais : un établissement n'est activé qu'après le premier
 * contact Cloud d'un appareil provisionné, encore actif et non révoqué.
 */
export function relayEnabledFromDeviceRows(
  rows: RelayDeviceCapabilityRow[] | null | undefined,
) {
  return (rows || []).some(
    (row) =>
      row.is_active === true &&
      !String(row.revoked_at || "").trim() &&
      Boolean(String(row.last_seen_at || "").trim()),
  );
}

export async function relayEnabledForInstitutionServer(
  service: SupabaseClient<any>,
  institutionId: string | null | undefined,
) {
  const normalizedInstitutionId = String(institutionId || "").trim();
  if (!normalizedInstitutionId) return false;

  try {
    const { data, error } = await service
      .from("relay_sync_devices")
      .select("is_active,revoked_at,last_seen_at")
      .eq("institution_id", normalizedInstitutionId)
      .eq("is_active", true)
      .is("revoked_at", null)
      .not("last_seen_at", "is", null)
      .limit(1);

    if (error) return false;
    return relayEnabledFromDeviceRows(data as RelayDeviceCapabilityRow[] | null);
  } catch {
    // Une erreur Cloud ne doit jamais activer implicitement le Relais.
    return false;
  }
}
