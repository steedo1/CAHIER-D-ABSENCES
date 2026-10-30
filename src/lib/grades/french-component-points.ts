/**
 * Contribution autonome des sous-matières du français au bulletin secondaire.
 * Une composante NC ne fournit ni points ni coefficient. 0/20 est une vraie note.
 * La moyenne parent est uniquement informative et ne se cumule jamais.
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

export type FrenchComponentContribution = {
  /** Somme des coefficients des sous-matières effectivement notées. */
  coefficient: number;
  /** Points de français, incluant éventuellement le bonus matière. */
  points: number;
  /** Moyenne brute calculée uniquement avec les sous-matières notées. */
  rawAverage: number | null;
  /** Moyenne à afficher sous Français ; null si toutes les composantes sont NC. */
  average: number | null;
};

export type FrenchComponentInput = {
  subjectName: string;
  subjectId: string;
  /** Conservé pour compatibilité ; non utilisé si des composantes sont configurées. */
  officialCoeff: number;
  components: readonly FrenchBulletinComponent[];
  grades: readonly FrenchBulletinComponentGrade[];
  bonus?: number | null;
  averageSource?: string | null;
};

/** null signifie que la matière n'est pas un Français détaillé : garder le calcul habituel. */
export function frenchComponentContribution(input: FrenchComponentInput): FrenchComponentContribution | null {
  const subject = input.subjectName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  if (subject !== "francais") return null;

  const components = input.components.filter(c => c.subject_id === input.subjectId);
  if (!components.length) return null;

  let sum = 0;
  let coefficient = 0;
  for (const component of components) {
    const w = Number(component.coeff_in_subject);
    const cell = input.grades.find(g => g.subject_id === input.subjectId && g.component_id === component.id);
    const grade = cell?.avg20;
    // NC : exclure intégralement la composante, sans la transformer en 0.
    if (!Number.isFinite(w) || w <= 0 || grade === null || grade === undefined ||
        !Number.isFinite(Number(grade))) continue;
    sum += Number(grade) * w;
    coefficient += w;
  }

  if (coefficient <= 0) return { coefficient: 0, points: 0, rawAverage: null, average: null };
  const rawAverage = sum / coefficient;
  const bonus = input.averageSource === "direct" ? 0 : Number(input.bonus ?? 0);
  const average = Math.min(20, Math.max(0, rawAverage + (Number.isFinite(bonus) ? bonus : 0)));
  return { coefficient, points: average * coefficient, rawAverage, average };
}

/** Compatibilité avec les appels qui ne demandent que les points. */
export function frenchComponentPoints(input: FrenchComponentInput): number | null {
  const contribution = frenchComponentContribution(input);
  return contribution && contribution.coefficient > 0 ? contribution.points : null;
}
