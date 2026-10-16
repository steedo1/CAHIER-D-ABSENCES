import { cleanText, isQuickStatsQuestion, type MonCahierAiAnswer } from "@/lib/mon-cahier-ai/core";

/** Only simple counts can skip the pedagogical analysis and its bulletin reads. */
export function isRosterCountQuestion(question: string, classLabels: string[] = []): boolean {
  let text = cleanText(question);
  if (!isQuickStatsQuestion(text) || !/\b(eleves?|effectifs?|classes?)\b/.test(text)) return false;
  for (const label of classLabels) {
    const name = cleanText(label).replace(/\s/g, "");
    if (name) text = text.replace(new RegExp(`(?:^|\\s)${name.split("").join("\\s*")}(?=\\s|$)`, "g"), " ");
  }
  const allowed = new Set([
    "combien", "quel", "quelle", "quels", "quelles", "est", "sont", "effectif", "effectifs", "nombre", "total",
    "eleve", "eleves", "classe", "classes", "niveau", "niveaux", "compte", "comptent", "comptons", "avons", "nous",
    "a", "t", "il", "y", "de", "d", "du", "des", "le", "la", "les", "l", "un", "une", "en", "dans", "pour", "et",
    "ce", "cet", "cette", "etablissement", "ecole", "tous", "toutes", "notre", "nos", "mes", "annee", "scolaire",
    "6e", "5e", "4e", "3e", "2nde", "2de", "1ere", "1re", "tle", "terminale", "sixieme", "cinquieme", "quatrieme", "troisieme", "seconde", "premiere",
  ]);
  return text.trim().split(/\s+/).every((word) => allowed.has(word));
}

export async function loadRosterCount(srv: any, institutionId: string, classIds: string[]): Promise<number> {
  const students = new Set<string>();
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await srv.from("class_enrollments")
      .select("student_id")
      .eq("institution_id", institutionId)
      .in("class_id", classIds)
      .is("end_date", null)
      .order("id", { ascending: true })
      .range(start, start + pageSize - 1);
    if (error) throw new Error("L’effectif est momentanément indisponible. Réessaie dans un instant.");
    for (const row of data || []) if (row.student_id) students.add(String(row.student_id));
    if (!data || data.length < pageSize) return students.size;
  }
}

export function buildRosterCountAnswer(args: {
  academicYear: string;
  scopeLabel: string;
  classesCount: number;
  studentsCount: number;
}): MonCahierAiAnswer {
  return {
    intent: "quick_stats",
    title: `Effectif — ${args.scopeLabel}`,
    summary: `Année scolaire ${args.academicYear}. L’effectif est établi à partir des inscriptions actives dans les classes du périmètre.`,
    confidence: 100,
    recommendations: [], students_to_follow: [], classes_at_risk: [], blocking_subjects: [],
    quick_stats: {
      scope_label: args.scopeLabel,
      cards: [
        { key: "scope_students", label: "Élèves inscrits", value: String(args.studentsCount), details: "Chaque élève est compté une seule fois.", tone: "neutral" },
        { key: "scope_classes", label: "Classes", value: String(args.classesCount), tone: "neutral" },
      ],
    },
    model: { key: "mon_cahier_ai_pedagogy", version: "2.0.0", source: "rules_baseline" },
    ethics_notice: "Décompte des inscriptions actives de l’établissement, pour l’année et les classes indiquées.",
  };
}
