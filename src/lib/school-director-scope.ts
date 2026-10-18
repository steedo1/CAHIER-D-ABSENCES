import type { SchoolCycle, SchoolCyclesSettings, TeachingTrack } from "@/lib/school-cycles";

/**
 * Fail-closed policy primitive for future program-specific directors.
 *
 * The caller MUST read a verified identity, institution-scoped user roles,
 * and the institution configuration on the server. Never pass a client-side
 * "role" or "teaching track" filter as the source of authority.
 *
 * Until every affected API is wired to this predicate, do NOT create restricted
 * director accounts or claim that the data is isolated.
 */
export type SchoolDirectorScope =
  | { kind: "school_wide" }
  | { kind: "teaching_track"; track: TeachingTrack };

export type ScopedTeachingResource = {
  cycle: SchoolCycle;
  subjectId: string;
};

export function canAccessScopedTeachingResource(
  settings: SchoolCyclesSettings,
  scope: SchoolDirectorScope,
  resource: ScopedTeachingResource,
): boolean {
  if (!settings.enabled) return scope.kind === "school_wide";

  // Even a school-wide director may only use enabled cycles.
  if (!settings.enabledCycles.includes(resource.cycle)) return false;

  if (scope.kind === "school_wide") return true;

  if (!settings.teachingTracksByCycle[resource.cycle]?.includes(scope.track)) return false;

  // Never infer a subject's teaching track from its display name/language.
  // An unmapped subject is inaccessible to all track-scoped directors.
  return (settings.subjectTracksByCycle[resource.cycle]?.[resource.subjectId] || [])
    .includes(scope.track);
}

/** Aggregated school finances and registrations are school-wide by default. */
export function canAccessSchoolWideAdministration(scope: SchoolDirectorScope): boolean {
  return scope.kind === "school_wide";
}

/** Requires a principal resolved from verified server identity and assignments.
 * A teaching-track query parameter must never be used as that assignment.
 * This policy is separate from legacy role grants and does not activate accounts.
 */
export function canAccessDirectorProgramResource(
  settings: SchoolCyclesSettings,
  principal: { institutionId: string; scope: SchoolDirectorScope },
  resource: ScopedTeachingResource & { institutionId: string; track: TeachingTrack },
): boolean {
  if (!principal.institutionId || principal.institutionId !== resource.institutionId) return false;
  if (!settings.enabled || !settings.teachingTracksByCycle[resource.cycle]?.includes(resource.track)) return false;
  if (!settings.subjectTracksByCycle[resource.cycle]?.[resource.subjectId]?.includes(resource.track)) return false;
  if (principal.scope.kind === "teaching_track" && principal.scope.track !== resource.track) return false;
  return canAccessScopedTeachingResource(settings, principal.scope, resource);
}

/**
 * An ordinary 'admin' grant provides access to school-wide legacy modules.
 * Until ALL APIs implement track-scoped authorizations, a bilingual school
 * must not silently provision such a grant as a French/Arabic director.
 * Existing accounts are untouched. No new database table is required.
 */
export function mustDeferBilingualAdminProvisioning(
  settings: SchoolCyclesSettings,
  requestedRole: string,
): boolean {
  return requestedRole === "admin" && settings.enabled &&
    settings.enabledCycles.some(cycle => settings.teachingTracksByCycle[cycle]?.includes("arabic"));
}

/**
 * Pure, fail-closed principal resolution. No role mixing and no scope based on
 * a URL parameter. The active appointment is the only program authority.
 */
export function resolveTeachingDirectorGrant(input: {
  institutionId: string;
  roles: Array<{ role: string; institution_id: string | null }>;
  appointments: Array<{ institution_id: string; teaching_track: string; is_active: boolean }>;
}): TeachingTrack | null {
  const { institutionId, roles, appointments } = input;
  // The school's directors already hold teacher accounts. Preserve that
  // pre-existing teaching grant without allowing admin, finance or founder.
  const roleSet = new Set(roles.map(row => row.role));
  if (!institutionId || roleSet.size !== roles.length ||
      !roleSet.has("teaching_director") ||
      [...roleSet].some(role => role !== "teaching_director" && role !== "teacher") ||
      roles.some(row => row.institution_id !== institutionId)) return null;
  const active = appointments.filter(row => row.is_active && row.institution_id === institutionId);
  if (appointments.some(row => row.is_active && row.institution_id !== institutionId)) return null;
  if (active.length !== 1) return null;
  return active[0].teaching_track === "french" || active[0].teaching_track === "arabic"
    ? active[0].teaching_track : null;
}

