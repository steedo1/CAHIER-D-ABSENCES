import { primaryArabicSubjectLabel } from "./primary-arabic-bulletin-labels";

/** Bilingual labels exclusively for Arabic teaching class lists.
 * Presentation only: neither course labels nor student identities are changed.
 */
const LEVEL_LABELS: Record<string, string> = {
  MATERNELLE: "الروضة",
  MAT: "الروضة",
  CP1: "السنة الأولى الابتدائية",
  CP2: "السنة الثانية الابتدائية",
  CE1: "السنة الثالثة الابتدائية",
  CE2: "السنة الرابعة الابتدائية",
  CM1: "السنة الخامسة الابتدائية",
  CM2: "السنة السادسة الابتدائية",
  "6E": "الصف السادس",
  "6EME": "الصف السادس",
};

export function arabicClassListLevel(level: string | null | undefined, frenchLabel: string): string {
  const key = String(level || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]/g, "");
  const arabic = LEVEL_LABELS[key];
  return arabic ? `${arabic} (${level || frenchLabel})` : frenchLabel;
}

/** Show the bilingual Arabic term in short paper-note headers,
 * with the complete wording in the subject legend.
 */
export function arabicClassListSubject(name: string, shortName: string): {
  header: string;
  legend: string;
} {
  const arabic = primaryArabicSubjectLabel(name);
  if (!arabic) return { header: shortName, legend: name };
  const firstTerm = arabic.split(/\s+/).slice(0, 2).join(" ");
  return { header: firstTerm, legend: `${arabic} (${name})` };
}

export function isValidWrittenArabicName(value: unknown): value is string {
  return typeof value === "string" &&
    value.trim().length <= 140 &&
    !/[\u0000-\u001F\u007F]/.test(value) &&
    (!value.trim() || /[\u0621-\u064A\u0671-\u06D3]/u.test(value));
}

/** Arabic teaching class lists use the written Arabic name as their sort key.
 * Pupils without an Arabic transcription remain visible, after the Arabic names.
 * Sorting never changes the canonical student record or its French spelling.
 */
type ArabicListStudentName = {
  id?: string | null;
  full_name_ar?: string | null;
  full_name?: string | null;
  last_name?: string | null;
  first_name?: string | null;
};

const ARABIC_STUDENT_COLLATOR = new Intl.Collator("ar", {
  sensitivity: "base",
  numeric: true,
});
const FRENCH_STUDENT_COLLATOR = new Intl.Collator("fr", {
  sensitivity: "base",
  numeric: true,
});

export function compareArabicClassListStudents(
  a: ArabicListStudentName,
  b: ArabicListStudentName,
): number {
  const nameA = String(a.full_name_ar || "").trim();
  const nameB = String(b.full_name_ar || "").trim();

  if (nameA && nameB) {
    const arabicResult = ARABIC_STUDENT_COLLATOR.compare(nameA, nameB);
    if (arabicResult !== 0) return arabicResult;
  } else if (nameA || nameB) {
    return nameA ? -1 : 1;
  }

  // Stable fallback for equal Arabic names and pupils without Arabic spelling.
  const frenchKey = (student: ArabicListStudentName) =>
    [student.last_name, student.first_name]
      .map(value => String(value || "").trim())
      .filter(Boolean)
      .join(" ") || String(student.full_name || "").trim();
  return FRENCH_STUDENT_COLLATOR.compare(frenchKey(a), frenchKey(b)) ||
    String(a.id || "").localeCompare(String(b.id || ""));
}
