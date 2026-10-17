import { getSchoolAdminNavigation, isSchoolCycle, isTeachingTrack, type SchoolCycle, type SchoolCyclesSettings, type TeachingTrack } from "./school-cycles";
import { normalizeSchoolLevel, sameSchoolLevel } from "./school-levels";

export type SchoolNavigationClass = { id: string; label: string; level: string | null; cycle: SchoolCycle };
export type SchoolNavigationContext = {
  cycle: SchoolCycle | "all";
  track: TeachingTrack | "all";
  level: string;
  classId: string;
};
export const SCHOOL_CONTEXT_KEYS = ["school_cycle", "teaching_track", "school_level", "school_class_id"] as const;

export function readSchoolNavigation(params: Pick<URLSearchParams, "get">): Partial<SchoolNavigationContext> {
  const cycle = params.get("school_cycle") || params.get("cycle");
  const track = params.get("teaching_track");
  return {
    cycle: isSchoolCycle(cycle) || cycle === "all" ? cycle : undefined,
    track: isTeachingTrack(track) ? track : "all",
    level: (params.get("school_level") || "").trim().slice(0, 60),
    classId: params.get("school_class_id") || "",
  };
}

/** Navigation is presentation state. It NEVER grants access to any resource. */
export function resolveSchoolNavigation(
  settings: SchoolCyclesSettings,
  requested: Partial<SchoolNavigationContext>,
  classes: readonly SchoolNavigationClass[],
): SchoolNavigationContext {
  const navigation = getSchoolAdminNavigation(settings, requested.cycle);
  const cycle = navigation.landingCycle;
  const track = requested.track && requested.track !== "all" && navigation.availableTracks.includes(requested.track)
    ? requested.track : navigation.availableTracks.length === 1 ? navigation.availableTracks[0] : "all";
  const candidates = classes.filter(row => settings.enabledCycles.includes(row.cycle) && (cycle === "all" || row.cycle === cycle));
  const matchingLevel = requested.level ? candidates.find(row => sameSchoolLevel(row.level, requested.level, row.cycle)) : undefined;
  const level = matchingLevel ? normalizeSchoolLevel(matchingLevel.level, matchingLevel.cycle) : "";
  const classId = candidates.some(row => row.id === requested.classId && (!level || sameSchoolLevel(row.level, level, row.cycle)))
    ? requested.classId || "" : "";
  return { cycle, track, level, classId };
}

/** Preserve module-specific query strings, hashes and explicit target context. */
export function withSchoolNavigation(href: string, context: SchoolNavigationContext): string {
  if (!(href === "/admin" || href.startsWith("/admin/") || href.startsWith("/admin?"))) return href;
  const url = new URL(href, "https://navigation.invalid");
  if (!(url.pathname === "/admin" || url.pathname.startsWith("/admin/"))) return href;
  const entries = {
    school_cycle: context.cycle, teaching_track: context.track,
    school_level: context.level, school_class_id: context.classId,
  };
  for (const [key, value] of Object.entries(entries)) {
    if (value && !url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  // Old cycle card links have an explicit destination and take precedence.
  const legacyCycle = url.searchParams.get("cycle");
  if (isSchoolCycle(legacyCycle)) {
    url.searchParams.set("school_cycle", legacyCycle);
    if (legacyCycle !== context.cycle) {
      url.searchParams.delete("school_level");
      url.searchParams.delete("school_class_id");
    }
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
