export type MonCahierAiIntent =
  | "students_to_follow"
  | "class_decline_risk"
  | "blocking_subjects"
  | "school_summary"
  | "council_note"
  | "remediation_plan"
  | "quick_stats"
  | "general_analysis";

export type RiskLevel = "low" | "medium" | "high";

export type AiStudentSignal = {
  student_id: string;
  full_name: string;
  matricule?: string | null;
  class_id: string;
  class_label: string;
  class_level?: string | null;
  general_avg_20: number | null;
  core_avg_20?: number | null;
  presence_rate?: number | null;
  total_absent_hours?: number | null;
  nb_lates?: number | null;
  conduct_total_20?: number | null;
  p_success: number | null;
  risk_level: RiskLevel;
  priority_score: number;
  reasons: string[];
};

export type AiClassSignal = {
  class_id: string;
  class_label: string;
  class_level?: string | null;
  students_count: number;
  avg_success_probability: number | null;
  avg_general_20: number | null;
  high_risk_count: number;
  medium_risk_count: number;
  low_risk_count: number;
  risk_index: number;
  main_reasons: string[];
};

export type AiSubjectWeakStudent = {
  student_id: string;
  full_name: string;
  matricule?: string | null;
  avg_score_20: number | null;
  general_avg_20?: number | null;
};

export type AiSubjectSignal = {
  class_id: string;
  class_label: string;
  class_level?: string | null;
  subject_id: string;
  subject_name: string;
  evaluations_count: number;
  notes_count: number;
  avg_score_20: number | null;
  weak_students_count: number;
  blocker_score: number;
  alert_level?: "blocking" | "watch" | "ok";
  alert_label?: string;
  weak_students?: AiSubjectWeakStudent[];
  remediation_actions?: string[];
};

export type AiDataQualityStatus = "ok" | "partial" | "missing";

export type AiDataQualityItem = {
  key: string;
  label: string;
  status: AiDataQualityStatus;
  score: number;
  details: string;
};

export type AiDataQuality = {
  score: number;
  status: AiDataQualityStatus;
  summary: string;
  items: AiDataQualityItem[];
};

export type AiQuickStat = {
  key: string;
  label: string;
  value: string;
  details?: string;
  tone?: "neutral" | "good" | "warning" | "danger";
};

export type AiQuickStats = {
  scope_label: string;
  scope_note?: string;
  cards: AiQuickStat[];
  breakdown?: Array<{ label: string; value: string; details?: string }>;
};

export type AiScopeStats = {
  active_label: string;
  is_filtered: boolean;
  selected_class_label?: string | null;
  selected_level?: string | null;
  total_classes_count?: number | null;
  classes_by_level?: Array<{ level: string; count: number }>;
};

export type AiProgramProgressionSignal = {
  class_id: string;
  class_label: string;
  class_level?: string | null;
  subject_id?: string | null;
  subject_name: string;
  progression_title?: string | null;
  expected_items: number;
  completed_items: number;
  completion_rate: number;
  sessions_count: number;
  source: "textbook" | "manual";
};

export type MonCahierAiContext = {
  institution_id: string;
  academic_year: string;
  exam_date: string;
  model_key: string;
  model_version: string;
  model_source: "rules_baseline" | "ml_service" | "hybrid";
  classes: AiClassSignal[];
  students: AiStudentSignal[];
  subjects: AiSubjectSignal[];
  warnings: string[];
  data_quality?: AiDataQuality;
  scope_stats?: AiScopeStats;
  progressions?: AiProgramProgressionSignal[];
};

export type MonCahierAiAnswer = {
  intent: MonCahierAiIntent;
  title: string;
  summary: string;
  confidence: number;
  recommendations: string[];
  students_to_follow: AiStudentSignal[];
  classes_at_risk: AiClassSignal[];
  blocking_subjects: AiSubjectSignal[];
  council_note?: string;
  remediation_plan?: string[];
  quick_stats?: AiQuickStats;
  model: {
    key: string;
    version: string;
    source: MonCahierAiContext["model_source"];
  };
  ethics_notice: string;
};

const STOPWORDS = new Set([
  "les",
  "des",
  "une",
  "un",
  "dans",
  "pour",
  "avant",
  "avec",
  "qui",
  "quoi",
  "quel",
  "quelle",
  "quelles",
  "quels",
  "classe",
  "eleves",
  "élèves",
  "matiere",
  "matières",
  "matieres",
  "situation",
  "pedagogique",
  "pédagogique",
]);

export function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function round1(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 10) / 10;
}

export function round2(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 100) / 100;
}

export function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

export function scorePct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${Math.round(Number(value))}%`;
}

export function formatAvg(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${round2(Number(value))?.toString().replace(".", ",")}/20`;
}

export function classifySubjectSignal(subject: {
  avg_score_20?: number | null;
  weak_students_count?: number | null;
  blocker_score?: number | null;
}): { alert_level: "blocking" | "watch" | "ok"; alert_label: string } {
  const avg = subject.avg_score_20 == null ? null : Number(subject.avg_score_20);
  const weak = subject.weak_students_count == null ? 0 : Number(subject.weak_students_count);
  const score = subject.blocker_score == null ? 0 : Number(subject.blocker_score);

  // Une matière sans moyenne exploitable ne doit jamais être transformée
  // automatiquement en vigilance. Absence de donnée ≠ difficulté pédagogique.
  if (avg == null && weak <= 0) {
    return { alert_level: "ok", alert_label: "Données insuffisantes" };
  }

  if (score >= 45 || (avg != null && avg < 10) || weak >= 3) {
    return { alert_level: "blocking", alert_label: "Bloquante" };
  }

  // Vigilance seulement s'il existe un vrai signal exploitable :
  // moyenne proche du seuil, élèves sous 10, ou score construit non nul.
  if (score >= 20 || (avg != null && avg >= 10 && avg < 13.5) || weak > 0) {
    return { alert_level: "watch", alert_label: "Vigilance" };
  }

  return { alert_level: "ok", alert_label: "Stable" };
}


function computeSubjectAlertScore(
  subject: { avg_score_20?: number | null; weak_students_count?: number | null; blocker_score?: number | null },
  alert: { alert_level: "blocking" | "watch" | "ok" },
): number {
  const existing = subject.blocker_score == null ? 0 : Number(subject.blocker_score);
  const avg = subject.avg_score_20 == null ? null : Number(subject.avg_score_20);
  const weak = subject.weak_students_count == null ? 0 : Number(subject.weak_students_count);

  if (alert.alert_level === "ok") return Math.max(0, Math.round(existing));

  let computed = Math.max(0, existing);

  if (avg != null && Number.isFinite(avg)) {
    if (avg < 10) computed = Math.max(computed, 45 + (10 - avg) * 8);
    else if (avg < 12) computed = Math.max(computed, 12 + (12 - avg) * 8);
    else if (avg < 13.5) computed = Math.max(computed, 5 + (13.5 - avg) * 4);
  }

  if (weak > 0) computed = Math.max(computed, 8 + weak * 8);

  if (alert.alert_level === "blocking") return clamp(Math.round(computed), 45, 100);
  if (alert.alert_level === "watch") return clamp(Math.round(computed), 1, 44);
  return Math.round(computed);
}

