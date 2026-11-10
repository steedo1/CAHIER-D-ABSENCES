/** Export DOB CONNECT : structure strictement conforme au classeur fourni.
 * Aucune lecture réseau : utiliser les classes et élèves déjà chargés.
 */
export const DOB_CONNECT_HEADERS = [
  "CODE_ETAB", "NIVEAU", "NUM_CLASSE", "MATRICULE",
  "NOM", "PRENOM", "GENRE", "DATE_NAISS", "LIEU_NAISS",
  "NATIONALITE", "TEL", "EMAIL", "STATUT", "REDOUBLANT",
] as const;

export type DobConnectClass = {
  id: string;
  name?: string | null;
  label?: string | null;
  level?: string | null;
  education_type?: string | null;
};
export type DobConnectStudent = {
  id: string;
  class_id: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  matricule?: string | null;
  gender?: string | null;
  birthdate?: string | null;
  birth_date?: string | null;
  birth_place?: string | null;
  nationality?: string | null;
  is_repeater?: boolean | null;
  is_affecte?: boolean | null;
};
export type DobConnectCell = string | number | Date | null;

function clean(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
function compact(value: unknown): string {
  return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_.-]/g, "").toUpperCase();
}

/** L'intitulé NIVEAU reste celui du modèle, pas le nom de la classe. */
export function dobConnectLevel(raw: unknown): string {
  const original = clean(raw);
  const value = compact(raw);
  const lowerCycle = /^([6543])(?:EME|E|ÈME|È)$/i.exec(value);
  if (lowerCycle) return lowerCycle[1] + "ème";
  const second = /^(?:2NDE|2DE|SECONDE)([A-Z0-9]*)$/.exec(value);
  if (second) return "2nde" + second[1];
  const first = /^(?:1ERE|1RE|PREMIERE)([A-Z0-9]*)$/.exec(value);
  if (first) return "1ère" + first[1];
  const terminal = /^(?:TLE|TERMINALE)([A-Z0-9]*)$/.exec(value);
  if (terminal) return "Tle" + terminal[1];
  return original;
}

/** Ne jamais confondre le niveau (CP1, 6e...) avec le numéro de classe. */
export function dobConnectClassNumber(schoolClass: DobConnectClass): number | null {
  const level = compact(schoolClass.level);
  const label = compact(schoolClass.name || schoolClass.label);
  if (!level || !label || label === level) return null;
  const suffix = label.startsWith(level) ? label.slice(level.length) : label;
  const match = /(?:^|[A-Z])([0-9]{1,3})$/.exec(suffix);
  return match ? Number(match[1]) : null;
}

export function dobConnectDate(raw: unknown): Date | null {
  const value = clean(raw);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!iso && !fr) return null;
  const y = Number(iso ? iso[1] : fr![3]);
  const m = Number(iso ? iso[2] : fr![2]);
  const d = Number(iso ? iso[3] : fr![1]);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
    ? date : null;
}

function dobConnectGender(value: unknown): string {
  const normalized = compact(value);
  if (["M", "G", "GARCON", "MASCULIN"].includes(normalized)) return "M";
  if (["F", "FILLE", "FEMININ"].includes(normalized)) return "F";
  return "";
}
function dobConnectNationality(value: unknown): string {
  const normalized = compact(value);
  if (/^IVOIRIENNE?$/.test(normalized)) return "IVOIRIENNE";
  if (/^ETRANGERE?$/.test(normalized)) return "ETRANGERE";
  return clean(value).toUpperCase();
}
function dobConnectCode(value: string): string | number {
  // Dans le fichier source, CODE_ETAB est numérique ; préserver les zéros initiaux.
  return /^\d{1,15}$/.test(value) && !/^0\d/.test(value) ? Number(value) : value;
}

export function buildDobConnectExport(input: {
  institutionCode: string;
  classes: readonly DobConnectClass[];
  students: readonly DobConnectStudent[];
  classId?: string;
}): { rows: DobConnectCell[][]; count: number; missingClassNumbers: string[] } {
  const code = clean(input.institutionCode);
  if (!code) throw new Error("Renseignez le code officiel de l’établissement dans ses paramètres avant l’export DOB CONNECT.");
  const schoolClasses = input.classes.filter(row =>
    (!input.classId || row.id === input.classId)
    && (!row.education_type || row.education_type === "general_secondary")
  );
  const classById = new Map(schoolClasses.map(row => [row.id, row]));
  if (!classById.size) throw new Error("Aucune classe secondaire générale disponible pour l’export DOB CONNECT.");

  const missingClassNumbers = new Set<string>();
  const rows: DobConnectCell[][] = [[...DOB_CONNECT_HEADERS]];
  const selected = input.students.filter(row => row.class_id && classById.has(row.class_id));
  selected.sort((a, b) => {
    const classA = classById.get(a.class_id!)!;
    const classB = classById.get(b.class_id!)!;
    return dobConnectLevel(classA.level).localeCompare(dobConnectLevel(classB.level), "fr", { numeric: true })
      || clean(a.last_name).localeCompare(clean(b.last_name), "fr")
      || clean(a.first_name).localeCompare(clean(b.first_name), "fr");
  });
  for (const student of selected) {
    const cls = classById.get(student.class_id!)!;
    const classNum = dobConnectClassNumber(cls);
    if (classNum === null) missingClassNumbers.add(clean(cls.name || cls.label || cls.level) || cls.id);
    const lastName = clean(student.last_name);
    const firstName = clean(student.first_name);
    // Ne pas deviner le découpage NOM/PRENOM à partir de full_name.
    const matricule = clean(student.matricule);
    rows.push([
      dobConnectCode(code), dobConnectLevel(cls.level), classNum, matricule,
      lastName, firstName, dobConnectGender(student.gender),
      dobConnectDate(student.birthdate || student.birth_date),
      clean(student.birth_place), dobConnectNationality(student.nationality),
      "auto", "auto",
      student.is_affecte === true ? "AFF" : student.is_affecte === false ? "NAFF" : "none",
      student.is_repeater === true ? 1 : student.is_repeater === false ? 0 : null,
    ]);
  }
  return { rows, count: selected.length, missingClassNumbers: [...missingClassNumbers] };
}
