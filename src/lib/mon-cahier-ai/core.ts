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

  if (score >= 20 || (avg != null && avg < 13.5) || weak > 0) {
    return { alert_level: "watch", alert_label: "Vigilance" };
  }

  return { alert_level: "ok", alert_label: "Stable" };
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
    q.includes("conseil") ||
    q.includes("note") ||
    q.includes("rapport") ||
    q.includes("preparer") ||
    q.includes("rediger")
  ) {
    return "council_note";
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
  const subjectAlerts = [...scoped.subjects]
    .map((subject) => ({
      ...subject,
      ...classifySubjectSignal(subject),
    }))
    .filter((subject) => subject.alert_level !== "ok")
    .sort((a, b) => b.blocker_score - a.blocker_score)
    .slice(0, 15);
  const blockers = subjectAlerts.filter((subject) => subject.alert_level === "blocking");
  const watchSubjects = subjectAlerts.filter((subject) => subject.alert_level === "watch");

  const totalStudents = scoped.students.length;
  const highRisk = scoped.students.filter((s) => s.risk_level === "high").length;
  const mediumRisk = scoped.students.filter((s) => s.risk_level === "medium").length;
  const avgSuccess =
    scoped.classes.length > 0
      ? scoped.classes.reduce((acc, cls) => acc + (cls.avg_success_probability ?? 0), 0) / scoped.classes.length
      : null;

  const commonRecs = buildCommonRecommendations({
    studentsToFollow,
    classesAtRisk,
    blockers: subjectAlerts,
    totalStudents,
    highRisk,
    mediumRisk,
  });

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
    summary = `Analyse de ${scoped.classes.length} classe${scoped.classes.length > 1 ? "s" : ""} et ${totalStudents} élève${totalStudents > 1 ? "s" : ""}. Indice moyen de préparation : ${avgSuccess == null ? "—" : pct(avgSuccess)}. ${highRisk} élève${highRisk > 1 ? "s" : ""} en suivi prioritaire et ${mediumRisk} en suivi renforcé.`;
  } else if (intent === "council_note") {
    title = scopeLabel ? `Note préparatoire au conseil de classe — ${scopeLabel}` : "Note préparatoire au conseil de classe";
    council_note = buildCouncilNote({ context, scoped, classesAtRisk, studentsToFollow, blockers: subjectAlerts, avgSuccess });
    summary = "Voici une note structurée pour préparer le conseil de classe à partir des signaux pédagogiques disponibles.";
    recommendations = [
      "Relire la note avec le professeur principal avant diffusion.",
      "Valider les cas individuels avec l’éducateur de niveau et les enseignants concernés.",
      "Ne jamais utiliser l’indice IA comme sanction automatique : il sert à orienter l’accompagnement.",
    ];
  } else if (intent === "remediation_plan") {
    title = scopeLabel ? `Plan de remédiation — ${scopeLabel}` : "Plan de remédiation proposé";
    remediation_plan = buildRemediationPlan({ studentsToFollow, classesAtRisk, blockers: subjectAlerts });
    summary = "Le plan cible d’abord les matières bloquantes ou de vigilance, ensuite les élèves prioritaires, puis l’assiduité et le suivi parents.";
    recommendations = remediation_plan;
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
    recs.push(
      `Organiser un point pédagogique sur ${first.subject_name} en ${first.class_label}, car cette matière ressort comme ${label}.`,
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

function buildCouncilNote(args: {
  context: MonCahierAiContext;
  scoped: ReturnType<typeof selectContextByQuestion>;
  classesAtRisk: AiClassSignal[];
  studentsToFollow: AiStudentSignal[];
  blockers: AiSubjectSignal[];
  avgSuccess: number | null;
}): string {
  const topClass = args.classesAtRisk[0];
  const topBlocker = args.blockers[0];
  const topStudents = args.studentsToFollow.slice(0, 8);

  const lines = [
    `NOTE PRÉPARATOIRE AU CONSEIL DE CLASSE`,
    `Année scolaire : ${args.context.academic_year}`,
    `Date d’analyse : ${new Date().toLocaleDateString("fr-FR")}`,
    "",
    `1. Situation générale`,
    `L’analyse porte sur ${args.scoped.classes.length} classe(s) et ${args.scoped.students.length} élève(s). L’indice moyen de préparation est ${args.avgSuccess == null ? "non disponible" : pct(args.avgSuccess)}. Cette estimation combine les résultats scolaires, les signaux d’assiduité, la conduite et les données d’évaluation disponibles.`,
    "",
    `2. Points d’attention`,
    topClass
      ? `La classe à surveiller en priorité est ${topClass.class_label} (${topClass.main_reasons.join(" ; ") || "indicateurs fragiles"}).`
      : `Aucune classe prioritaire ne ressort clairement avec les données disponibles.`,
    topBlocker
      ? `${topBlocker.alert_level === "blocking" ? "La matière la plus bloquante" : "La principale matière de vigilance"} détectée est ${topBlocker.subject_name} en ${topBlocker.class_label}, avec une moyenne de ${formatAvg(topBlocker.avg_score_20)}.`
      : `Aucune matière bloquante ou de vigilance n’est clairement isolée.`,
    "",
    `3. Élèves à suivre`,
    topStudents.length
      ? topStudents
          .map(
            (s, i) =>
              `${i + 1}. ${s.full_name} (${s.class_label}) — priorité ${s.priority_score}/100 : ${s.reasons.join(" ; ") || "indicateurs fragiles"}.`,
          )
          .join("\n")
      : `Aucun élève ne ressort en suivi prioritaire.`,
    "",
    `4. Actions proposées`,
    `- Organiser une remédiation ciblée dans les matières bloquantes.`,
    `- Confier les cas prioritaires au professeur principal et à l’éducateur de niveau.`,
    `- Relancer les parents lorsque l’assiduité ou les résultats chutent.`,
    `- Vérifier la publication des notes avant toute décision définitive.`,
    "",
    `Observation éthique : cette note est une aide à la décision. Elle ne remplace pas le jugement de l’équipe pédagogique.`,
  ];

  return lines.join("\n");
}

function buildRemediationPlan(args: {
  studentsToFollow: AiStudentSignal[];
  classesAtRisk: AiClassSignal[];
  blockers: AiSubjectSignal[];
}): string[] {
  const plan: string[] = [];
  const blockerBySubject = args.blockers.slice(0, 5);
  const topClasses = args.classesAtRisk.slice(0, 3);
  const topStudents = args.studentsToFollow.slice(0, 10);

  if (blockerBySubject.length) {
    plan.push(
      `Semaine 1 : lancer une remédiation ou une vigilance renforcée dans les matières signalées (${blockerBySubject
        .map((b) => `${b.subject_name} / ${b.class_label}`)
        .join(", ")}).`,
    );
  } else {
    plan.push("Semaine 1 : identifier les chapitres non maîtrisés à partir des dernières évaluations publiées.");
  }

  if (topClasses.length) {
    plan.push(
      `Semaine 1-2 : suivre les classes sensibles (${topClasses
        .map((c) => c.class_label)
        .join(", ")}) avec un point rapide professeur principal + éducateur.`,
    );
  }

  if (topStudents.length) {
    plan.push(
      `Semaine 2 : établir une fiche de suivi pour ${topStudents.length} élève${topStudents.length > 1 ? "s" : ""} prioritaire${topStudents.length > 1 ? "s" : ""}, avec objectif par matière et responsable de suivi.`,
    );
  }

  plan.push("Semaine 2-3 : organiser des exercices courts corrigés immédiatement, plutôt que multiplier seulement les devoirs longs.");
  plan.push("Semaine 3 : faire un mini-bilan : nouvelles notes, assiduité, retards, participation, évolution par élève.");
  plan.push("Avant conseil : produire une note de synthèse Mon Cahier IA et valider les conclusions avec l’équipe pédagogique.");

  return plan;
}