export function cleanText(input: unknown): string {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


export function isQuickStatsQuestion(cleanedQuestion: string): boolean {
  const q = cleanText(cleanedQuestion);
  if (!q) return false;

  const asksCount =
    q.includes("combien") ||
    q.includes("nombre") ||
    q.includes("total") ||
    q.includes("effectif") ||
    q.includes("statistique") ||
    q.includes("statistiques") ||
    q.includes("repartition") ||
    q.includes("repartis") ||
    q.includes("avons nous") ||
    q.includes("avons-nous");

  if (!asksCount) return false;

  return (
    q.includes("classe") ||
    q.includes("classes") ||
    q.includes("niveau") ||
    q.includes("niveaux") ||
    q.includes("eleve") ||
    q.includes("eleves") ||
    q.includes("moyenne") ||
    q.includes("absence") ||
    q.includes("absences") ||
    q.includes("donnee") ||
    q.includes("donnees") ||
    q.includes("matiere") ||
    q.includes("matieres")
  );
}

export function inferIntent(question: string): MonCahierAiIntent {
  const q = cleanText(question);

  if (!q) return "school_summary";

  if (isQuickStatsQuestion(q)) {
    return "quick_stats";
  }

  if (
    q.includes("remediation") ||
    q.includes("remediat") ||
    q.includes("plan") ||
    q.includes("soutien") ||
    q.includes("accompagnement")
  ) {
    return "remediation_plan";
  }

  if (
    q.includes("conseil") ||
    q.includes("note") ||
    q.includes("rapport") ||
    q.includes("preparer") ||
    q.includes("rediger")
  ) {
    return "council_note";
  }

  if (
    q.includes("matiere") ||
    q.includes("matieres") ||
    q.includes("bloque") ||
    q.includes("bloquent") ||
    q.includes("faible") ||
    q.includes("discipline")
  ) {
    return "blocking_subjects";
  }

  if (
    q.includes("classe") &&
    (q.includes("risque") || q.includes("baisse") || q.includes("chute") || q.includes("fragile"))
  ) {
    return "class_decline_risk";
  }

  if (
    q.includes("eleve") ||
    q.includes("eleves") ||
    q.includes("suivre") ||
    q.includes("suivi") ||
    q.includes("bepc") ||
    q.includes("bac") ||
    q.includes("examen")
  ) {
    return "students_to_follow";
  }

  if (
    q.includes("resume") ||
    q.includes("resumer") ||
    q.includes("situation") ||
    q.includes("etablissement") ||
    q.includes("ecole") ||
    q.includes("global")
  ) {
    return "school_summary";
  }

  return "general_analysis";
}

export function extractLevelHint(question: string): string | null {
  const q = cleanText(question);
  const patterns = [
    /\b(6e|5e|4e|3e|2nde|2de|1ere|1re|tle|terminale)\b/,
    /\b(sixieme|cinquieme|quatrieme|troisieme|seconde|premiere|terminale)\b/,
  ];

  for (const pattern of patterns) {
    const match = q.match(pattern);
    if (match?.[1]) return match[1];
  }

  if (q.includes("bepc")) return "3e";
  if (q.includes("bac")) return "tle";
  return null;
}

export function levelMatches(level: string | null | undefined, hint: string | null): boolean {
  if (!hint) return true;
  const l = cleanText(level || "");
  const h = cleanText(hint);

  if (!l) return false;
  if (l.includes(h)) return true;

  const aliases: Record<string, string[]> = {
    "6e": ["6", "sixieme"],
    "5e": ["5", "cinquieme"],
    "4e": ["4", "quatrieme"],
    "3e": ["3", "troisieme"],
    "2nde": ["2", "2de", "seconde"],
    "2de": ["2", "2nde", "seconde"],
    "1re": ["1", "1ere", "premiere"],
    "1ere": ["1", "1re", "premiere"],
    tle: ["tle", "terminale", "t"],
    terminale: ["tle", "terminale", "t"],
  };

  const targets = aliases[h] || [h];
  return targets.some((target) => l.includes(target));
}

export function getRiskLevel(pSuccess: number | null | undefined): RiskLevel {
  const p = Number(pSuccess);
  if (!Number.isFinite(p)) return "medium";
  if (p < 0.45) return "high";
  if (p < 0.7) return "medium";
  return "low";
}

export function buildStudentReasons(row: {
  general_avg_20?: number | null;
  core_avg_20?: number | null;
  presence_rate?: number | null;
  total_absent_hours?: number | null;
  nb_lates?: number | null;
  conduct_total_20?: number | null;
  p_success?: number | null;
}): string[] {
  const reasons: string[] = [];

  if (row.general_avg_20 == null) {
    reasons.push("moyenne bulletin officielle indisponible");
  }

  if (row.p_success != null && Number(row.p_success) < 0.45) {
    reasons.push(`indice de réussite faible (${pct(row.p_success)})`);
  } else if (row.p_success != null && Number(row.p_success) < 0.7) {
    reasons.push(`indice de réussite fragile (${pct(row.p_success)})`);
  }

  if (row.general_avg_20 != null && Number(row.general_avg_20) < 10) {
    reasons.push(`moyenne générale sous 10/20 (${formatAvg(row.general_avg_20)})`);
  } else if (row.general_avg_20 != null && Number(row.general_avg_20) < 12) {
    reasons.push(`moyenne générale encore fragile (${formatAvg(row.general_avg_20)})`);
  }

  if (row.core_avg_20 != null && Number(row.core_avg_20) < 10) {
    reasons.push(`matières clés insuffisantes (${formatAvg(row.core_avg_20)})`);
  }

  if (row.presence_rate != null && Number(row.presence_rate) < 0.85) {
    reasons.push(`assiduité faible (${pct(row.presence_rate)})`);
  }

  if (row.total_absent_hours != null && Number(row.total_absent_hours) >= 12) {
    reasons.push(`${round1(Number(row.total_absent_hours))} h d’absence`);
  }

  if (row.nb_lates != null && Number(row.nb_lates) >= 5) {
    reasons.push(`${Number(row.nb_lates)} retards`);
  }

  if (row.conduct_total_20 != null && Number(row.conduct_total_20) < 10) {
    reasons.push(`conduite à surveiller (${formatAvg(row.conduct_total_20)})`);
  }

  return reasons.slice(0, 5);
}

export function computePriorityScore(row: {
  p_success?: number | null;
  general_avg_20?: number | null;
  core_avg_20?: number | null;
  presence_rate?: number | null;
  conduct_total_20?: number | null;
  total_absent_hours?: number | null;
  nb_lates?: number | null;
}): number {
  const p = row.p_success == null ? 0.55 : clamp(Number(row.p_success), 0, 1);
  const avg = row.general_avg_20 == null ? 10 : clamp(Number(row.general_avg_20), 0, 20);
  const core = row.core_avg_20 == null ? avg : clamp(Number(row.core_avg_20), 0, 20);
  const presence = row.presence_rate == null ? 0.9 : clamp(Number(row.presence_rate), 0, 1);
  const conduct = row.conduct_total_20 == null ? 14 : clamp(Number(row.conduct_total_20), 0, 20);
  const abs = row.total_absent_hours == null ? 0 : Math.max(0, Number(row.total_absent_hours));
  const lates = row.nb_lates == null ? 0 : Math.max(0, Number(row.nb_lates));

  const riskFromPrediction = (1 - p) * 45;
  const riskFromAvg = Math.max(0, (12 - avg) / 12) * 20;
  const riskFromCore = Math.max(0, (12 - core) / 12) * 15;
  const riskFromPresence = Math.max(0, (0.92 - presence) / 0.92) * 10;
  const riskFromConduct = Math.max(0, (12 - conduct) / 12) * 5;
  const riskFromBehavior = Math.min(5, abs / 6 + lates / 3);

  return Math.round(
    clamp(
      riskFromPrediction +
        riskFromAvg +
        riskFromCore +
        riskFromPresence +
        riskFromConduct +
        riskFromBehavior,
      0,
      100,
    ),
  );
}

export function summarizeClassReasons(cls: AiClassSignal): string[] {
  const reasons: string[] = [];

  if (cls.avg_success_probability != null && cls.avg_success_probability < 0.55) {
    reasons.push(`indice moyen de préparation faible (${scorePct(cls.avg_success_probability * 100)})`);
  } else if (cls.avg_success_probability != null && cls.avg_success_probability < 0.7) {
    reasons.push(`préparation moyenne encore fragile (${scorePct(cls.avg_success_probability * 100)})`);
  }

  if (cls.avg_general_20 != null && cls.avg_general_20 < 10) {
    reasons.push(`moyenne générale de classe sous 10/20 (${formatAvg(cls.avg_general_20)})`);
  } else if (cls.avg_general_20 != null && cls.avg_general_20 < 12) {
    reasons.push(`moyenne générale de classe fragile (${formatAvg(cls.avg_general_20)})`);
  }

  if (cls.high_risk_count > 0) {
    reasons.push(`${cls.high_risk_count} élève${cls.high_risk_count > 1 ? "s" : ""} en suivi prioritaire`);
  }

  if (cls.medium_risk_count > cls.low_risk_count) {
    reasons.push("plus d’élèves fragiles que d’élèves sécurisés");
  }

  return reasons.slice(0, 4);
}

function topKeywords(question: string) {
  return cleanText(question)
    .split(" ")
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

export function selectContextByQuestion(context: MonCahierAiContext, question: string) {
  const levelHint = extractLevelHint(question);
  const keywords = topKeywords(question);

  const matchingClasses = context.classes.filter((cls) => {
    if (!levelMatches(cls.class_level, levelHint)) return false;
    if (!keywords.length) return true;
    const hay = cleanText(`${cls.class_label} ${cls.class_level || ""}`);
    return keywords.some((kw) => hay.includes(kw)) || levelHint !== null;
  });

  const classIds = new Set(
    (matchingClasses.length ? matchingClasses : context.classes).map((c) => c.class_id),
  );

  return {
    levelHint,
    classes: (matchingClasses.length ? matchingClasses : context.classes).slice(0, 80),
    students: context.students.filter((s) => classIds.has(s.class_id)),
    subjects: context.subjects.filter((s) => classIds.has(s.class_id)),
  };
}

function buildScopeLabel(scoped: ReturnType<typeof selectContextByQuestion>): string | null {
  if (scoped.classes.length === 1) return scoped.classes[0].class_label;
  if (scoped.levelHint) return scoped.levelHint.toUpperCase();
  return null;
}

function selectProgressionsForScope(
  context: MonCahierAiContext,
  scoped: ReturnType<typeof selectContextByQuestion>,
): AiProgramProgressionSignal[] {
  const classIds = new Set(scoped.classes.map((cls) => cls.class_id));
  return (context.progressions || []).filter((item) => classIds.has(item.class_id));
}

function averageProgressionRate(items: AiProgramProgressionSignal[]): number | null {
  if (!items.length) return null;
  const usable = items.filter((item) => Number.isFinite(Number(item.completion_rate)));
  if (!usable.length) return null;
  return round1(usable.reduce((acc, item) => acc + Number(item.completion_rate), 0) / usable.length);
}

function weakestProgressions(items: AiProgramProgressionSignal[], limit = 3): AiProgramProgressionSignal[] {
  return [...items]
    .filter((item) => Number.isFinite(Number(item.completion_rate)))
    .sort((a, b) => Number(a.completion_rate) - Number(b.completion_rate))
    .slice(0, limit);
}

function isBroadScope(scoped: ReturnType<typeof selectContextByQuestion>): boolean {
  return scoped.classes.length > 1;
}

function scopeDisplayName(scoped: ReturnType<typeof selectContextByQuestion>): string {
  if (scoped.classes.length === 1) return scoped.classes[0].class_label;
  if (scoped.levelHint) return `niveau ${scoped.levelHint.toUpperCase()}`;
  return "Établissement";
}

function scopeSubjectLabel(scoped: ReturnType<typeof selectContextByQuestion>): string {
  if (scoped.classes.length === 1) return "La classe";
  if (scoped.levelHint) return "Le niveau";
  return "L’établissement";
}

function filterActionableSubjectAlerts(
  subjects: AiSubjectSignal[],
  scoped: ReturnType<typeof selectContextByQuestion>,
): AiSubjectSignal[] {
  if (!isBroadScope(scoped)) return subjects;

  // En mode établissement/niveau, on évite d’encombrer la note et les cartes
  // avec de très faibles vigilances : moyenne correcte, aucun élève sous 10.
  // On garde les vrais signaux pédagogiques : bloquants, élèves faibles,
  // ou moyenne matière suffisamment proche du seuil pour mériter une action.
  return subjects.filter((subject) => {
    const avg = subject.avg_score_20 == null ? null : Number(subject.avg_score_20);
    return (
      subject.alert_level === "blocking" ||
      Number(subject.weak_students_count || 0) > 0 ||
      (avg != null && avg < 12)
    );
  });
}

function progressionCoverage(args: {
  scoped: ReturnType<typeof selectContextByQuestion>;
  progressions: AiProgramProgressionSignal[];
}): number {
  if (!args.scoped.classes.length) return 0;
  const classIdsWithProgression = new Set(args.progressions.map((item) => item.class_id));
  return classIdsWithProgression.size / Math.max(1, args.scoped.classes.length);
}

function pluralize(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value > 1 ? plural : singular}`;
}

function buildQuickStats(args: {
  context: MonCahierAiContext;
  scoped: ReturnType<typeof selectContextByQuestion>;
  question: string;
}): AiQuickStats {
  const q = cleanText(args.question);
  const classesCount = args.scoped.classes.length;
  const studentsCount = args.scoped.students.length;
  const subjectsCount = args.scoped.subjects.length;
  const classesWithStudents = args.scoped.classes.filter((cls) => cls.students_count > 0).length;
  const officialAveragesCount = args.scoped.students.filter((student) => student.general_avg_20 != null).length;
  const highRiskCount = args.scoped.students.filter((student) => student.risk_level === "high").length;
  const mediumRiskCount = args.scoped.students.filter((student) => student.risk_level === "medium").length;
  const activeLabel =
    args.context.scope_stats?.active_label ||
    buildScopeLabel(args.scoped) ||
    "périmètre sélectionné";

  const asksClasses = q.includes("classe") || q.includes("classes") || q.includes("niveau") || q.includes("niveaux");
  const asksStudents = q.includes("eleve") || q.includes("eleves") || q.includes("effectif");
  const asksMissing = q.includes("sans") || q.includes("manquant") || q.includes("manquante") || q.includes("donnee") || q.includes("donnees");

  const cards: AiQuickStat[] = [];

  if (asksClasses || (!asksStudents && !asksMissing)) {
    cards.push({
      key: "scope_classes",
      label: "Classes dans le périmètre actif",
      value: String(classesCount),
      details: `${classesWithStudents} classe${classesWithStudents > 1 ? "s" : ""} avec au moins un élève analysé.`,
      tone: classesCount ? "good" : "warning",
    });

    if (args.context.scope_stats?.total_classes_count != null) {
      cards.push({
        key: "year_classes",
        label: `Classes de l'année ${args.context.academic_year}`,
        value: String(args.context.scope_stats.total_classes_count),
        details: args.context.scope_stats.is_filtered
          ? "Le filtre actuel réduit l'analyse affichée. Ce total correspond à l'établissement sur l'année choisie."
          : "Total des classes chargées pour l'établissement sur l'année choisie.",
        tone: "neutral",
      });
    }
  }

  if (asksStudents || (!asksClasses && !asksMissing)) {
    cards.push({
      key: "scope_students",
      label: "Élèves analysés",
      value: String(studentsCount),
      details: `Dans ${activeLabel}.`,
      tone: studentsCount ? "good" : "warning",
    });
  }

  cards.push({
    key: "official_averages",
    label: "Moyennes bulletin trouvées",
    value: `${officialAveragesCount}/${studentsCount}`,
    details: studentsCount
      ? `${Math.round((officialAveragesCount / Math.max(1, studentsCount)) * 100)} % des élèves analysés ont une moyenne bulletin exploitable.`
      : "Aucun élève dans le périmètre actif.",
    tone: officialAveragesCount === studentsCount && studentsCount > 0 ? "good" : officialAveragesCount > 0 ? "warning" : "danger",
  });

  cards.push({
    key: "subjects",
    label: "Matières avec signaux",
    value: String(subjectsCount),
    details: "Matières détectées à partir des évaluations publiées et exploitables.",
    tone: subjectsCount ? "good" : "warning",
  });

  const progressionItems = selectProgressionsForScope(args.context, args.scoped);
  const progressionAvg = averageProgressionRate(progressionItems);
  if (progressionItems.length) {
    cards.push({
      key: "textbook_progression",
      label: "Progression cahier de textes",
      value: `${progressionAvg ?? 0}%`,
      details: `${progressionItems.length} progression${progressionItems.length > 1 ? "s" : ""} active${progressionItems.length > 1 ? "s" : ""} exploitée${progressionItems.length > 1 ? "s" : ""}.`,
      tone: progressionAvg == null ? "warning" : progressionAvg >= 75 ? "good" : progressionAvg >= 50 ? "neutral" : "warning",
    });
  }

  if (highRiskCount || mediumRiskCount) {
    cards.push({
      key: "followup",
      label: "Élèves à surveiller",
      value: String(highRiskCount + mediumRiskCount),
      details: `${highRiskCount} en suivi prioritaire et ${mediumRiskCount} en suivi renforcé.`,
      tone: highRiskCount ? "warning" : "neutral",
    });
  }

  const byLevel = args.context.scope_stats?.classes_by_level || [];
  const breakdown = byLevel.length
    ? byLevel.map((item) => ({
        label: item.level,
        value: String(item.count),
        details: `${pluralize(item.count, "classe")}.`,
      }))
    : undefined;

  return {
    scope_label: activeLabel,
    scope_note: args.context.scope_stats?.is_filtered
      ? "Attention : les filtres actuels limitent le périmètre. Pour obtenir le total général, choisir “Toutes les classes” et “Tous”."
      : "Périmètre général de l'année scolaire sélectionnée.",
    cards,
    breakdown,
  };
}

