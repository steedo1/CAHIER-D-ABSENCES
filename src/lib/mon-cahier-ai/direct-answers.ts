import { classesNamedInQuestion, cleanText, extractLevelHint, type MonCahierAiAnswer } from "@/lib/mon-cahier-ai/core";
import { buildRosterCountAnswer, isRosterCountQuestion } from "@/lib/mon-cahier-ai/roster-stats";
import type { SchoolClass, SchoolData } from "@/lib/mon-cahier-ai/school-data";

export function greetingAnswer(question: string) {
  const text = cleanText(question);
  if (/^(bonjour|bonsoir|salut|hello|coucou)( cahier ia)?$/.test(text)) {
    return { title: "Bonjour !", summary: "Que souhaites-tu savoir sur l’établissement ? Tu peux me demander les effectifs, les enseignants, les internes, les dates des trimestres ou une analyse pédagogique." };
  }
  if (/^(merci|merci beaucoup|ok merci|super merci)$/.test(text)) return { title: "Avec plaisir", summary: "Je suis là si tu as une autre question." };
  return null;
}

function simpleFact(question: string, classes: SchoolClass[]) {
  let text = cleanText(question);
  for (const cls of classesNamedInQuestion(question, classes, (item) => item.label)) {
    const name = cleanText(cls.label || "").replace(/\s/g, "");
    text = text.replace(new RegExp(`(?:^|\\s)${name.split("").join("\\s*")}(?=\\s|$)`, "g"), " ");
  }
  // Exact, inexpensive facts bypass the model. Qualifiers such as "absents",
  // "pourquoi" or "depuis" stay with the conversational model.
  const common = new Set("combien quel quelle quels quelles est sont nombre total compte comptent avons nous a t il y de d du des le la les l un une en dans pour ce cet cette etablissement ecole notre nos mes classe classes niveau annee scolaire enseignants enseignant professeurs professeur profs prof internes interne pensionnaires pensionnaire fin debut date dates trimestre trimestres semestre semestres premier deuxieme troisieme 1er 2e 3e t1 t2 t3 6e 5e 4e 2nde 2de 1ere 1re tle terminale".split(" "));
  if (!text.trim().split(/\s+/).every((word) => common.has(word))) return null;
  if (/\b(combien|nombre|total)\b/.test(text) && /\b(enseignants?|professeurs?|profs?)\b/.test(text)) return "teachers";
  if (/\b(combien|nombre|total)\b/.test(text) && /\b(internes?|pensionnaires?)\b/.test(text)) return "boarding";
  if (/\b(date|dates|fin|debut)\b/.test(text) && /\b(trimestres?|semestres?)\b/.test(text)) return "calendar";
  return null;
}

type DirectAnswer = Pick<MonCahierAiAnswer, "title" | "summary"> & Partial<MonCahierAiAnswer>;

export async function answerDirectFact(args: { question: string; academicYear: string; data: SchoolData; classes: SchoolClass[] }): Promise<DirectAnswer | null> {
  const { question, data } = args;
  const roster = isRosterCountQuestion(question, args.classes.map((cls) => cls.label || ""));
  const kind = simpleFact(question, args.classes);
  if (!roster && !kind) return null;
  const named = classesNamedInQuestion(question, args.classes, (cls) => cls.label);
  const filter = { class_labels: named.map((cls) => cls.label || ""), level: named.length || kind === "calendar" ? null : extractLevelHint(question) };
  try {
    const selected = data.selectClasses(filter.class_labels, filter.level);
    if (!selected.length && (roster || kind === "boarding")) throw new Error("no_classes");
  } catch {
    return { title: "Aucune classe trouvée", summary: "Aucune classe ne correspond à cette demande pour l’année scolaire sélectionnée." };
  }
  if (roster) {
    const stats = await data.studentStatistics({ ...filter, metric: "total" });
    return { ...buildRosterCountAnswer({ academicYear: args.academicYear, scopeLabel: stats.scope_label, classesCount: stats.classes_count, studentsCount: stats.students_count }), sources: [stats.source] };
  }
  if (kind === "teachers") {
    const stats = await data.teacherDirectory(filter);
    return { title: `Enseignants — ${stats.scope_label}`, summary: `${stats.teachers_count} enseignant${stats.teachers_count > 1 ? "s" : ""}. ${stats.count_basis}`, sources: [stats.source] };
  }
  if (kind === "boarding") {
    const stats = await data.studentStatistics({ ...filter, metric: "boarding" });
    const boarding = stats.boarding;
    if (!boarding) throw new Error("boarding_data_unavailable");
    return {
      title: `Internes — ${stats.scope_label}`,
      summary: boarding.unknown
        ? `${boarding.yes} interne${boarding.yes > 1 ? "s" : ""} identifié${boarding.yes > 1 ? "s" : ""} parmi ${stats.students_count} élèves inscrits. Le statut d’internat de ${boarding.unknown} élève${boarding.unknown > 1 ? "s" : ""} n’est pas renseigné : le total exact ne peut pas être confirmé.`
        : `${boarding.yes} interne${boarding.yes > 1 ? "s" : ""} parmi ${stats.students_count} élèves inscrits pour ${args.academicYear}.`,
      sources: [stats.source],
    };
  }
  const calendar = await data.calendar({ class_label: named.length === 1 ? named[0].label : null });
  const text = cleanText(question);
  const periodNumber = text.match(/\b(?:t([123])|([123])(?:er|e)?(?=\s+(?:trimestre|semestre))|premier(?=\s+(?:trimestre|semestre))|deuxieme(?=\s+(?:trimestre|semestre))|troisieme(?=\s+(?:trimestre|semestre)))\b/);
  const ordinal = periodNumber?.[1] || periodNumber?.[2] || (periodNumber?.[0] === "premier" ? "1" : periodNumber?.[0] === "deuxieme" ? "2" : periodNumber?.[0] === "troisieme" ? "3" : null);
  const candidates = calendar.periods.filter((period) => ordinal
    ? cleanText(period.code || "").replace(/\s/g, "") === `${/semestre/.test(text) ? "s" : "t"}${ordinal}`
    : period.contains_reference_date);
  const format = (value: string) => value.split("-").reverse().join("/");
  const boundary = /\bdebut\b/.test(text) ? "start_date" : "end_date";
  const period = candidates.length === 1 ? candidates[0] : null;
  return {
    title: "Calendrier scolaire",
    summary: period?.[boundary]
      ? `${period.label} : ${boundary === "end_date" ? "fin" : "début"} le ${format(period[boundary])}. Année scolaire ${args.academicYear}.`
      : calendar.periods.length ? `De quelle période parles-tu ? ${calendar.periods.map((item) => `${item.label}${item.end_date ? ` (fin le ${format(item.end_date)})` : ""}`).join(" ; ")}.`
        : `Aucune période scolaire n’est configurée pour ${args.academicYear} dans ce périmètre.`,
    sources: [calendar.source],
  };
}

/** A missing model must never turn an unrelated question into a school report. */
export function isExplicitPedagogicalQuestion(question: string) {
  return /\b(pedagogique|moyennes?|notes?|bulletins?|matieres?|fragiles?|risques?|suivre|suivis?|remediation|conseil|progression|situation|resume|resumer|assiduite|absences?|retards?|bepc|bac)\b/.test(cleanText(question));
}
