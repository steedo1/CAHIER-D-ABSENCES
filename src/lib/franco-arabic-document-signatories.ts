import { isSchoolCycle, parseSchoolCyclesSettings, type SchoolCycle, type TeachingTrack } from "./school-cycles";
import { isBilingualSchool, readStudentProgramSettings } from "./school-student-programs";
import { readSchoolTeachingSignatories, SCHOOL_TEACHING_DIRECTOR_TITLE } from "./school-teaching-signatories";

/** General institution head, also used by the unchanged classic certificate. */
export function resolveAttestationSignatory(settings: {
  institution_head_name?: string | null;
  institution_head_title?: string | null;
  settings_json?: unknown;
}): { name: string; title: string; signatureTitle: string } {
  const bilingual = isBilingualSchool(parseSchoolCyclesSettings(settings.settings_json));
  const name = (settings.institution_head_name || "").trim();
  const title = (settings.institution_head_title || "").trim() ||
    (bilingual ? "Directeur" : "Chef d'etablissement");
  return { name: name || (bilingual ? "Nom du directeur non renseigné" : "Le responsable"),
    title, signatureTitle: title };
}

export type AttestationSignatory = {
  name: string;
  title: string;
  signatureTitle: string;
  teachingLabel?: string;
};

/** One certificate per pupil, with BOTH teaching directors for a bilingual school. */
export function resolveAttestationSignatories(
  settings: Parameters<typeof resolveAttestationSignatory>[0],
): AttestationSignatory[] {
  if (!isBilingualSchool(parseSchoolCyclesSettings(settings.settings_json))) {
    return [resolveAttestationSignatory(settings)];
  }
  const names = readSchoolTeachingSignatories(settings.settings_json);
  return (["french", "arabic"] as const).map(track => ({
    name: names[track]?.name || "Nom du directeur non renseigné",
    title: SCHOOL_TEACHING_DIRECTOR_TITLE,
    signatureTitle: SCHOOL_TEACHING_DIRECTOR_TITLE,
    teachingLabel: track === "french" ? "Enseignement français" : "Enseignement arabe",
  }));
}

export type TeachingDocumentSignatory = {
  track: TeachingTrack | "general";
  name: string;
  title: string;
};
export type TeachingDocumentContext = {
  academicYear?: string | null;
  classIds?: readonly string[];
  tracks?: readonly TeachingTrack[];
  cycle?: SchoolCycle | "all";
  institutionHeadName?: string | null;
  institutionHeadTitle?: string | null;
};

/** Display policy only, never a permission to sign digitally.
 * null keeps the classic document unchanged; [] means teaching unconfigured.
 * One teaching uses its director. Both use ONLY the configured general head.
 * A class label or the currently connected user's name is never authoritative.
 */
export function resolveTeachingDocumentSignatories(
  settingsJson: unknown, context: TeachingDocumentContext = {},
): TeachingDocumentSignatory[] | null {
  const school = parseSchoolCyclesSettings(settingsJson);
  if (!isBilingualSchool(school)) return null;
  const cycles = context.cycle && context.cycle !== "all" ? [context.cycle] : school.enabledCycles;
  const offered = new Set(cycles.flatMap(cycle => school.teachingTracksByCycle[cycle] || []));
  let tracks: TeachingTrack[];
  if (context.classIds?.length) {
    const classes = readStudentProgramSettings(settingsJson).years[context.academicYear || ""]?.classes || {};
    if (context.classIds.some(id => !classes[id])) return [];
    tracks = [...new Set(context.classIds.flatMap(id => {
      const cycle = school.classCycleById[id];
      if (cycle && (!isSchoolCycle(cycle) || !cycles.includes(cycle))) return [];
      const policy = classes[id];
      return [...policy.tracks, ...Object.values(policy.students).flat()];
    }))];
  } else tracks = ["french", "arabic"];
  const selected = (["french", "arabic"] as const).filter(track => offered.has(track) &&
    tracks.includes(track) && (!context.tracks || context.tracks.includes(track)));
  if (selected.length > 1) {
    const general = resolveAttestationSignatory({ settings_json: settingsJson,
      institution_head_name: context.institutionHeadName, institution_head_title: context.institutionHeadTitle });
    return [{ track: "general", name: general.name, title: general.title }];
  }
  const names = readSchoolTeachingSignatories(settingsJson);
  return selected.map(track => ({ track,
    name: names[track]?.name || "Nom du directeur non renseigné", title: SCHOOL_TEACHING_DIRECTOR_TITLE }));
}

const escapeSignatory = (value: string) => value.replace(/&/g, "&amp;")
  .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Same policy for the existing HTML → print/PDF templates. */
export function teachingDocumentSignaturesHtml(signatories: TeachingDocumentSignatory[] | null): string {
  if (signatories === null) return "";
  const rows = signatories.length ? signatories : [{ title: SCHOOL_TEACHING_DIRECTOR_TITLE, name: "Nom du directeur non renseigné" }];
  return `<div data-document-directions style="display:flex;justify-content:flex-end;gap:24px;margin-top:12px;break-inside:avoid">${rows.map(row =>
    `<div style="min-width:140px;text-align:center;font-size:11px"><strong>${escapeSignatory(row.title)}</strong><div style="margin-top:12px">${escapeSignatory(row.name)}</div></div>`).join("")}</div>`;
}