export function buildAiAnswer(context: MonCahierAiContext, question: string): MonCahierAiAnswer {
  const intent = inferIntent(question);
  const scoped = selectContextByQuestion(context, question);
  const scopeLabel = buildScopeLabel(scoped);

  const studentsSorted = [...scoped.students].sort((a, b) => b.priority_score - a.priority_score);
  const studentsToFollow = studentsSorted.filter((s) => s.priority_score >= 45).slice(0, 20);
  const classesAtRisk = [...scoped.classes]
    .filter((c) => c.students_count > 0 && c.risk_index >= 35)
    .sort((a, b) => b.risk_index - a.risk_index)
    .slice(0, 12);
  const allSubjectAlerts = [...scoped.subjects]
    .map((subject) => {
      const alert = classifySubjectSignal(subject);
      const enrichedSubject: AiSubjectSignal = {
        ...subject,
        ...alert,
        blocker_score: computeSubjectAlertScore(subject, alert),
      };
      return {
        ...enrichedSubject,
        remediation_actions: buildSubjectRemediationActions(enrichedSubject),
      };
    })
    .filter((subject) => subject.alert_level !== "ok")
    .sort((a, b) => b.blocker_score - a.blocker_score);
  const subjectAlerts = filterActionableSubjectAlerts(allSubjectAlerts, scoped).slice(0, 15);
  const blockers = subjectAlerts.filter((subject) => subject.alert_level === "blocking");
  const watchSubjects = subjectAlerts.filter((subject) => subject.alert_level === "watch");

  const totalStudents = scoped.students.length;
  const highRisk = scoped.students.filter((s) => s.risk_level === "high").length;
  const mediumRisk = scoped.students.filter((s) => s.risk_level === "medium").length;
  const avgSuccess =
    scoped.classes.length > 0
      ? scoped.classes.reduce((acc, cls) => acc + (cls.avg_success_probability ?? 0), 0) / scoped.classes.length
      : null;
  const scopedProgressions = selectProgressionsForScope(context, scoped);
  const avgTextbookProgression = averageProgressionRate(scopedProgressions);
  const weakTextbookProgressions = weakestProgressions(scopedProgressions, 3);

  const commonRecs = buildCommonRecommendations({
    studentsToFollow,
    classesAtRisk,
    blockers: subjectAlerts,
    totalStudents,
    highRisk,
    mediumRisk,
  });

  if (weakTextbookProgressions.length) {
    const weakest = weakTextbookProgressions[0];
    if (Number(weakest.completion_rate) < 50) {
      commonRecs.unshift(
        `Vérifier la progression en ${weakest.subject_name} (${weakest.class_label}) : ${weakest.completion_rate}% d’avancement dans le cahier de textes.`,
      );
    }
  }

  let title = "Analyse pédagogique Mon Cahier IA";
  let summary = "Mon Cahier IA a analysé les notes, l’assiduité, la conduite et les signaux de progression disponibles.";
  let recommendations = commonRecs;
  let council_note: string | undefined;
  let remediation_plan: string[] | undefined;
  let quick_stats: AiQuickStats | undefined;

  if (intent === "quick_stats") {
    quick_stats = buildQuickStats({ context, scoped, question });
    title = scopeLabel ? `Statistiques rapides — ${scopeLabel}` : "Statistiques rapides";
    summary = `Mon Cahier IA répond à la question statistique sur ${quick_stats.scope_label}. ${quick_stats.scope_note || ""}`.trim();
    recommendations = quick_stats.scope_note ? [quick_stats.scope_note] : [];
  } else if (intent === "students_to_follow") {
    title = scopeLabel ? `Élèves à suivre en ${scopeLabel}` : "Élèves à suivre en priorité";
    summary = studentsToFollow.length
      ? `${studentsToFollow.length} élève${studentsToFollow.length > 1 ? "s" : ""} ressortent en suivi prioritaire. Le classement est basé sur l’indice de réussite, les moyennes, les matières clés, l’assiduité et la conduite.`
      : "Aucun élève ne ressort actuellement en suivi prioritaire avec les données disponibles. Il faut tout de même surveiller les élèves moyens et les données manquantes.";
  } else if (intent === "class_decline_risk") {
    title = scopeLabel ? `Risque de baisse — ${scopeLabel}` : "Classes avec risque de baisse";
    summary = classesAtRisk.length
      ? `La classe la plus sensible est ${classesAtRisk[0].class_label}, avec un indice de risque de ${classesAtRisk[0].risk_index}/100. Les classes suivantes doivent être observées avant les prochains conseils.`
      : "Aucune classe ne ressort comme sensible avec le seuil actuel. Le suivi reste utile, mais les données disponibles ne justifient pas une alerte de risque.";
  } else if (intent === "blocking_subjects") {
    title = scopeLabel ? `Matières bloquantes / vigilance — ${scopeLabel}` : "Matières bloquantes / de vigilance";
    if (blockers.length) {
      summary = `Les matières bloquantes sont repérées à partir des moyennes par classe, du nombre d’évaluations et du volume d’élèves faibles. Première alerte critique : ${blockers[0].subject_name} en ${blockers[0].class_label}.`;
    } else if (watchSubjects.length) {
      summary = `Aucune matière bloquante critique n’est détectée. Mon Cahier IA signale toutefois ${watchSubjects.length} matière${watchSubjects.length > 1 ? "s" : ""} de vigilance à surveiller avant les prochains devoirs.`;
    } else {
      summary = "Aucune matière bloquante ni matière de vigilance claire n’a été détectée avec les notes publiées disponibles.";
    }
  } else if (intent === "school_summary" || intent === "general_analysis") {
    title = scopeLabel ? `Résumé pédagogique — ${scopeLabel}` : "Résumé de la situation pédagogique";
    summary = `Analyse de ${scoped.classes.length} classe${scoped.classes.length > 1 ? "s" : ""} et ${totalStudents} élève${totalStudents > 1 ? "s" : ""}. Indice moyen de préparation : ${avgSuccess == null ? "—" : pct(avgSuccess)}. ${highRisk} élève${highRisk > 1 ? "s" : ""} en suivi prioritaire et ${mediumRisk} en suivi renforcé.${avgTextbookProgression == null ? "" : ` Progression cahier de textes : ${avgTextbookProgression}%.`}`;
  } else if (intent === "council_note") {
    title = scopeLabel ? `Note préparatoire au conseil de classe — ${scopeLabel}` : "Note préparatoire au conseil de classe";
    council_note = buildCouncilNote({
      context,
      scoped,
      classesAtRisk,
      studentsToFollow,
      blockers: subjectAlerts,
      avgSuccess,
      progressions: scopedProgressions,
    });
    summary = "Voici une note structurée pour préparer le conseil de classe à partir des signaux pédagogiques disponibles.";
    recommendations = [
      "Relire la note avec le professeur principal avant diffusion.",
      "Valider les cas individuels avec l’éducateur de niveau et les enseignants concernés.",
      "Ne jamais utiliser l’indice IA comme sanction automatique : il sert à orienter l’accompagnement.",
    ];
  } else if (intent === "remediation_plan") {
    title = scopeLabel ? `Plan de remédiation ciblé — ${scopeLabel}` : "Plan de remédiation ciblé";
    remediation_plan = buildRemediationPlan({ studentsToFollow, classesAtRisk, blockers: subjectAlerts, allStudents: scoped.students });
    if (subjectAlerts.length) {
      const first = subjectAlerts[0];
      const weakNames = formatWeakStudentNames(first, 4);
      summary = weakNames
        ? `Le plan cible d’abord ${first.subject_name} en ${first.class_label}, avec les élèves concernés : ${weakNames}.`
        : `Le plan cible d’abord ${first.subject_name} en ${first.class_label}, puis les élèves prioritaires et le suivi de classe.`;
    } else {
      summary = "Le plan cible les élèves prioritaires, l’assiduité, la publication des notes et le suivi par l’équipe pédagogique.";
    }
    recommendations = buildRemediationSummaryRecommendations({
      studentsToFollow,
      classesAtRisk,
      blockers: subjectAlerts,
    });
  }

  const confidence = context.data_quality?.score ?? computeConfidence(context, scoped.classes.length, totalStudents);

  return {
    intent,
    title,
    summary,
    confidence,
    recommendations,
    students_to_follow: studentsToFollow,
    classes_at_risk: classesAtRisk,
    blocking_subjects: subjectAlerts,
    council_note,
    remediation_plan,
    quick_stats,
    model: {
      key: context.model_key,
      version: context.model_version,
      source: context.model_source,
    },
    ethics_notice:
      "Mon Cahier IA est un outil d’aide à la décision pédagogique. Il ne remplace pas l’appréciation de l’équipe éducative et ne doit jamais servir à sanctionner automatiquement un élève.",
  };
}

