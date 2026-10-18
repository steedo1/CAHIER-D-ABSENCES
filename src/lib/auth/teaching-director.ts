import type { SupabaseClient } from "@supabase/supabase-js";
import { getVerifiedServerUser } from "@/lib/supabase-server";
import { parseSchoolCyclesSettings, type TeachingTrack, type SchoolCycle } from "@/lib/school-cycles";
import { canAccessScopedTeachingResource } from "@/lib/school-director-scope";

export type TeachingDirectorPrincipal = {
  userId: string;
  institutionId: string;
  teachingTrack: TeachingTrack;
  cycles: SchoolCycle[];
};

export type TeachingDirectorResolution =
  | { ok: true; principal: TeachingDirectorPrincipal }
  | { ok: false; status: 401 | 403 | 503; error: string };

/** Server-only identity. A client-selected language, cycle, name or class never grants access. */
export async function requireTeachingDirector(
  client: SupabaseClient,
  service: SupabaseClient,
): Promise<TeachingDirectorResolution> {
  const { data: { user }, error: authError } = await getVerifiedServerUser(client);
  if (authError || !user) return { ok: false, status: 401, error: "unauthorized" };
  const [profile, roles, assignments] = await Promise.all([
    service.from("profiles").select("institution_id").eq("id", user.id).maybeSingle(),
    service.from("user_roles").select("role,institution_id").eq("profile_id", user.id),
    service.from("school_teaching_directors")
      .select("institution_id,teaching_track,is_active")
      .eq("profile_id", user.id).eq("is_active", true).limit(3),
  ]);
  if (profile.error || roles.error || assignments.error) {
    return { ok: false, status: 503, error: "director_access_unavailable" };
  }
  const institutionId = String(profile.data?.institution_id || "");
  const grants = (roles.data || []).filter(row => row.institution_id === institutionId);
  // A director is NEVER an alias of the unrestricted admin role.
  // Do not mix with teacher/educator roles until their APIs are program-scoped.
  if (!institutionId || grants.length !== 1 || grants[0].role !== "teaching_director") {
    return { ok: false, status: 403, error: "director_role_required" };
  }
  const assigned = (assignments.data || []).filter(row => row.institution_id === institutionId);
  if (assigned.length !== 1 && assigned.length !== 2) {
    return { ok: false, status: 403, error: "director_assignment_required" };
  }
  // One identity may be responsible for both directions, but no request can
  // implicitly select which one. Such accounts need an explicit verified scope.
  if (assigned.length !== 1) return { ok: false, status: 403, error: "multiple_director_scopes_not_supported" };
  const teachingTrack = assigned[0].teaching_track;
  if (teachingTrack !== "french" && teachingTrack !== "arabic") {
    return { ok: false, status: 403, error: "invalid_director_scope" };
  }
  const school = await service.from("institutions")
    .select("settings_json").eq("id", institutionId).maybeSingle();
  if (school.error) return { ok: false, status: 503, error: "school_unavailable" };
  const settings = parseSchoolCyclesSettings(school.data?.settings_json);
  if (!settings.enabled) return { ok: false, status: 403, error: "school_not_multicycle" };
  const cycles = settings.enabledCycles.filter(cycle =>
    settings.teachingTracksByCycle[cycle]?.includes(teachingTrack));
  if (!cycles.length) return { ok: false, status: 403, error: "track_not_configured" };
  return { ok: true, principal: { userId: user.id, institutionId, teachingTrack, cycles } };
}

/** Explicit school + program + cycle + subject scope for director resource APIs. */
export function canDirectorReadSubject(
  settingsJson: unknown,
  principal: TeachingDirectorPrincipal,
  request: { institutionId: string; cycle: SchoolCycle; subjectId: string; track: TeachingTrack },
): boolean {
  return request.institutionId === principal.institutionId &&
    request.track === principal.teachingTrack &&
    principal.cycles.includes(request.cycle) &&
    canAccessScopedTeachingResource(
      parseSchoolCyclesSettings(settingsJson),
      { kind: "teaching_track", track: principal.teachingTrack },
      { cycle: request.cycle, subjectId: request.subjectId },
    );
}
