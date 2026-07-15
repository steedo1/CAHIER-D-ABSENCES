export type DistinctionTier = "encouragement" | "felicitations" | "excellence";
export type StudentPalmaresMode = "individual" | "general" | "science" | "literature";

export type DistinctionTierRule = {
  average_min: number;
  conduct_min: number;
};

export type StudentDistinctionSettings = {
  tiers: Record<DistinctionTier, DistinctionTierRule>;
  require_complete_grades: boolean;
  independent_absence_limit_enabled: boolean;
  max_absence_count: number;
  min_family_subjects: number;
  science_subject_ids: string[];
  literature_subject_ids: string[];
  science_keywords: string[];
  literature_keywords: string[];
};

export type TeacherDistinctionSettings = {
  weights: {
    evaluation_regularity: number;
    note_coverage: number;
    pedagogical_mean: number;
    success_rate: number;
    attendance: number;
    punctuality: number;
    textbook: number;
    progression: number;
    student_presence: number;
  };
  evaluations_target_per_class: number;
  minimum_published_evaluations_per_class: number;
  minimum_evaluation_note_coverage_rate: number;
  minimum_class_evaluation_compliance_rate: number;
  minimum_teacher_attendance_observations: number;
  minimum_teacher_attendance_coverage_rate: number;
  minimum_textbook_session_coverage_rate: number;
  minimum_student_attendance_sessions: number;
  minimum_student_attendance_coverage_rate: number;
  punctuality_tolerance_minutes: number;
  minimum_score: number;
};

export const STRICT_TEACHER_WEIGHTS: TeacherDistinctionSettings["weights"] = {
  evaluation_regularity: 15,
  note_coverage: 10,
  pedagogical_mean: 10,
  success_rate: 15,
  attendance: 12,
  punctuality: 8,
  textbook: 12,
  progression: 8,
  student_presence: 10,
};

export type DistinctionSettings = {
  version: 1;
  students: StudentDistinctionSettings;
  teachers: TeacherDistinctionSettings;
};

export const DEFAULT_DISTINCTION_SETTINGS: DistinctionSettings = {
  version: 1,
  students: {
    tiers: {
      encouragement: { average_min: 12, conduct_min: 14 },
      felicitations: { average_min: 14, conduct_min: 15 },
      excellence: { average_min: 16, conduct_min: 16 },
    },
    require_complete_grades: true,
    // La conduite intègre déjà l'assiduité dans Mon Cahier. Cette limite séparée
    // reste désactivée par défaut afin de ne pas sanctionner deux fois un élève.
    independent_absence_limit_enabled: false,
    max_absence_count: 8,
    min_family_subjects: 2,
    science_subject_ids: [],
    literature_subject_ids: [],
    science_keywords: [
      "math",
      "physique",
      "chimie",
      "svt",
      "science",
      "technologie",
      "informatique",
      "biologie",
    ],
    literature_keywords: [
      "francais",
      "français",
      "anglais",
      "allemand",
      "espagnol",
      "histoire",
      "geographie",
      "géographie",
      "philosophie",
      "latin",
      "litterature",
      "littérature",
      "lv1",
      "lv2",
    ],
  },
  teachers: {
    weights: { ...STRICT_TEACHER_WEIGHTS },
    evaluations_target_per_class: 5,
    minimum_published_evaluations_per_class: 3,
    minimum_evaluation_note_coverage_rate: 70,
    minimum_class_evaluation_compliance_rate: 80,
    minimum_teacher_attendance_observations: 10,
    minimum_teacher_attendance_coverage_rate: 50,
    minimum_textbook_session_coverage_rate: 60,
    minimum_student_attendance_sessions: 5,
    minimum_student_attendance_coverage_rate: 50,
    punctuality_tolerance_minutes: 15,
    minimum_score: 75,
  },
};

export const DISTINCTION_TIER_LABELS: Record<DistinctionTier, string> = {
  encouragement: "Tableau d’honneur · Encouragement",
  felicitations: "Tableau d’honneur · Félicitations",
  excellence: "Tableau d’honneur · Excellence",
};

export function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function uniqueStrings(values: unknown, fallback: string[]) {
  if (!Array.isArray(values)) return [...fallback];
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
}