function computeConfidence(context: MonCahierAiContext, classesCount: number, studentsCount: number): number {
  let score = 40;
  if (classesCount >= 1) score += 10;
  if (studentsCount >= 20) score += 15;
  if (context.subjects.length >= 5) score += 10;
  if (context.model_source === "ml_service") score += 15;
  if (context.model_source === "hybrid") score += 12;
  if (context.warnings.length) score -= Math.min(20, context.warnings.length * 5);
  return clamp(Math.round(score), 20, 95);
}

function formatWeakStudentNames(subject: AiSubjectSignal, limit = 4): string {
  const weakStudents = (subject.weak_students || []).slice(0, limit);
  if (!weakStudents.length) return "";
  const names = weakStudents.map((student) => `${student.full_name} (${formatAvg(student.avg_score_20)})`);
  const remaining = Math.max(0, (subject.weak_students?.length || 0) - weakStudents.length);
  return `${names.join(", ")}${remaining > 0 ? `, +${remaining} autre${remaining > 1 ? "s" : ""}` : ""}`;
}

function getCriticalWeakStudents(subject: AiSubjectSignal, threshold = 8): AiSubjectWeakStudent[] {
  return (subject.weak_students || []).filter((student) => {
    const avg = student.avg_score_20 == null ? null : Number(student.avg_score_20);
    return avg != null && Number.isFinite(avg) && avg < threshold;
  });
}

