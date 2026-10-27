import { getConfiguredPrimarySubjectScale, getConfiguredScoringScale, parseFrancoArabicReportsSettings } from "@/lib/franco-arabic-reporting";
import { ciPrimaryFrenchDenominator, ciPrimaryFrenchEntryForName } from "@/lib/primary-french-reference-ci";
import { hasCiPrimaryFrenchReference } from "@/lib/school-class-subjects";
import { parseSchoolCyclesSettings, type TeachingTrack } from "@/lib/school-cycles";
import { readStudentProgramSettings } from "@/lib/school-student-programs";

/** Call with the canonical subject ID and the server-authorized class/year. */
export function primarySubjectTeachingTracks(settings: unknown, year: string, classId: string, subjectId: string): TeachingTrack[] {
  const school = parseSchoolCyclesSettings(settings);
  const subjectTracks = school.subjectTracksByCycle.primary?.[subjectId] || [];
  const classTracks = readStudentProgramSettings(settings).years[year]?.classes[classId]?.tracks || school.teachingTracksByCycle.primary || [];
  return subjectTracks.filter(track => classTracks.includes(track) && school.teachingTracksByCycle.primary?.includes(track));
}
export function primarySubjectTeachingTrack(settings: unknown, year: string, classId: string, subjectId: string, requested?: string | null): TeachingTrack | null {
  const tracks = primarySubjectTeachingTracks(settings, year, classId, subjectId);
  if (requested) return tracks.find(track => track === requested) || null;
  return tracks.length === 1 ? tracks[0] : null;
}

/** One barème authority for the teacher selector, server writes and reports.
 * Older schools with only an explicit level scale keep that saved scale.
 * An Arabic subject override applies only to that subject; other subjects keep the level scale. */
export function primarySubjectScale(settings: unknown, context: {
  year: string; classId: string; level: string; track: TeachingTrack;
  subjectId: string; subjectName: string;
}): number | null {
  const reports = parseFrancoArabicReportsSettings(settings);
  const levelScale = getConfiguredScoringScale(reports, "primary", context.level, context.track);
  if (levelScale === null) return null;
  if (context.track === "arabic" && reports.primarySubjectScales !== undefined) {
    const subjectScale = getConfiguredPrimarySubjectScale(reports, context.level, context.subjectId);
    if (subjectScale !== null) return subjectScale;
    if (!reports.primaryArabicDefaultScale) return null;
  }
  if (context.track === "french" && hasCiPrimaryFrenchReference(settings, context.year, context.classId)) {
    const entry = ciPrimaryFrenchEntryForName(context.subjectName);
    if (entry) return ciPrimaryFrenchDenominator(context.level, entry.code);
  }
  return levelScale;
}