export function normalizeDistinctionSettings(raw: unknown): DistinctionSettings {
  const source = raw && typeof raw === "object" ? (raw as any) : {};
  const students = source.students && typeof source.students === "object" ? source.students : {};
  const tiers = students.tiers && typeof students.tiers === "object" ? students.tiers : {};
  const teachers = source.teachers && typeof source.teachers === "object" ? source.teachers : {};

  return {
    version: 1,
    students: {
      tiers: {
        encouragement: {
          average_min: clampNumber(
            tiers.encouragement?.average_min,
            0,
            20,
            DEFAULT_DISTINCTION_SETTINGS.students.tiers.encouragement.average_min,
          ),
          conduct_min: clampNumber(
            tiers.encouragement?.conduct_min,
            0,
            20,
            DEFAULT_DISTINCTION_SETTINGS.students.tiers.encouragement.conduct_min,
          ),
        },
        felicitations: {
          average_min: clampNumber(
            tiers.felicitations?.average_min,
            0,
            20,
            DEFAULT_DISTINCTION_SETTINGS.students.tiers.felicitations.average_min,
          ),
          conduct_min: clampNumber(
            tiers.felicitations?.conduct_min,
            0,
            20,
            DEFAULT_DISTINCTION_SETTINGS.students.tiers.felicitations.conduct_min,
          ),
        },
        excellence: {
          average_min: clampNumber(
            tiers.excellence?.average_min,
            0,
            20,
            DEFAULT_DISTINCTION_SETTINGS.students.tiers.excellence.average_min,
          ),
          conduct_min: clampNumber(
            tiers.excellence?.conduct_min,
            0,
            20,
            DEFAULT_DISTINCTION_SETTINGS.students.tiers.excellence.conduct_min,
          ),
        },
      },
      require_complete_grades:
        typeof students.require_complete_grades === "boolean"
          ? students.require_complete_grades
          : DEFAULT_DISTINCTION_SETTINGS.students.require_complete_grades,
      independent_absence_limit_enabled:
        typeof students.independent_absence_limit_enabled === "boolean"
          ? students.independent_absence_limit_enabled
          : DEFAULT_DISTINCTION_SETTINGS.students.independent_absence_limit_enabled,
      max_absence_count: Math.round(
        clampNumber(
          students.max_absence_count,
          0,
          500,
          DEFAULT_DISTINCTION_SETTINGS.students.max_absence_count,
        ),
      ),
      min_family_subjects: Math.round(
        clampNumber(
          students.min_family_subjects,
          1,
          20,
          DEFAULT_DISTINCTION_SETTINGS.students.min_family_subjects,
        ),
      ),
      science_subject_ids: uniqueStrings(students.science_subject_ids, []),
      literature_subject_ids: uniqueStrings(students.literature_subject_ids, []),
      science_keywords: uniqueStrings(
        students.science_keywords,
        DEFAULT_DISTINCTION_SETTINGS.students.science_keywords,
      ),
      literature_keywords: uniqueStrings(
        students.literature_keywords,
        DEFAULT_DISTINCTION_SETTINGS.students.literature_keywords,
      ),
    },
    teachers: {
      // Les poids enseignants sont volontairement fixes. Une donnée absente n'est
      // jamais redistribuée vers les autres critères.
      weights: { ...STRICT_TEACHER_WEIGHTS },
      evaluations_target_per_class: Math.round(
        clampNumber(
          teachers.evaluations_target_per_class,
          1,
          20,
          DEFAULT_DISTINCTION_SETTINGS.teachers.evaluations_target_per_class,
        ),
      ),
      minimum_published_evaluations_per_class: Math.round(
        clampNumber(
          teachers.minimum_published_evaluations_per_class,
          0,
          20,
          DEFAULT_DISTINCTION_SETTINGS.teachers.minimum_published_evaluations_per_class,
        ),
      ),
      minimum_evaluation_note_coverage_rate: clampNumber(
        teachers.minimum_evaluation_note_coverage_rate,
        0,
        100,
        DEFAULT_DISTINCTION_SETTINGS.teachers.minimum_evaluation_note_coverage_rate,
      ),
      minimum_class_evaluation_compliance_rate: clampNumber(
        teachers.minimum_class_evaluation_compliance_rate,
        0,
        100,
        DEFAULT_DISTINCTION_SETTINGS.teachers.minimum_class_evaluation_compliance_rate,
      ),
      minimum_teacher_attendance_observations: Math.round(
        clampNumber(
          teachers.minimum_teacher_attendance_observations,
          1,
          1000,
          DEFAULT_DISTINCTION_SETTINGS.teachers.minimum_teacher_attendance_observations,
        ),
      ),
      minimum_teacher_attendance_coverage_rate: clampNumber(
        teachers.minimum_teacher_attendance_coverage_rate,
        0,
        100,
        DEFAULT_DISTINCTION_SETTINGS.teachers.minimum_teacher_attendance_coverage_rate,
      ),
      minimum_textbook_session_coverage_rate: clampNumber(
        teachers.minimum_textbook_session_coverage_rate,
        0,
        100,
        DEFAULT_DISTINCTION_SETTINGS.teachers.minimum_textbook_session_coverage_rate,
      ),
      minimum_student_attendance_sessions: Math.round(
        clampNumber(
          teachers.minimum_student_attendance_sessions,
          1,
          1000,
          DEFAULT_DISTINCTION_SETTINGS.teachers.minimum_student_attendance_sessions,
        ),
      ),
      minimum_student_attendance_coverage_rate: clampNumber(
        teachers.minimum_student_attendance_coverage_rate,
        0,
        100,
        DEFAULT_DISTINCTION_SETTINGS.teachers.minimum_student_attendance_coverage_rate,
      ),
      punctuality_tolerance_minutes: Math.round(
        clampNumber(
          teachers.punctuality_tolerance_minutes,
          0,
          120,
          DEFAULT_DISTINCTION_SETTINGS.teachers.punctuality_tolerance_minutes,
        ),
      ),
      minimum_score: clampNumber(
        teachers.minimum_score,
        75,
        75,
        DEFAULT_DISTINCTION_SETTINGS.teachers.minimum_score,
      ),
    },
  };
}