function findStudentSignalForWeakStudent(weakStudent: AiSubjectWeakStudent, students: AiStudentSignal[]): AiStudentSignal | undefined {
  const byId = students.find((student) => student.student_id === weakStudent.student_id);
  if (byId) return byId;

  const weakName = cleanText(weakStudent.full_name);
  return students.find((student) => cleanText(student.full_name) === weakName);
}

function buildWeakStudentContextLine(subject: AiSubjectSignal, students: AiStudentSignal[]): string | null {
  const weakStudents = subject.weak_students || [];
  if (!weakStudents.length) return null;

  const signals: string[] = [];

  for (const weakStudent of weakStudents.slice(0, 6)) {
    const student = findStudentSignalForWeakStudent(weakStudent, students);
    if (!student) continue;

    const studentSignals: string[] = [];
    const conduct = student.conduct_total_20 == null ? null : Number(student.conduct_total_20);
    const absenceHours = student.total_absent_hours == null ? null : Number(student.total_absent_hours);
    const lates = student.nb_lates == null ? null : Number(student.nb_lates);
    const presence = student.presence_rate == null ? null : Number(student.presence_rate);

    if (conduct != null && Number.isFinite(conduct) && conduct < 12) {
      studentSignals.push(`conduite ${formatAvg(conduct)}`);
    }
    if (absenceHours != null && Number.isFinite(absenceHours) && absenceHours >= 5) {
      studentSignals.push(`${round1(absenceHours)} h d’absence`);
    }
    if (lates != null && Number.isFinite(lates) && lates >= 2) {
      studentSignals.push(`${Math.round(lates)} retard${Math.round(lates) > 1 ? "s" : ""}`);
    }
    if (presence != null && Number.isFinite(presence) && presence < 0.9) {
      studentSignals.push(`assiduité ${pct(presence)}`);
    }

    if (studentSignals.length) {
      signals.push(`${weakStudent.full_name} : ${studentSignals.join(", ")}`);
    }
  }

  if (!signals.length) return null;

  return `Vérification conduite/absences : signal(s) à examiner pour ${signals.join(" ; ")}.`;
}

