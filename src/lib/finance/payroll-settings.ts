import type { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { settingsWithPermanentCycle, type PermanentCycle } from "./payroll-permanents";

type AdminClient = ReturnType<typeof getSupabaseServiceClient>;

export async function readPayrollSettings(admin: AdminClient, institutionId: string) {
  const { data, error } = await admin.from("institutions").select("settings_json")
    .eq("id", institutionId).single();
  if (error) throw new Error(error.message);
  return data.settings_json;
}

// Retain other institution settings and avoid overwriting a concurrent edit.
// This uses existing settings storage and needs no schema migration.
export async function savePermanentCycle(admin: AdminClient, institutionId: string, teacherId: string, cycle: PermanentCycle | null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = await readPayrollSettings(admin, institutionId);
    let query = admin.from("institutions")
      .update({ settings_json: settingsWithPermanentCycle(previous, teacherId, cycle) })
      .eq("id", institutionId);
    query = previous == null
      ? query.is("settings_json", null)
      : query.eq("settings_json", JSON.stringify(previous));
    const { data, error } = await query.select("id");
    if (error) throw new Error(error.message);
    if (data?.length) return;
  }
  throw new Error("Les paramètres ont été modifiés simultanément. Réessayez l’enregistrement.");
}
