import { parseSchoolCyclesSettings } from "@/lib/school-cycles";
import { isBilingualSchool } from "@/lib/school-student-programs";

/**
 * The frequency certificate belongs to the institution, not to a pedagogical
 * teaching track: one document for a pupil who follows French, Arabic or both.
 * The already configured institution head is the signatory; never choose a
 * French or Arabic teaching director based on a student's class or label.
 */
export function resolveAttestationSignatory(settings: {
  institution_head_name?: string | null;
  institution_head_title?: string | null;
  settings_json?: unknown;
}): { name: string; title: string; signatureTitle: string } {
  const isFrancoArabic = isBilingualSchool(parseSchoolCyclesSettings(settings.settings_json));
  const configuredName = (settings.institution_head_name || "").trim();
  if (isFrancoArabic) {
    return {
      name: configuredName || "Nom du directeur non renseigné",
      title: "Directeur",
      signatureTitle: "Le Directeur",
    };
  }
  const title = (settings.institution_head_title || "").trim() || "Chef d'etablissement";
  return {
    name: configuredName || "Le responsable",
    title,
    signatureTitle: title,
  };
}
