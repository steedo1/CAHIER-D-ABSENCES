export type FinanceStudentProfileLike = {
  is_affecte?: boolean | null;
  is_boarder?: boolean | null;
};

export type FinanceFeeCategoryLike = {
  id?: string | null;
  code?: string | null;
  name?: string | null;
  is_mandatory?: boolean | null;
};

export type FinanceScheduleLike = {
  id?: string | null;
  label?: string | null;
  fee_category_id?: string | null;
  class_id?: string | null;
  academic_year?: string | null;
};

export type FinanceClassLike = {
  id?: string | null;
  label?: string | null;
  code?: string | null;
  level?: string | null;
  academic_year?: string | null;
};

export type FinanceScheduleKind =
  | "scolarite"
  | "internat"
  | "cours_renforcement"
  | "kit_livre"
  | "custom";

export function normalizeFinanceText(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function textContainsAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function sameNormalizedText(a: unknown, b: unknown) {
  const left = normalizeFinanceText(a);
  const right = normalizeFinanceText(b);
  return !!left && !!right && left === right;
}

export function financeClassIdentityMatches(
  targetClass: FinanceClassLike | null | undefined,
  candidateClass: FinanceClassLike | null | undefined,
) {
  if (!targetClass || !candidateClass) return false;

  const targetId = String(targetClass.id || "").trim();
  const candidateId = String(candidateClass.id || "").trim();
  if (targetId && candidateId && targetId === candidateId) return true;

  // Garde-fou important : certains barèmes importés peuvent pointer vers une
  // ancienne ligne de classe ayant le même libellé (ex. 1D) mais un autre id.
  // La comparaison par libellé/code évite que la finance ignore ces barèmes.
  if (sameNormalizedText(targetClass.label, candidateClass.label)) return true;
  if (sameNormalizedText(targetClass.code, candidateClass.code)) return true;

  return false;
}

export function financeBuildCompatibleClassIds(
  targetClass: FinanceClassLike,
  allClasses: FinanceClassLike[] = [],
) {
  const ids = new Set<string>();
  const targetId = String(targetClass.id || "").trim();
  if (targetId) ids.add(targetId);

  for (const candidate of allClasses) {
    const candidateId = String(candidate.id || "").trim();
    if (!candidateId) continue;
    if (financeClassIdentityMatches(targetClass, candidate)) ids.add(candidateId);
  }

  return ids;
}

export function financeScheduleMatchesClassYear(
  schedule: FinanceScheduleLike,
  targetClass: FinanceClassLike,
  compatibleClassIds: Set<string> = financeBuildCompatibleClassIds(targetClass),
) {
  const scheduleClassId = String(schedule.class_id || "").trim();
  const scheduleAcademicYear = String(schedule.academic_year || "").trim();
  const targetAcademicYear = String(targetClass.academic_year || "").trim();

  const classMatches = !scheduleClassId || compatibleClassIds.has(scheduleClassId);
  const yearMatches =
    !targetAcademicYear || !scheduleAcademicYear || scheduleAcademicYear === targetAcademicYear;

  return classMatches && yearMatches;
}

export function financeCategoryKind(
  category: FinanceFeeCategoryLike | null | undefined,
): FinanceScheduleKind | null {
  const text = normalizeFinanceText(`${category?.code || ""} ${category?.name || ""}`);

  if (textContainsAny(text, ["internat", "pension"])) return "internat";
  if (
    textContainsAny(text, [
      "scolarite",
      "ecolage",
      "inscription",
      "frais generaux",
      "frais annexes scolarite",
    ])
  ) {
    return "scolarite";
  }
  if (textContainsAny(text, ["renforcement"])) return "cours_renforcement";
  if (textContainsAny(text, ["kit livre", "kit_livre", "livre", "livres"])) return "kit_livre";

  return null;
}

export function financeScheduleKind(
  schedule: FinanceScheduleLike,
  categoriesById: Map<string, FinanceFeeCategoryLike> = new Map(),
): FinanceScheduleKind {
  const label = normalizeFinanceText(schedule.label);
  const category = categoriesById.get(String(schedule.fee_category_id || ""));
  const categoryKind = financeCategoryKind(category);

  if (
    categoryKind === "internat" ||
    textContainsAny(label, ["internat", "pension", "trousseau"])
  ) {
    return "internat";
  }

  if (
    categoryKind === "scolarite" ||
    textContainsAny(label, [
      "scolarite",
      "ecolage",
      "inscription",
      "frais generaux",
      "frais annexes scolarite",
    ])
  ) {
    return "scolarite";
  }

  if (categoryKind === "cours_renforcement" || label.includes("renforcement")) {
    return "cours_renforcement";
  }

  if (categoryKind === "kit_livre" || textContainsAny(label, ["kit livre", "livre", "livres"])) {
    return "kit_livre";
  }

  return "custom";
}

export function financeScheduleAppliesToStudent(
  schedule: FinanceScheduleLike,
  student: FinanceStudentProfileLike,
  categoriesById: Map<string, FinanceFeeCategoryLike> = new Map(),
) {
  const label = normalizeFinanceText(schedule.label);
  const kind = financeScheduleKind(schedule, categoriesById);

  if (kind === "internat") return student.is_boarder === true;

  if (kind === "scolarite") {
    const isNonAffecteFee = label.includes("non affecte") || label.includes("non-affecte");
    const isEcolageFee = label.includes("ecolage");
    const isAffecteFee = label.includes("affecte");

    // L'ordre est volontaire : "non affecté" contient aussi "affecté".
    if (isNonAffecteFee) return student.is_affecte === false;
    if (isEcolageFee && isAffecteFee) return student.is_affecte === true;
    return true;
  }

  // Les cours de renforcement, kits et barèmes personnalisés restent appliqués
  // automatiquement. S'ils ne doivent concerner qu'une partie des élèves, ils
  // doivent être gérés par un filtre métier plus précis dans le barème.
  return true;
}

export function buildFinanceScheduleCoverageWarning({
  schedules,
  categoriesById,
  studentProfile,
  classLabel,
}: {
  schedules: FinanceScheduleLike[];
  categoriesById?: Map<string, FinanceFeeCategoryLike>;
  studentProfile: FinanceStudentProfileLike;
  classLabel?: string | null;
}) {
  const map = categoriesById || new Map<string, FinanceFeeCategoryLike>();
  const kinds = new Set(schedules.map((schedule) => financeScheduleKind(schedule, map)));
  const label = classLabel ? ` pour ${classLabel}` : "";
  const warnings: string[] = [];

  if (!kinds.has("scolarite")) {
    warnings.push(
      `Aucun barème de scolarité actif${label}. La dette ne peut pas être complète tant que les barèmes scolarité ne sont pas actifs/rattachés à la classe et à l'année.`,
    );
  }

  if (studentProfile.is_boarder === true && !kinds.has("internat")) {
    warnings.push(
      `Élève marqué interne, mais aucun barème d'internat actif${label}. Le passage EXT → Interne ne peut donc pas créer la pension/internat.`,
    );
  }

  return warnings;
}
