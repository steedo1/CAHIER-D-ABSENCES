import type { SupabaseClient } from "@supabase/supabase-js";

/** Phones belong to child + school + current approved year, never to an app login. */
export async function parentConnectSmsContacts(srv: SupabaseClient, institutionId: string, studentIds: string[]) {
  const phones = new Map<string, string>();
  if (!studentIds.length) return phones;
  // Bound API payloads and avoid PostgREST's row limit; RPC returns a JSON aggregate.
  for (let offset = 0; offset < studentIds.length; offset += 200) {
    const { data, error } = await srv.rpc("parent_connect_sms_contacts", { p_institution_id: institutionId, p_student_ids: studentIds.slice(offset, offset + 200) });
    if (error) {
      if (["PGRST202", "42883"].includes(String(error.code))) return phones; // pre-migration compatibility
      throw new Error("Les numéros Parent Connect sont momentanément indisponibles.");
    }
    for (const row of data || []) if (row.student_id && row.phone_e164) phones.set(row.student_id, row.phone_e164);
  }
  return phones;
}