function buildSubjectRemediationActions(subject: AiSubjectSignal): string[] {
  const actions: string[] = [];
  const weakNames = formatWeakStudentNames(subject, 6);
  const criticalWeakNames = getCriticalWeakStudents(subject)
    .slice(0, 4)
    .map((student) => `${student.full_name} (${formatAvg(student.avg_score_20)})`)
    .join(", ");
  const isBlocking = subject.alert_level === "blocking";
  const subjectLabel = `${subject.subject_name} en ${subject.class_label}`;

  if (weakNames) {
    actions.push(`Recevoir les élèves sous 10 avec le professeur concerné et le professeur principal : ${weakNames}.`);
    actions.push("Vérifier leur conduite et leurs absences/retards ; ne retenir ce point que si un signal défavorable apparaît.");
  } else if (subject.avg_score_20 != null && subject.avg_score_20 < 13.5) {
    actions.push(`Mettre ${subjectLabel} sous observation sur les deux prochaines évaluations.`);
  }

  actions.push("Vérifier que les séances de travaux dirigés ou de consolidation prévues dans la matière sont effectivement réalisées.");

  if (isBlocking) {
    actions.push("Organiser une séance courte de remédiation centrée sur les notions non maîtrisées.");
    actions.push("Prévoir un exercice diagnostique puis une mini-évaluation de contrôle après la remédiation.");
  } else {
    actions.push("Prévoir des exercices courts de consolidation avant le prochain devoir.");
    actions.push("Comparer les résultats au prochain devoir pour confirmer ou lever la vigilance.");
  }

  if (criticalWeakNames) {
    actions.push(`Pour les cas les plus préoccupants (${criticalWeakNames}), informer ou convoquer les parents avant le prochain devoir.`);
  }

  actions.push("Faire valider le suivi par le professeur principal et l’enseignant de la matière.");

  return actions.slice(0, 6);
}

function buildCouncilPedagogicalActionLines(args: {
  subjectAlerts: AiSubjectSignal[];
  studentsToFollow: AiStudentSignal[];
  presenceRatio: number;
  progressionRatio: number;
  progressionsCount: number;
  broadScope: boolean;
}): string[] {
  const lines: string[] = [];
  const subjectsWithWeakStudents = args.subjectAlerts.filter((subject) => Number(subject.weak_students_count || 0) > 0);
  const observationSubjects = args.subjectAlerts.filter((subject) => Number(subject.weak_students_count || 0) <= 0);

  for (const subject of subjectsWithWeakStudents.slice(0, args.broadScope ? 3 : 4)) {
    const weakNames = formatWeakStudentNames(subject, args.broadScope ? 4 : 6);
    const prefix = subject.alert_level === "blocking" ? "Remédiation prioritaire" : "Remédiation ciblée";
    lines.push(
      `${prefix} en ${subject.subject_name} (${subject.class_label}) : prendre en charge les élèves sous 10${
        weakNames ? ` — ${weakNames}` : ""
      }.`,
    );
  }

  for (const subject of observationSubjects.slice(0, args.broadScope ? 2 : 3)) {
    lines.push(
      `Observation pédagogique en ${subject.subject_name} (${subject.class_label}) : moyenne ${formatAvg(
        subject.avg_score_20,
      )}, aucun élève sous 10 ; vérifier la tendance aux prochaines évaluations avant toute remédiation individuelle.`,
    );
  }

  if (args.studentsToFollow.length) {
    lines.push(
      `Ouvrir ou actualiser une fiche de suivi pour les élèves prioritaires signalés, avec responsable, matière concernée et date de vérification.`,
    );
  }

  if (args.presenceRatio < 0.8) {
    lines.push("Régulariser les appels de classe manquants avant toute conclusion globale sur les absences et retards : les enseignants concernés effectuent l'appel ; l'administration prend le relais si l'enseignant est absent ou empêché ; l'éducateur assure le suivi des alertes.");
  }

  if (args.progressionsCount > 0 && args.progressionRatio < 0.8) {
    lines.push("Compléter les progressions du cahier de textes avant de conclure sur l’avancement du programme.");
  }

  if (!lines.length) {
    lines.push("Maintenir une observation pédagogique régulière et vérifier les prochaines évaluations avant le conseil.");
  }

  lines.push("Faire un point avec le professeur principal et les enseignants concernés.");
  lines.push("Informer les parents uniquement lorsque le suivi pédagogique le justifie.");

  return Array.from(new Set(lines)).slice(0, args.broadScope ? 8 : 9);
}

function buildCommonRecommendations(args: {
  studentsToFollow: AiStudentSignal[];
  classesAtRisk: AiClassSignal[];
  blockers: AiSubjectSignal[];
  totalStudents: number;
  highRisk: number;
  mediumRisk: number;
}): string[] {
  const recs: string[] = [];

  if (args.studentsToFollow.length) {
    recs.push(
      `Traiter d’abord les ${Math.min(args.studentsToFollow.length, 10)} premiers élèves en suivi prioritaire : entretien éducateur/professeur principal, point avec les enseignants des matières faibles, puis information parent si nécessaire.`,
    );
  }

  if (args.blockers.length) {
    const first = args.blockers[0];
    const label = first.alert_level === "blocking" ? "blocage actuel" : "point de vigilance";
    const weakNames = formatWeakStudentNames(first, 4);
    recs.push(
      weakNames
        ? `Organiser un point pédagogique sur ${first.subject_name} en ${first.class_label}, car cette matière ressort comme ${label}. Élèves concernés : ${weakNames}.`
        : `Organiser un point pédagogique sur ${first.subject_name} en ${first.class_label}, car cette matière ressort comme ${label}.`,
    );
  }

  if (args.classesAtRisk.length) {
    const cls = args.classesAtRisk[0];
    recs.push(
      `Suivre particulièrement ${cls.class_label} : ${cls.main_reasons.length ? cls.main_reasons.join(" ; ") : "les indicateurs de classe sont fragiles"}.`,
    );
  }

  if (args.highRisk + args.mediumRisk > args.totalStudents * 0.35) {
    recs.push(
      "Prévoir une réunion pédagogique courte pour harmoniser les devoirs, les interrogations, les remédiations et les relances parents.",
    );
  }

  recs.push(
    "Vérifier que toutes les notes importantes sont publiées avant de tirer une conclusion définitive : une IA fiable dépend d’abord de données complètes.",
  );

  return recs.slice(0, 6);
}

function buildRemediationSummaryRecommendations(args: {
  studentsToFollow: AiStudentSignal[];
  classesAtRisk: AiClassSignal[];
  blockers: AiSubjectSignal[];
}): string[] {
  const recs: string[] = [];
  const first = args.blockers[0];

  if (first) {
    const weakCount = Number(first.weak_students_count || 0);
    const weakNames = formatWeakStudentNames(first, 3);
    const criticalWeakNames = getCriticalWeakStudents(first)
      .slice(0, 3)
      .map((student) => `${student.full_name} (${formatAvg(student.avg_score_20)})`)
      .join(", ");

    recs.push(
      `Priorité : traiter ${first.subject_name} en ${first.class_label} — moyenne ${formatAvg(first.avg_score_20)}${
        weakCount ? `, ${weakCount} élève${weakCount > 1 ? "s" : ""} sous 10` : ""
      }.`
    );

    if (weakNames) {
      recs.push(
        `Élèves concernés : ${weakNames}. Vérifier conduite, absences et retards uniquement si ces données révèlent un signal défavorable.`
      );
    }

    recs.push(
      `Vérifier avec le professeur concerné que les TD, consolidations ou remédiations en ${first.subject_name} sont effectivement réalisés avant le prochain devoir.`
    );

    if (criticalWeakNames) {
      recs.push(
        `Cas les plus préoccupants : ${criticalWeakNames}. Prévoir entretien et information ou convocation des parents avant le prochain devoir.`
      );
    } else if (weakNames) {
      recs.push(
        "Parents : informer seulement si conduite/absences posent problème ou si aucune amélioration n’apparaît à la prochaine évaluation."
      );
    }
  } else if (args.studentsToFollow.length) {
    recs.push(
      `Priorité : suivre ${Math.min(args.studentsToFollow.length, 10)} élève${args.studentsToFollow.length > 1 ? "s" : ""} signalé${args.studentsToFollow.length > 1 ? "s" : ""} par les moyennes et indicateurs disponibles.`
    );
    recs.push("Vérifier les matières faibles, la conduite et les absences uniquement pour les élèves concernés.");
    recs.push("Prévoir entretien, exercices ciblés et contrôle rapide avant la prochaine évaluation.");
  } else if (args.classesAtRisk.length) {
    recs.push(`Priorité : observer ${args.classesAtRisk[0].class_label} avant le prochain conseil.`);
    recs.push("Identifier les matières et élèves réellement concernés avant toute action générale.");
  } else {
    recs.push("Aucune remédiation urgente n’est isolée avec les données disponibles.");
    recs.push("Maintenir une observation pédagogique et attendre les prochaines évaluations avant de conclure.");
  }

  return recs.slice(0, 4);
}

