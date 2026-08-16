import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

type ServiceClient = ReturnType<typeof getSupabaseServiceClient>;

function isMissingRelationError(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes("school_group_institutions") &&
      (message.includes("does not exist") || message.includes("schema cache")))
  );
}

/**
 * Returns the institutions whose active teacher directory is shared with the
 * current institution. An institution outside a school group simply receives
 * its own id.
 *
 * The missing-table fallback makes the application safe to deploy before the
 * SQL migration is applied: existing single-school behaviour is preserved.
 */
export async function resolveTeacherPoolInstitutionIds(
  srv: ServiceClient,
  institutionId: string,
): Promise<string[]> {
  const currentId = String(institutionId || "").trim();
  if (!currentId) return [];

  const groupLink = await srv
    .from("school_group_institutions")
    .select("group_id")
    .eq("institution_id", currentId)
    .maybeSingle();

  if (groupLink.error) {
    if (isMissingRelationError(groupLink.error)) return [currentId];
    throw new Error(groupLink.error.message);
  }

  const groupId = String(groupLink.data?.group_id || "").trim();
  if (!groupId) return [currentId];

  const members = await srv
    .from("school_group_institutions")
    .select("institution_id")
    .eq("group_id", groupId);

  if (members.error) {
    if (isMissingRelationError(members.error)) return [currentId];
    throw new Error(members.error.message);
  }

  return Array.from(
    new Set([
      currentId,
      ...(members.data || [])
        .map((row: any) => String(row.institution_id || "").trim())
        .filter(Boolean),
    ]),
  );
}