export function validateDistinctionSettings(settings: DistinctionSettings) {
  const errors: string[] = [];
  const tiers = settings.students.tiers;
  if (
    tiers.encouragement.average_min > tiers.felicitations.average_min ||
    tiers.felicitations.average_min > tiers.excellence.average_min
  ) {
    errors.push("Les seuils de moyenne doivent augmenter d’Encouragement vers Excellence.");
  }
  if (
    tiers.encouragement.conduct_min > tiers.felicitations.conduct_min ||
    tiers.felicitations.conduct_min > tiers.excellence.conduct_min
  ) {
    errors.push("Les seuils de conduite doivent augmenter d’Encouragement vers Excellence.");
  }
  const totalTeacherWeight = Object.values(settings.teachers.weights).reduce(
    (sum, value) => sum + Number(value || 0),
    0,
  );
  if (Math.abs(totalTeacherWeight - 100) > 0.001) {
    errors.push("Les poids stricts des distinctions enseignants doivent totaliser exactement 100 points.");
  }
  if (
    settings.teachers.minimum_published_evaluations_per_class >
    settings.teachers.evaluations_target_per_class
  ) {
    errors.push("Le minimum d’évaluations publiées par classe ne peut pas dépasser l’objectif maximal.");
  }
  const overlappingSubjectIds = settings.students.science_subject_ids.filter((subjectId) =>
    settings.students.literature_subject_ids.includes(subjectId),
  );
  if (overlappingSubjectIds.length > 0) {
    errors.push("Une même matière ne peut pas être classée simultanément en sciences et en littérature.");
  }
  return errors;
}