function buildCouncilNote(args: {
  context: MonCahierAiContext;
  scoped: ReturnType<typeof selectContextByQuestion>;
  classesAtRisk: AiClassSignal[];
  studentsToFollow: AiStudentSignal[];
  blockers: AiSubjectSignal[];
  avgSuccess: number | null;
  progressions: AiProgramProgressionSignal[];
}): string {
  const scopeLabel = scopeDisplayName(args.scoped);
  const subjectPrefix = scopeSubjectLabel(args.scoped);
  const broadScope = isBroadScope(args.scoped);
  const topClass = args.classesAtRisk[0];
  const subjectAlerts = filterActionableSubjectAlerts(args.blockers, args.scoped).slice(0, broadScope ? 6 : 5);
  const blockingSubjects = subjectAlerts.filter((subject) => subject.alert_level === "blocking");
  const watchSubjects = subjectAlerts.filter((subject) => subject.alert_level === "watch");
  const topStudents = args.studentsToFollow.slice(0, broadScope ? 6 : 8);
  const avgClass =
    args.scoped.classes.length === 1
      ? args.scoped.classes[0]?.avg_general_20
      : args.scoped.students.length
        ? args.scoped.students.reduce((acc, student) => acc + (student.general_avg_20 ?? 0), 0) /
          Math.max(1, args.scoped.students.filter((student) => student.general_avg_20 != null).length)
        : null;
  const studentsWithOfficialAvg = args.scoped.students.filter((student) => student.general_avg_20 != null).length;
  const conductCount = args.scoped.students.filter((student) => student.conduct_total_20 != null).length;
  const presenceCount = args.scoped.students.filter(
    (student) => student.presence_rate != null || student.total_absent_hours != null || student.nb_lates != null,
  ).length;
  const presenceRatio = args.scoped.students.length ? presenceCount / args.scoped.students.length : 0;
  const conductRatio = args.scoped.students.length ? conductCount / args.scoped.students.length : 0;
  const progressionAverage = averageProgressionRate(args.progressions);
  const progressionRatio = progressionCoverage({ scoped: args.scoped, progressions: args.progressions });
  const weakestProgressionItems = weakestProgressions(args.progressions, broadScope ? 3 : 2);

  const subjectLines = subjectAlerts.length
    ? subjectAlerts
        .map((subject, index) => {
          const label = subject.alert_level === "blocking" ? "bloquante" : "vigilance";
          const weakNames = formatWeakStudentNames(subject, broadScope ? 4 : 5);
          return `${index + 1}. ${subject.subject_name} (${subject.class_label}) — ${label}, moyenne ${formatAvg(
            subject.avg_score_20,
          )}, ${subject.weak_students_count} élève${subject.weak_students_count > 1 ? "s" : ""} sous 10${
            weakNames ? ` : ${weakNames}` : ""
          }.`;
        })
        .join("\n")
    : "Aucune matière bloquante ou de vigilance n’est clairement isolée avec les moyennes officielles disponibles.";

  const studentLines = topStudents.length
    ? topStudents
        .map(
          (student, index) =>
            `${index + 1}. ${student.full_name} (${student.class_label}) — priorité ${student.priority_score}/100 ; moyenne bulletin ${formatAvg(
              student.general_avg_20,
            )} ; motifs : ${student.reasons.join(" ; ") || "indicateurs à confirmer"}.`,
        )
        .join("\n")
    : "Aucun élève ne ressort en suivi prioritaire global. Les élèves faibles par matière restent à suivre dans les actions ciblées.";

  const pedagogicalActionLines = buildCouncilPedagogicalActionLines({
    subjectAlerts,
    studentsToFollow: topStudents,
    presenceRatio,
    progressionRatio,
    progressionsCount: args.progressions.length,
    broadScope,
  });

  const allStudentsHaveAvg = studentsWithOfficialAvg === args.scoped.students.length && args.scoped.students.length > 0;
  const avgLabel = formatAvg(avgClass);
  const classCountLabel =
    args.scoped.classes.length > 1
      ? `${args.scoped.classes.length} classes`
      : args.scoped.classes.length === 1
        ? "1 classe"
        : "périmètre non précisé";
  const situationLine = subjectAlerts.length
    ? `${subjectPrefix} présente un niveau général satisfaisant, avec des points de vigilance à traiter de manière ciblée.`
    : `${subjectPrefix} ne présente pas de difficulté pédagogique majeure avec les données disponibles.`;
  const bulletinLine = allStudentsHaveAvg
    ? "Les moyennes des bulletins sont disponibles pour tous les élèves du périmètre."
    : `Les moyennes des bulletins sont disponibles pour ${studentsWithOfficialAvg}/${args.scoped.students.length} élève(s) du périmètre.`;
  const attendanceLine = presenceCount > 0
    ? `Les éléments d’assiduité sont disponibles pour ${presenceCount}/${args.scoped.students.length} élève(s).`
    : "Les éléments d’assiduité ne sont pas suffisamment renseignés pour ce périmètre.";
  const conductLine = conductCount > 0
    ? `La conduite est prise en compte pour ${conductCount}/${args.scoped.students.length} élève(s).`
    : "La conduite n’est pas suffisamment renseignée pour ce périmètre.";
  const progressionLine = args.progressions.length
    ? progressionRatio >= 0.8
      ? `La progression issue du cahier de textes est disponible sur le périmètre, avec un avancement moyen de ${progressionAverage ?? 0}%.`
      : `Les données de progression issues du cahier de textes sont partielles (${args.progressions.length} progression(s) exploitée(s), avancement moyen ${progressionAverage ?? 0}%).`
    : "La progression reste à vérifier dans le cahier de textes ou à renseigner manuellement.";
  const weakestProgressionLine = args.progressions.length && progressionRatio >= 0.5 && weakestProgressionItems.length
    ? `Points de progression à surveiller : ${weakestProgressionItems
        .map((item) => `${item.subject_name} (${item.class_label}) ${item.completion_rate}%`)
        .join(" ; ")}.`
    : args.progressions.length
      ? "Les données de progression restent trop partielles pour conclure sur l’ensemble du périmètre."
      : "La progression pédagogique doit être vérifiée dans le cahier de textes.";
  const blockingLine = blockingSubjects.length
    ? `${blockingSubjects.length} matière(s) nécessitent une attention particulière avant le conseil.`
    : "Aucune matière bloquante critique n’est isolée.";
  const watchLine = watchSubjects.length
    ? `${watchSubjects.length} matière(s) méritent une vigilance pédagogique.`
    : "Aucune matière de vigilance supplémentaire n’est isolée.";
  const classRiskLine = topClass
    ? `Une attention particulière peut être portée à ${topClass.class_label} (${topClass.main_reasons.join(" ; ") || "signaux pédagogiques à suivre"}).`
    : "Aucune difficulté collective forte ne ressort dans le périmètre analysé.";

  const positiveLines = [
    bulletinLine,
    conductRatio >= 0.8 ? conductLine : null,
    presenceRatio >= 0.8 ? attendanceLine : null,
    progressionRatio >= 0.8 && args.progressions.length ? progressionLine : null,
    blockingLine,
  ].filter(Boolean) as string[];

  const vigilanceLines = [
    classRiskLine,
    watchLine,
    presenceRatio < 0.8 ? `Assiduité à compléter : ${attendanceLine}` : null,
    conductRatio < 0.8 ? `Conduite à compléter : ${conductLine}` : null,
    progressionRatio < 0.8 ? progressionLine : null,
    args.progressions.length ? weakestProgressionLine : null,
  ].filter(Boolean) as string[];

  const conclusion = subjectAlerts.length
    ? `${subjectPrefix} ne présente pas nécessairement une difficulté générale, mais certains points de vigilance doivent être traités de manière ciblée.`
    : `${subjectPrefix} ne présente pas de signal pédagogique critique avec les données actuellement disponibles.`;

  const lines = [
    "NOTE PRÉPARATOIRE AU CONSEIL DE CLASSE",
    "==================================================",
    `Classe / périmètre : ${scopeLabel}`,
    `Année scolaire : ${args.context.academic_year}`,
    `Date de préparation : ${new Date().toLocaleDateString("fr-FR")}`,
    "",
    "1. SITUATION GÉNÉRALE",
    situationLine,
    `- Périmètre concerné : ${classCountLabel}.`,
    `- Effectif concerné : ${args.scoped.students.length} élève(s).`,
    `- Moyenne générale du périmètre : ${avgLabel}.`,
    `- ${bulletinLine}`,
    "",
    "2. POINTS POSITIFS",
    ...positiveLines.map((line) => `- ${line}`),
    "",
    "3. POINTS DE VIGILANCE",
    ...vigilanceLines.map((line) => `- ${line}`),
    "",
    "4. MATIÈRES À TRAITER",
    subjectLines,
    "",
    "5. ÉLÈVES À SUIVRE",
    studentLines,
    "",
    "6. ACTIONS PÉDAGOGIQUES PROPOSÉES",
    ...pedagogicalActionLines.map((line) => `- ${line}`),
    "",
    "7. CONCLUSION PROPOSÉE",
    conclusion,
    "",
    "NB : Cette note est une aide à la préparation du conseil de classe. Les décisions finales relèvent de l’équipe éducative.",
  ];

  return lines.join("\n");
}

