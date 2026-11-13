/**
 * Le compte professeur ne doit afficher qu'une fois chaque affectation active,
 * après résolution des identifiants de matières (établissement -> canonique).
 * Deux enseignements distincts d'une classe restent deux choix distincts.
 */
export function deduplicateTeacherClassOptions<T extends {
  class_id: string;
  subject_id: string | null;
  teaching_track?: string | null;
  academic_year?: string | null;
}>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [
      item.academic_year || "",
      item.class_id,
      item.subject_id || "",
      item.teaching_track || "",
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
