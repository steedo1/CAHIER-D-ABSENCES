/** Human-readable diagnostics for the selected teaching, outside the printed document. */
const messages: Record<string, string> = {
  program_not_configured: "L’enseignement n’est pas activé dans les paramètres pédagogiques.",
  level_scale_not_configured: "Le barème de moyenne de ce niveau et de cet enseignement n’est pas renseigné.",
  primary_subject_scale_not_configured: "Le barème d’une matière évaluée n’est pas renseigné.",
  class_curriculum_not_configured: "Les matières de cette classe ne sont pas encore configurées.",
  level_curriculum_not_configured: "Aucune matière de ce niveau n’est rattachée à cet enseignement.",
  level_subjects_not_configured: "Les matières nécessaires au calcul ne sont pas configurées.",
  level_subject_not_classified_for_program: "Le rattachement d’une matière à l’enseignement doit être vérifié.",
  inactive_or_unclassified_subject: "Une matière est inactive ou son enseignement n’est pas renseigné.",
  institution_coefficient_missing: "Un coefficient de matière du secondaire n’est pas renseigné.",
  class_subject_coefficient_missing: "Les coefficients du secondaire ne couvrent pas toutes les matières de la classe.",
  ambiguous_institution_coefficient: "Plusieurs coefficients contradictoires existent pour une matière du secondaire.",
  subject_policy_missing_or_invalid: "La règle de calcul d’une matière doit être vérifiée.",
  included_subject_without_score: "Une matière requise pour la moyenne n’a pas de note officielle publiée.",
  no_subject_in_average: "Aucune note exploitable n’est disponible pour calculer cette moyenne.",
  invalid_published_score: "Une note publiée ou son barème est invalide.",
  duplicate_published_evaluation: "Une évaluation publiée apparaît plusieurs fois ; le calcul est suspendu.",
  official_publication_version_mismatch: "La version des notes publiées ne correspond pas à l’évaluation courante.",
  primary_event_unpublished_evaluation: "Une évaluation de cette composition n’est pas encore publiée.",
  primary_event_duplicate_subject: "Une matière possède plusieurs évaluations pour la même composition.",
  primary_event_date_mismatch: "La date d’une évaluation diffère de celle du calendrier.",
  shared_subject_requires_program_specific_evaluations: "L’enseignement français ou arabe d’une évaluation commune doit être précisé.",
  evaluation_component_outside_program: "Une sous-matière évaluée n’appartient pas au programme sélectionné.",
  PRIMARY_ANNUAL_INCOMPLETE: "La moyenne annuelle attend toutes les compositions officielles et la composition de passage.",
  SECONDARY_FRENCH_STUDENT_MISSING_IN_HISTORICAL_RESULT: "Le résultat historique français de cet élève n’est pas disponible.",
  SECONDARY_FRENCH_CURRICULUM_INCOMPLETE: "Des matières affectées à la classe sont absentes du résultat secondaire français. Vérifiez les coefficients et le programme de la classe.",
};

export function bulletinPreparationMessages(problems: readonly string[]): string[] {
  return [...new Set(problems.map(problem => messages[problem] ||
    "Une donnée nécessaire au bulletin doit être vérifiée dans les paramètres ou les notes publiées."))];
}
