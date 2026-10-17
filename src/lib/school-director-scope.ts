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
