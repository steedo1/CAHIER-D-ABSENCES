import type {
  MontageAffectation,
  MontageClass,
  MontagePeriod,
  MontageSubject,
  MontageTeacher,
} from "../types";

export type MontageInputContext = {
  classes: MontageClass[];
  subjects: MontageSubject[];
  teachers: MontageTeacher[];
  periods: MontagePeriod[];
  affectations: MontageAffectation[];
};

/**
 * Adaptateur de protection entre Mon Cahier et le futur moteur de montage.
 *
 * Règle importante :
 * - Mon Cahier reste la source des classes, enseignants, matières et créneaux.
 * - Le moteur de montage travaille sur une copie transformée.
 * - Aucune donnée officielle n’est modifiée ici.
 */
export function monCahierToMontageContext(input: MontageInputContext) {
  return {
    classes: input.classes,
    subjects: input.subjects,
    teachers: input.teachers,
    periods: input.periods,
    affectations: input.affectations,
  };
}
