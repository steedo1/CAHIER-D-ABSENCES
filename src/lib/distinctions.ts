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
    attendance: number;
    punctuality: number;
    evaluations: number;
    textbook: number;
    digital_engagement: number;
  };
  minimum_sessions: number;
  minimum_evaluations: number;
  punctuality_tolerance_minutes: number;
  minimum_score: number;
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
    weights: {
      attendance: 20,
      punctuality: 15,
      evaluations: 30,
      textbook: 20,
      digital_engagement: 15,
    },
    minimum_sessions: 3,
    minimum_evaluations: 1,
    punctuality_tolerance_minutes: 15,
    minimum_score: 60,
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
  const weights = teachers.weights && typeof teachers.weights === "object" ? teachers.weights : {};

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
      weights: {
        attendance: clampNumber(
          weights.attendance,
          0,
          100,
          DEFAULT_DISTINCTION_SETTINGS.teachers.weights.attendance,
        ),
        punctuality: clampNumber(
          weights.punctuality,
          0,
          100,
          DEFAULT_DISTINCTION_SETTINGS.teachers.weights.punctuality,
        ),
        evaluations: clampNumber(
          weights.evaluations,
          0,
          100,
          DEFAULT_DISTINCTION_SETTINGS.teachers.weights.evaluations,
        ),
        textbook: clampNumber(
          weights.textbook,
          0,
          100,
          DEFAULT_DISTINCTION_SETTINGS.teachers.weights.textbook,
        ),
        digital_engagement: clampNumber(
          weights.digital_engagement,
          0,
          100,
          DEFAULT_DISTINCTION_SETTINGS.teachers.weights.digital_engagement,
        ),
      },
      minimum_sessions: Math.round(
        clampNumber(
          teachers.minimum_sessions,
          0,
          1000,
          DEFAULT_DISTINCTION_SETTINGS.teachers.minimum_sessions,
        ),
      ),
      minimum_evaluations: Math.round(
        clampNumber(
          teachers.minimum_evaluations,
          0,
          500,
          DEFAULT_DISTINCTION_SETTINGS.teachers.minimum_evaluations,
        ),
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
        0,
        100,
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
  if (totalTeacherWeight <= 0) {
    errors.push("Au moins un critère enseignant doit avoir un poids supérieur à zéro.");
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
  attendance_rate: number;
  punctuality_rate: number;
  evaluation_publication_rate: number;
  textbook_completion_rate: number;
  digital_engagement_rate: number;
};

export function computeTeacherScore(
  metrics: TeacherMetricInput,
  settings: TeacherDistinctionSettings,
) {
  const weights = settings.weights;
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0);
  if (totalWeight <= 0) return 0;

  const weighted =
    clampNumber(metrics.attendance_rate, 0, 100, 0) * weights.attendance +
    clampNumber(metrics.punctuality_rate, 0, 100, 0) * weights.punctuality +
    clampNumber(metrics.evaluation_publication_rate, 0, 100, 0) * weights.evaluations +
    clampNumber(metrics.textbook_completion_rate, 0, 100, 0) * weights.textbook +
    clampNumber(metrics.digital_engagement_rate, 0, 100, 0) * weights.digital_engagement;

  return Math.round((weighted / totalWeight) * 10) / 10;
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
