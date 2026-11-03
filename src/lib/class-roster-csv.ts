/**
 * CSV representation of the class roster already loaded by the authorized
 * Administration > Organisation scolaire screen. Never re-fetch school data
 * to export: this adds zero network/DB traffic.
 */
export type ClassRosterCsvStudent = {
  id: string;
  class_id: string | null;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  matricule?: string | null;
  gender?: string | null;
  birthdate?: string | null;
  birth_date?: string | null;
};

export const ORDINARY_CLASS_CSV_HEADERS = [
  "N°", "Matricule", "Nom", "Prénoms", "Sexe",
  "Date de naissance", "Classe", "Année scolaire",
] as const;

function cell(value: unknown): string {
  const text = String(value ?? "").replace(/\r\n?/g, "\n");
  // Prevent spreadsheet formula execution (including after leading whitespace)
  // when a user opens CSV content in Excel or LibreOffice.
  const safe = /^[\s\uFEFF]*[=+@-]/u.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function displayDate(date: string | null | undefined): string {
  if (!date) return "";
  const match = String(date).match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  return match ? match[3] + "/" + match[2] + "/" + match[1] : String(date);
}

export function buildOrdinaryClassRosterCsv(input: {
  classId: string;
  classLabel: string;
  academicYear: string;
  students: readonly ClassRosterCsvStudent[];
}): { csv: string; count: number } {
  if (!input.classId.trim() || !input.classLabel.trim()) {
    throw new Error("Sélectionnez une classe avant l'export CSV.");
  }

  const rows = input.students
    .filter(student => student.class_id === input.classId)
    .sort((a, b) => {
      const aName = [a.last_name, a.first_name].filter(Boolean).join(" ").trim() ||
        (a.full_name || "");
      const bName = [b.last_name, b.first_name].filter(Boolean).join(" ").trim() ||
        (b.full_name || "");
      return aName.localeCompare(bName, "fr", { sensitivity: "base", numeric: true })
        || String(a.matricule || "").localeCompare(String(b.matricule || ""), "fr");
    });

  const lines = [ORDINARY_CLASS_CSV_HEADERS.map(cell).join(";")];
  for (const [i, student] of rows.entries()) {
    const lastName = String(student.last_name || "").trim();
    const firstName = String(student.first_name || "").trim();
    const fallbackName = !lastName && !firstName ? String(student.full_name || "").trim() : "";
    lines.push([
      i + 1,
      student.matricule,
      lastName || fallbackName,
      firstName,
      student.gender,
      displayDate(student.birthdate || student.birth_date),
      input.classLabel,
      input.academicYear,
    ].map(cell).join(";"));
  }
  // French Excel compatibility: ';' delimiter, UTF-8 BOM and CRLF.
  return { csv: "\uFEFF" + lines.join("\r\n") + "\r\n", count: rows.length };
}

export function ordinaryClassRosterCsvFilename(input: {
  institutionName: string;
  classLabel: string;
  academicYear: string;
}): string {
  const slug = (s: string) => String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
    .toLowerCase().slice(0, 70);
  return [
    "liste_classe",
    slug(input.institutionName) || "etablissement",
    slug(input.classLabel) || "classe",
    slug(input.academicYear) || "annee",
  ].join("_") + ".csv";
}
