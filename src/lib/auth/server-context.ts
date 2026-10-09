import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import { getVerifiedServerUser } from "../supabase-server";

// Key by the authenticated request client, NEVER the singleton service client.
// No cross-request authorization cache, so role/profile writes need no TTL.
const profiles = new WeakMap<SupabaseClient, Map<string, Promise<any>>>();
const roles = new WeakMap<SupabaseClient, Map<string, Promise<any>>>();

function once(
  cache: WeakMap<SupabaseClient, Map<string, Promise<any>>>,
  client: SupabaseClient,
  userId: string,
  read: () => PromiseLike<any>,
) {
  let entries = cache.get(client);
  if (!entries) { entries = new Map(); cache.set(client, entries); }
  let pending = entries.get(userId);
  if (!pending) { pending = Promise.resolve(read()); entries.set(userId, pending); }
  return pending;
}

export function getRequestProfile(client: SupabaseClient, userId: string): Promise<{ data: { id: string; institution_id: string | null } | null; error: PostgrestError | null }> {
  return once(profiles, client, userId, () => client.from("profiles")
    .select("id,institution_id").eq("id", userId).maybeSingle());
}

export function getRequestRoles(client: SupabaseClient, reader: SupabaseClient, userId: string): Promise<{ data: Array<{ role: string; institution_id: string | null }> | null; error: PostgrestError | null }> {
  return once(roles, client, userId, () => reader.from("user_roles")
    .select("role,institution_id").eq("profile_id", userId));
}

export async function requireInstitutionRole(
  client: SupabaseClient,
  reader: SupabaseClient,
  allowedRoles: readonly string[],
): Promise<{ user: { id: string }; instId: string } | {
  error: "unauthorized" | "no_institution" | "forbidden";
}> {
  const { data: { user }, error } = await getVerifiedServerUser(client);
  if (error || !user) return { error: "unauthorized" };
  const [profile, roleRows] = await Promise.all([
    getRequestProfile(client, user.id), getRequestRoles(client, reader, user.id),
  ]);
  if (profile.error || roleRows.error) return { error: "forbidden" };
  const profileInstitution = String(profile.data?.institution_id || "");
  const applicable = (roleRows.data || []).filter((row) => allowedRoles.includes(row.role));
  const instId = profileInstitution || String(applicable.find((row) => row.institution_id)?.institution_id || "");
  if (!instId) return { error: "no_institution" };
  const allowed = applicable.some((row) =>
    row.role === "super_admin" || row.institution_id === instId ||
    (!row.institution_id && Boolean(profileInstitution)),
  );
  if (!allowed) return { error: "forbidden" };
  return { user: { id: user.id }, instId };
}