function buildRemediationPlan(args: {
  studentsToFollow: AiStudentSignal[];
  classesAtRisk: AiClassSignal[];
  blockers: AiSubjectSignal[];
  allStudents?: AiStudentSignal[];
}): string[] {
  const rows: string[] = [];
  const subjectTargets = args.blockers.slice(0, 5);
  const topClasses = args.classesAtRisk.slice(0, 3);
  const topStudents = args.studentsToFollow.slice(0, 10);

  const pushRow = (action: string, target: string, responsible: string, due: string, status: string) => {
    rows.push([action, target, responsible, due, status].map((value) => String(value || "â€”").trim()).join(" | "));
  };

  if (subjectTargets.length) {
    const first = subjectTargets[0];
    const weakNames = formatWeakStudentNames(first, 6);
    const criticalWeakNames = getCriticalWeakStudents(first)
      .slice(0, 4)
      .map((student) => `${student.full_name} (${formatAvg(student.avg_score_20)})`)
      .join(", ");
    const alertLabel = first.alert_level === "blocking" ? "matiÃ¨re bloquante" : "matiÃ¨re de vigilance";
    const subjectTarget = `${first.class_label} ${first.subject_name}`;

    pushRow(
      "PrioritÃ© matiÃ¨re",
      `${subjectTarget} â€” ${alertLabel}, moyenne ${formatAvg(first.avg_score_20)}, ${first.weak_students_count} Ã©lÃ¨ve${first.weak_students_count > 1 ? "s" : ""} sous 10`,
      "Administration pÃ©dagogique + professeur concernÃ© + professeur principal",
      "ImmÃ©diat",
      "Ã€ cadrer",
    );

    if (weakNames) {
      pushRow(
        "Entretien ciblÃ©",
        weakNames,
        `Administration pÃ©dagogique + professeur de ${first.subject_name} + professeur principal`,
        "Avant prochain devoir",
        "Ã€ faire",
      );

      pushRow(
        "VÃ©rification conduite / absences",
        weakNames,
        "Administration pÃ©dagogique + professeur principal",
        "Avant ou pendant lâ€™entretien",
        "Ã€ vÃ©rifier",
      );
    }

    pushRow(
      "TD / consolidation",
      subjectTarget,
      `Professeur de ${first.subject_name}`,
      "Cette semaine",
      "Ã€ vÃ©rifier",
    );

    pushRow(
      "Exercices + mini-Ã©valuation",
      weakNames || subjectTarget,
      `Professeur de ${first.subject_name}`,
      "AprÃ¨s remÃ©diation",
      "Ã€ programmer",
    );

    if (criticalWeakNames) {
      pushRow(
        "Parents",
        criticalWeakNames,
        "Administration pÃ©dagogique / professeur principal",
        "Avant prochain devoir",
        "Ã€ dÃ©cider",
      );
    } else if (weakNames) {
      pushRow(
        "Parents",
        `${weakNames} si absence, conduite dÃ©favorable ou absence dâ€™amÃ©lioration`,
        "Administration pÃ©dagogique / professeur principal",
        "AprÃ¨s entretien ou prochaine Ã©valuation",
        "Ã€ dÃ©cider",
      );
    }

    for (const subject of subjectTargets.slice(1, 4)) {
      const names = formatWeakStudentNames(subject, 4);
      pushRow(
        "Suivi complÃ©mentaire",
        `${subject.class_label} ${subject.subject_name} â€” moyenne ${formatAvg(subject.avg_score_20)}, ${subject.weak_students_count} Ã©lÃ¨ve${subject.weak_students_count > 1 ? "s" : ""} sous 10${names ? ` : ${names}` : ""}`,
        `Professeur de ${subject.subject_name} + professeur principal`,
        "Deux prochaines Ã©valuations",
        names ? "Ã€ suivre" : "Observation",
      );
    }
  } else {
    pushRow(
      "Diagnostic initial",
      "Aucune matiÃ¨re bloquante claire isolÃ©e",
      "Administration pÃ©dagogique + professeurs principaux",
      "Cette semaine",
      "Ã€ confirmer",
    );
  }

  if (topStudents.length && !subjectTargets.length) {
    pushRow(
      "Fiches de suivi",
      `${topStudents.length} Ã©lÃ¨ve${topStudents.length > 1 ? "s" : ""} prioritaire${topStudents.length > 1 ? "s" : ""}`,
      "Professeur principal + Ã©ducateur de niveau",
      "Avant conseil",
      "Ã€ ouvrir",
    );
  }

  if (topClasses.length) {
    pushRow(
      "Coordination classe",
      topClasses.map((c) => c.class_label).join(", "),
      "Professeur principal + Ã©ducateur de niveau",
      "Avant conseil",
      "Ã€ organiser",
    );
  }

  pushRow(
    "Cadre Ã©thique",
    "Ã‰lÃ¨ves concernÃ©s",
    "Ã‰quipe Ã©ducative",
    "Permanent",
    "Ã€ respecter",
  );

  return rows.slice(0, 10);
}


