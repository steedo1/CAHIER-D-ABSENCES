import { getConfiguredPrimarySubjectScale, getConfiguredScoringScale, parseFrancoArabicReportsSettings } from "@/lib/franco-arabic-reporting";
import { ciPrimaryFrenchDenominator, ciPrimaryFrenchEntryForName } from "@/lib/primary-french-reference-ci";
import { hasCiPrimaryFrenchReference } from "@/lib/school-class-subjects";
import { parseSchoolCyclesSettings, type TeachingTrack } from "@/lib/school-cycles";
import { readStudentProgramSettings } from "@/lib/school-student-programs";
import { resolvePrimaryTeachingTrack } from "./primary-evaluation-kind";

/** Call with the canonical subject ID and the server-authorized class/year. */
export function primarySubjectTeachingTrack(settings: unknown, year: string, classId: string, subjectId: string): TeachingTrack | null {
  const school = parseSchoolCyclesSettings(settings);
  const subjectTracks = school.subjectTracksByCycle.primary?.[subjectId];
  if (!subjectTracks?.length) return null;
  return resolvePrimaryTeachingTrack({ offeredTracks: school.teachingTracksByCycle.primary || [], subjectTracks,
    classTracks: readStudentProgramSettings(settings).years[year]?.classes[classId]?.tracks || school.teachingTracksByCycle.primary || [] });
}

/** One barème authority for the teacher selector, server writes and reports.
 * Older schools with only an explicit level scale keep that saved scale.
 * Once per-subject Arabic barèmes exist, an absent barème never falls back. */
export function primarySubjectScale(settings: unknown, context: {
  year: string; classId: string; level: string; track: TeachingTrack;
  subjectId: string; subjectName: string;
}): number | null {
  const reports = parseFrancoArabicReportsSettings(settings);
  const levelScale = getConfiguredScoringScale(reports, "primary", context.level, context.track);
  if (levelScale === null) return null;
  if (context.track === "arabic" && reports.primarySubjectScales !== undefined)
    return getConfiguredPrimarySubjectScale(reports, context.level, context.subjectId);
  if (context.track === "french" && hasCiPrimaryFrenchReference(settings, context.year, context.classId)) {
    const entry = ciPrimaryFrenchEntryForName(context.subjectName);
    if (entry) return ciPrimaryFrenchDenominator(context.level, entry.code);
  }
  return levelScale;
}
