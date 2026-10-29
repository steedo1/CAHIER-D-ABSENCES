import { cleanText, type MonCahierAiAnswer } from "@/lib/mon-cahier-ai/core";

/** Conversational/help requests must not trigger a school-wide prediction. */
export function buildAiHelpAnswer(question: string): MonCahierAiAnswer | null {
  const text = cleanText(question);
  const greeting = /^(bonjour|bonsoir|salut|hello|merci|merci beaucoup|ok|d accord)[ !.]*$/.test(text);
  const help = /^(aide|help)$/.test(text) || /que (peux|sais) tu faire|comment (t utiliser|fonctionnes tu)|quelles sont tes (capacites|fonctions)/.test(text);
  if (!greeting && !help) return null;
  return { intent: "general_analysis", title: "Votre assistant pédagogique Mon Cahier",
    summary: "Je peux vérifier les effectifs actifs, analyser les moyennes officielles, repérer les élèves à accompagner, identifier les difficultés par matière et préparer un plan de remédiation ou une note de conseil de classe. Précisez une classe et votre question pour une réponse ciblée.",
    confidence: 100, recommendations: ["Combien d’élèves compte la 3e3 ?", "Quels élèves de la 6e1 ont besoin d’accompagnement ?", "Prépare un plan de remédiation pour la 4e2."],
    students_to_follow: [], classes_at_risk: [], blocking_subjects: [],
    model: { key: "mon_cahier_ai_pedagogy", version: "2.1.0", source: "rules_baseline" },
    ethics_notice: "Je m'appuie sur les données disponibles de votre établissement. Les décisions restent validées par l'administration." };
}
