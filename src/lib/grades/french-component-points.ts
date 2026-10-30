/**
 * Points de français dans la moyenne générale du secondaire.
 *
 * Le bulletin conserve la moyenne principale de français, mais le total utilise
 * les moyennes des composantes, sans ajouter ensuite la moyenne parent.
 * Si des composantes sont absentes, la moyenne parent reste la référence.
 */
export type FrenchBulletinComponent = {
  id: string;
  subject_id: string;
  coeff_in_subject: number;
};

export type FrenchBulletinComponentGrade = {
  subject_id: string;
  component_id: string;
  avg20: number | null;
};

export function frenchComponentPoints(input: {
  subjectName: string;
  subjectId: string;
  officialCoeff: number;
  components: readonly FrenchBulletinComponent[];
  grades: readonly FrenchBulletinComponentGrade[];
  bonus?: number | null;
  averageSource?: string | null;
}): number | null {
  const subject = input.subjectName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  if (subject !== "francais" || !Number.isFinite(input.officialCoeff) || input.officialCoeff <= 0) return null;

  const components = input.components.filter(c => c.subject_id === input.subjectId);
  if (!components.length) return null;

  let weightedSum = 0;
  let componentCoefficients = 0;
  for (const component of components) {
    const coeff = Number(component.coeff_in_subject);
    const grade = input.grades.find(g => g.subject_id === input.subjectId && g.component_id === component.id);
    // 0/20 est une vraie note ; une composante manquante impose le repli sur le parent.
    if (!Number.isFinite(coeff) || coeff <= 0 || grade?.avg20 === null || grade?.avg20 === undefined ||
        !Number.isFinite(Number(grade.avg20))) return null;
    weightedSum += Number(grade.avg20) * coeff;
    componentCoefficients += coeff;
  }

  if (componentCoefficients <= 0) return null;
  const componentAverage = weightedSum / componentCoefficients;
  const bonus = input.averageSource === "direct" ? 0 : Number(input.bonus || 0);
  const adjusted = Math.min(20, Math.max(0, componentAverage + (Number.isFinite(bonus) ? bonus : 0)));
  // Utiliser le coefficient officiel de français même si les poids internes diffèrent.
  return adjusted * input.officialCoeff;
}