export function normalizeSearchToken(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function subjectBelongsToFamily(
  subject: { subject_id?: string | null; subject_name?: string | null },
  family: "science" | "literature",
  settings: StudentDistinctionSettings,
) {
  const explicitIds =
    family === "science" ? settings.science_subject_ids : settings.literature_subject_ids;
  const subjectId = String(subject.subject_id ?? "").trim();

  if (explicitIds.length > 0) return !!subjectId && explicitIds.includes(subjectId);

  const label = normalizeSearchToken(subject.subject_name);
  const keywords = family === "science" ? settings.science_keywords : settings.literature_keywords;
  return keywords.some((keyword) => {
    const normalized = normalizeSearchToken(keyword);
    return normalized.length > 0 && label.includes(normalized);
  });
}

export function getEligibleTier(
  average: number,
  conduct: number,
  settings: StudentDistinctionSettings,
): DistinctionTier | null {
  const ordered: DistinctionTier[] = ["excellence", "felicitations", "encouragement"];
  for (const tier of ordered) {
    const rule = settings.tiers[tier];
    if (average >= rule.average_min && conduct >= rule.conduct_min) return tier;
  }
  return null;
}

export type StudentEligibilityInput = {
  average: number | null;
  conduct: number | null;
  coverageComplete?: boolean | null;
  absenceCount?: number | null;
};

export type StudentEligibilityResult = {
  status: "eligible" | "review" | "ineligible";
  tier: DistinctionTier | null;
  reasons: string[];
};

export function evaluateStudentEligibility(
  input: StudentEligibilityInput,
  settings: StudentDistinctionSettings,
): StudentEligibilityResult {
  const reasons: string[] = [];
  const average =
    input.average == null
      ? Number.NaN
      : Number(input.average);
  const conduct =
    input.conduct == null
      ? Number.NaN
      : Number(input.conduct);

  if (!Number.isFinite(average)) reasons.push("Moyenne académique indisponible");
  if (!Number.isFinite(conduct)) reasons.push("Moyenne de conduite indisponible");

  if (settings.require_complete_grades && input.coverageComplete === false) {
    reasons.push("Notes de la période incomplètes");
  }

  if (
    settings.independent_absence_limit_enabled &&
    input.absenceCount !== null &&
    input.absenceCount !== undefined &&
    Number.isFinite(Number(input.absenceCount)) &&
    Number(input.absenceCount) > settings.max_absence_count
  ) {
    reasons.push(
      `${Number(input.absenceCount)} absence(s), limite fixée à ${settings.max_absence_count}`,
    );
  }

  if (!Number.isFinite(average) || !Number.isFinite(conduct)) {
    return { status: "review", tier: null, reasons };
  }

  const tier = getEligibleTier(average, conduct, settings);
  if (!tier) {
    const base = settings.tiers.encouragement;
    if (average < base.average_min) {
      reasons.push(`Moyenne ${average.toFixed(2)}/20, minimum ${base.average_min}/20`);
    }
    if (conduct < base.conduct_min) {
      reasons.push(`Conduite ${conduct.toFixed(2)}/20, minimum ${base.conduct_min}/20`);
    }
  }

  if (reasons.length > 0) {
    const onlyReviewReasons = reasons.every((reason) =>
      reason.includes("indisponible") || reason.includes("incomplètes"),
    );
    return {
      status: onlyReviewReasons ? "review" : "ineligible",
      tier: null,
      reasons,
    };
  }

  return { status: "eligible", tier, reasons: [] };
}

export type TeacherMetricInput = {
  evaluation_regularity_rate: number;
  note_coverage_rate: number;
  pedagogical_mean_score_rate: number;
  success_rate_score_rate: number;
  attendance_rate: number;
  punctuality_rate: number;
  textbook_rate: number;
  progression_rate: number;
  student_presence_score_rate: number;
};

/**
 * Calcule un score strict sur 100 sans renormalisation.
 * Chaque critère conserve son poids fixe, même quand une donnée est absente.
 * L'appelant ne doit produire un score final que lorsque toutes les familles
 * obligatoires sont réellement calculables.
 */
export function computeTeacherScore(
  metrics: TeacherMetricInput,
  settings: TeacherDistinctionSettings,
) {
  const weights = settings.weights;
  const points =
    (clampNumber(metrics.evaluation_regularity_rate, 0, 100, 0) / 100) *
      weights.evaluation_regularity +
    (clampNumber(metrics.note_coverage_rate, 0, 100, 0) / 100) * weights.note_coverage +
    (clampNumber(metrics.pedagogical_mean_score_rate, 0, 100, 0) / 100) *
      weights.pedagogical_mean +
    (clampNumber(metrics.success_rate_score_rate, 0, 100, 0) / 100) * weights.success_rate +
    (clampNumber(metrics.attendance_rate, 0, 100, 0) / 100) * weights.attendance +
    (clampNumber(metrics.punctuality_rate, 0, 100, 0) / 100) * weights.punctuality +
    (clampNumber(metrics.textbook_rate, 0, 100, 0) / 100) * weights.textbook +
    (clampNumber(metrics.progression_rate, 0, 100, 0) / 100) * weights.progression +
    (clampNumber(metrics.student_presence_score_rate, 0, 100, 0) / 100) *
      weights.student_presence;

  return Math.round(points * 10) / 10;
}

export type DistinctionInstitutionMeta = {
  id?: string | null;
  name?: string | null;
  code_unique?: string | null;
  acronym?: string | null;
};

const CSCA_INSTITUTION_IDS = new Set(["ee34ab2a-8033-4e0b-acf0-05979cce1697"]);

export function isCSCAForDistinctions(meta: DistinctionInstitutionMeta | null | undefined) {
  if (!meta) return false;
  const id = String(meta.id || "").trim();
  if (CSCA_INSTITUTION_IDS.has(id)) return true;
  const token = normalizeSearchToken(`${meta.name || ""} ${meta.code_unique || ""} ${meta.acronym || ""}`).replace(/\s+/g, "");
  return (
    token.includes("csca") ||
    (token.includes("courssecondairecatholique") && token.includes("aboisso"))
  );
}

export function getInstitutionDefaultDistinctionSettings(
  meta: DistinctionInstitutionMeta | null | undefined,
): DistinctionSettings {
  const defaults = normalizeDistinctionSettings(DEFAULT_DISTINCTION_SETTINGS);
  if (!isCSCAForDistinctions(meta)) return defaults;

  return {
    ...defaults,
    students: {
      ...defaults.students,
      tiers: {
        encouragement: { average_min: 14, conduct_min: 14 },
        felicitations: { average_min: 15, conduct_min: 15 },
        excellence: { average_min: 16, conduct_min: 16 },
      },
    },
  };
}
