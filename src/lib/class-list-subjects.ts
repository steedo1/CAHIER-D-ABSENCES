import { ciPrimaryFrenchEntryForName, type CiPrimaryFrenchCode } from "./primary-french-reference-ci";

const SHORT: Record<CiPrimaryFrenchCode, string> = {
  lecture: "Lect.", ecriture_copie: "Écr.", orthographe_dictee: "Dict.",
  expression_ecrite: "Expr.", exploitation_texte: "Expl.", eveil_milieu: "Éveil",
  mathematiques: "Maths", chant_poeme: "Chant", dessin: "Dess.", edhc: "EDHC", eps: "EPS",
};
export type ClassListMarkSubject = { id: string; name: string; shortName: string; denominator: number | null };
export function classListSubjectShortName(name: string): string {
  const known = ciPrimaryFrenchEntryForName(name);
  if (known) return SHORT[known.code];
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (name.length <= 7) return name;
  if (words.length === 1) return words[0].slice(0, 6) + ".";
  return words.length === 2 ? words.map(word => word.slice(0, 3) + ".").join("")
    : words.map(word => word[0]).join("").slice(0, 7).toLocaleUpperCase("fr");
}
