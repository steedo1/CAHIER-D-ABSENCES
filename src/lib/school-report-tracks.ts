import {
  parseSchoolCyclesSettings,
  resolveSchoolCycleForClass,
  type TeachingTrack,
} from "./school-cycles";

/**
 * Le champ "Enseignement" n'est utile que si plusieurs enseignements sont
 * effectivement prévus pour les classes affichées.
 *
 * Le choix doit rester valable pour tout le périmètre du rapport : on ne
 * propose pas "arabe" pour un rapport global contenant des classes sans
 * enseignement arabe. Les établissements secondaires classiques conservent
 * directement le moteur général, sans menu spécialisé.
 */
export function reportTracksForSelection(
  settingsJson: unknown,
  availableClasses: ReadonlyArray<{ id: string; level: string | null }>,
  classId: string,
): TeachingTrack[] {
  const settings = parseSchoolCyclesSettings(settingsJson);
  if (!settings.enabled) return ["french"];

  const chosen = classId
    ? availableClasses.filter(row => row.id === classId)
    : availableClasses;
  if (!chosen.length) return ["french"];

  const supported: TeachingTrack[] = (["french", "arabic"] as const).filter(track =>
    chosen.every(row => {
      const cycle = resolveSchoolCycleForClass(row, settings);
      return settings.enabledCycles.includes(cycle) &&
        settings.teachingTracksByCycle[cycle]?.includes(track) === true;
    }),
  );

  return supported.length ? supported : ["french"];
}
