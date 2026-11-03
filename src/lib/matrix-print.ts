import { fitClassListName } from "./class-list-name";

const clean = (value: string | null | undefined) => String(value || "").replace(/\s+/g, " ").trim();

function normalizedSubject(value: string) {
  return value.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim().replace(/\s+/g, " ").toUpperCase();
}

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/^(MATHEMATIQUES?|MATHS?|MATH)$/, "MATH"],
  [/^(ANGLAIS|LV1 ANGLAIS|LANGUE VIVANTE 1 ANGLAIS)$/, "ANG"],
  [/^(ESPAGNOL|LV2 ESPAGNOL|LANGUE VIVANTE 2 ESPAGNOL)$/, "ESP"],
  [/^(ALLEMAND|LV2 ALLEMAND|LANGUE VIVANTE 2 ALLEMAND)$/, "ALL"],
  [/^(FRANCAIS|LANGUE FRANCAISE)$/, "FR"],
  [/^COMPOSITION FRANCAISE$/, "CF"],
  [/^EXPRESSION ORALE$/, "E.O."],
  [/^EXPRESSION ECRITE$/, "E.E."],
  [/^(EDUCATION PHYSIQUE ET SPORTIVE|EPS)$/, "EPS"],
  [/^(EDUCATION AUX DROITS DE L HOMME ET A LA CITOYENNETE|EDUCATION AUX DROITS HUMAINS ET A LA CITOYENNETE|EDHC)$/, "EDHC"],
  [/^(SCIENCES DE LA VIE ET DE LA TERRE|SCIENCES DE LA VIE ET LA TERRE|SVT)$/, "SVT"],
  [/^(HISTOIRE GEOGRAPHIE|HISTOIRE ET GEOGRAPHIE|HG)$/, "HG"],
  [/^(PHYSIQUE CHIMIE|SCIENCES PHYSIQUES|PC)$/, "PC"],
  [/^HISTOIRE$/, "HIST"],
  [/^GEOGRAPHIE$/, "GEO"],
  [/^PHILOSOPHIE$/, "PHILO"],
  [/^LATIN$/, "LAT"],
  [/^EDUCATION MUSICALE$/, "EM"],
  [/^ARTS PLASTIQUES$/, "AP"],
  [/^(TECHNOLOGIE DE L INFORMATION ET DE LA COMMUNICATION|TECHNOLOGIES DE L INFORMATION ET DE LA COMMUNICATION POUR L ENSEIGNEMENT|TICE)$/, "TICE"],
  [/^INFORMATIQUE$/, "INFO"],
  [/^TECHNOLOGIE$/, "TECH"],
  [/^(CONDUITE|MOYENNE DE CONDUITE)$/, "COND"],
  [/^GRAMMAIRE$/, "GRAM"],
  [/^CONJUGAISON$/, "CONJ"],
  [/^ORTHOGRAPHE$/, "ORTH"],
  [/^LECTURE$/, "LECT"],
  [/^DICTEE$/, "DICT"],
  [/^ECRITURE$/, "ECRIT"],
  [/^POESIE$/, "POES"],
  [/^LITTERATURE$/, "LITT"],
  [/^(SCIENCES ECONOMIQUES ET SOCIALES|SES)$/, "SES"],
  [/^ECONOMIE$/, "ECO"],
  [/^COMPTABILITE$/, "COMPT"],
];

const IGNORE_WORDS = new Set(["DE", "DU", "DES", "D", "LA", "LE", "LES", "ET", "A", "L", "EN", "AUX"]);

/**
 * Libellé abrégé à l'impression uniquement : les matières officielles,
 * leurs identifiants, les calculs et les en-têtes CSV restent inchangés.
 */
export function matrixPrintSubjectLabel(label: string | null | undefined): string {
  const raw = clean(label) || "Matière";
  const component = /^[↳↪→]\s*/u.test(raw);
  const source = raw.replace(/^[↳↪→]\s*/u, "").trim();
  const key = normalizedSubject(source);
  const match = ABBREVIATIONS.find(([pattern]) => pattern.test(key));
  let short = match?.[1];
  if (!short) {
    const words = key.split(" ").filter(word => word && !IGNORE_WORDS.has(word));
    short = key.length <= 9 ? source.toUpperCase()
      : words.length > 1
        ? words.slice(0, 3).map(word => word.slice(0, 3)).join(".") + "."
        : source.slice(0, 7).toUpperCase() + ".";
  }
  return component ? "↳ " + short : short;
}

type MatrixPrintIdentity = {
  full_name: string;
  last_name?: string | null;
  first_name?: string | null;
};

/**
 * Même logique que la liste de classe : nom de famille conservé et prénoms
 * suivants abrégés si nécessaire. Aucun rétrécissement de police : les cas
 * exceptionnels reviennent à la ligne dans le PDF.
 */
export function matrixPrintStudentName(
  student: MatrixPrintIdentity,
  maxWidth: number,
  measure: (text: string) => number,
): string {
  const fullName = clean(student.full_name) || "Élève";
  let lastName = clean(student.last_name);
  let firstName = clean(student.first_name);
  if (!lastName && !firstName) {
    const words = fullName.split(" ");
    const prefix: string[] = [];
    for (const word of words) {
      if (word !== word.toLocaleUpperCase("fr-FR")) break;
      prefix.push(word);
    }
    // Préserver aussi les noms de famille composés quand la casse les distingue.
    if (prefix.length > 1 && prefix.length < words.length) {
      lastName = prefix.join(" ");
      firstName = words.slice(prefix.length).join(" ");
    }
  }
  return fitClassListName({ fullName, lastName, firstName }, maxWidth, measure).text;
}
