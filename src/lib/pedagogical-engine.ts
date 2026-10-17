import { inferSchoolCycleFromLevel, parseSchoolCyclesSettings, type SchoolCycle, type TeachingTrack } from "./school-cycles";
import { parseFrancoArabicReportsSettings, getConfiguredSubjectCoefficients, type SubjectReportCoefficient } from "./franco-arabic-reporting";
import { normalizeOfficialTrackCode } from "./official-grade-level";

export type InstitutionCoefficient = {
  level: string | null; subject_id: string; coeff: number; include_in_average: boolean | null;
};
export const normalizePedagogicalLevel = (value: string | null | undefined) =>
  String(value || "").normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");

/** Only call with the institution/class already authorized and loaded on the server.
 * URL parameters, templates saved before explicit activation, and navigation alone
 * cannot select the new engine. No legacy calculation is implemented here. */
export function resolvePedagogicalEngine(settingsJson: unknown, schoolClass: { id: string; level?: string | null }) {
  const school = parseSchoolCyclesSettings(settingsJson);
  const reports = parseFrancoArabicReportsSettings(settingsJson);
  const cycle = school.classCycleById[schoolClass.id] || inferSchoolCycleFromLevel(schoolClass.level);
  if (!school.enabled || !reports.enabled || reports.engine !== "specialized" ||
      !cycle || !school.enabledCycles.includes(cycle)) return { engine: "legacy" as const };
  return { engine: "specialized" as const, cycle, school, reports };
}

/** One authority selected explicitly for the whole specialized context.
 * Institution mode reads real activated curriculum and existing coefficient rows;
 * it never copies them into JSON and ignores the old template weights.
 * Program mode reads only exact cycle/level/program policies, never falls back to
 * another program or to a secondary-school/default coefficient. */
export function resolveProgramCoefficients(input: {
  cycle: SchoolCycle; level: string; track: TeachingTrack; settingsJson: unknown;
  activeSubjectIds: readonly string[]; levelSubjectIds: readonly string[];
  institutionCoefficients: readonly InstitutionCoefficient[];
}) {
  const { cycle, level, track } = input;
  const normalizeLevel = (value: string | null) => cycle === "secondary"
    ? normalizeOfficialTrackCode(value) || normalizePedagogicalLevel(value) : normalizePedagogicalLevel(value);
  const school = parseSchoolCyclesSettings(input.settingsJson);
  const reports = parseFrancoArabicReportsSettings(input.settingsJson);
  const active = new Set(input.activeSubjectIds);
  const problems: string[] = [];
  const source = reports.coefficientSource === "program" ? "program" : "institution";
  const policies: SubjectReportCoefficient[] = [];
  const mapped = school.subjectTracksByCycle[cycle] || {};
  if (!school.enabled || !reports.enabled || !school.enabledCycles.includes(cycle) ||
      !school.teachingTracksByCycle[cycle]?.includes(track)) problems.push("program_not_configured");
  if (source === "program") {
    for (const policy of getConfiguredSubjectCoefficients(reports, cycle, level, track)) {
      if (!active.has(policy.subjectId) || !mapped[policy.subjectId]?.includes(track)) {
        problems.push("inactive_or_unclassified_subject"); continue;
      }
      policies.push(policy);
    }
  } else {
    const levelSubjects = input.levelSubjectIds.length ? input.levelSubjectIds : input.institutionCoefficients
      .filter(row => normalizeLevel(row.level) === normalizeLevel(level)).map(row => row.subject_id);
    const subjectIds = [...new Set(levelSubjects)].filter(id => active.has(id) && mapped[id]?.includes(track));
    if (!subjectIds.length) problems.push("level_curriculum_not_configured");
    for (const subjectId of subjectIds) {
      const rows = input.institutionCoefficients.filter(row => row.subject_id === subjectId);
      const exact = rows.filter(row => normalizeLevel(row.level) === normalizeLevel(level));
      const canonical = exact.filter(row => row.level === normalizeOfficialTrackCode(level));
      const candidates = cycle === "secondary" && canonical.length ? canonical : exact.length ? exact : rows.filter(row => !normalizeLevel(row.level));
      if (candidates.length !== 1 || !Number.isFinite(candidates[0].coeff) || candidates[0].coeff < 0 ||
          (candidates[0].coeff === 0 && candidates[0].include_in_average !== false)) {
        problems.push(candidates.length > 1 ? "ambiguous_institution_coefficient" : "institution_coefficient_missing"); continue;
      }
      policies.push({ cycle, level, track, subjectId, coefficient: candidates[0].coeff,
        includeInAverage: candidates[0].include_in_average !== false });
    }
  }
  if (!policies.length) problems.push("level_subjects_not_configured");
  return { source, policies, problems: [...new Set(problems)] };
}

/** A program can be inferred only for a subject belonging to exactly one program.
 * A shared subject is deliberately unresolved until an authenticated, persisted
 * per-evaluation binding is available. Never infer it from UI filters or names. */
export function resolveEvaluationTeachingTrack(settingsJson: unknown, cycle: SchoolCycle, subjectId: string): TeachingTrack | null {
  const school = parseSchoolCyclesSettings(settingsJson);
  const tracks = school.subjectTracksByCycle[cycle]?.[subjectId] || [];
  return tracks.length === 1 && school.teachingTracksByCycle[cycle]?.includes(tracks[0]) ? tracks[0] : null;
}
