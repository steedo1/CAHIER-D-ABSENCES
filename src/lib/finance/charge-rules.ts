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

export type FinanceClassLike = {
  id?: string | null;
  label?: string | null;
  code?: string | null;
  level?: string | null;
  academic_year?: string | null;
  official_track_code?: string | null;
};

export type FinanceScheduleLike = {
  id?: string | null;
  label?: string | null;
  fee_category_id?: string | null;
  class_id?: string | null;
  academic_year?: string | null;
  amount?: number | string | null;
  due_date?: string | null;
};

export type FinanceScheduleKind =
  | "scolarite"
  | "internat"
  | "cours_renforcement"
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


function cleanFinanceId(value: unknown) {
  return String(value ?? "").trim();
}

function sameNormalizedText(a: unknown, b: unknown) {
  const left = normalizeFinanceText(a);
  const right = normalizeFinanceText(b);
  return Boolean(left && right && left === right);
}

type FinanceGradeFamily =
  | "6eme"
  | "5eme"
  | "4eme"
  | "3eme"
  | "2nde"
  | "1ere"
  | "terminale";

function financeClassGradeFamily(
  row: FinanceClassLike | null | undefined,
): FinanceGradeFamily | null {
  const values = [
    row?.official_track_code,
    row?.level,
    row?.code,
    row?.label,
  ];

  for (const value of values) {
    const compact = normalizeFinanceText(value).replace(/[^a-z0-9]/g, "");
    if (!compact) continue;

    if (/^(6e|6eme|sixieme)/.test(compact)) return "6eme";
    if (/^(5e|5eme|cinquieme)/.test(compact)) return "5eme";
    if (/^(4e|4eme|quatrieme)/.test(compact)) return "4eme";
    if (/^(3e|3eme|troisieme)/.test(compact)) return "3eme";
    if (/^(2nde|2de|seconde|2a|2c|2d)/.test(compact)) return "2nde";
    if (/^(1ere|1re|premiere|1a|1c|1d)/.test(compact)) return "1ere";
    if (/^(tle|terminale|ta|tc|td)/.test(compact)) return "terminale";
  }

  return null;
}

function scheduleYearMatchesClass(
  schedule: FinanceScheduleLike,
  targetClass: FinanceClassLike,
) {
  const scheduleYear = normalizeFinanceText(schedule.academic_year);
  const classYear = normalizeFinanceText(targetClass.academic_year);
  return !scheduleYear || !classYear || scheduleYear === classYear;
}

function financeClassMatchPriority(
  schedule: FinanceScheduleLike,
  targetClass: FinanceClassLike,
  classesById: Map<string, FinanceClassLike>,
) {
  const scheduleClassId = cleanFinanceId(schedule.class_id);
  const targetClassId = cleanFinanceId(targetClass.id);

  if (!scheduleClassId) return 0;
  if (targetClassId && scheduleClassId === targetClassId) return 0;

  const sourceClass = classesById.get(scheduleClassId);
  if (!sourceClass) return null;

  if (
    sameNormalizedText(sourceClass.label, targetClass.label) ||
    sameNormalizedText(sourceClass.code, targetClass.code)
  ) {
    return 1;
  }

  // Filet de sécurité pour les classes recréées ou dupliquées :
  // les barèmes existent parfois sur une ancienne classe du même niveau
  // (ex. 1D), alors que la classe active est 1D1/1D2.
  if (
    sameNormalizedText(sourceClass.official_track_code, targetClass.official_track_code) ||
    sameNormalizedText(sourceClass.level, targetClass.level)
  ) {
    return 2;
  }

  // Dernier filet de sécurité, sans dépendre des catégories d'un établissement :
  // une classe 1D1 peut reprendre un barème de 1A lorsque les deux appartiennent
  // clairement à la même famille pédagogique (ici 1ère). La sélection finale
  // rejettera ce secours si plusieurs montants concurrents existent.
  const sourceFamily = financeClassGradeFamily(sourceClass);
  const targetFamily = financeClassGradeFamily(targetClass);
  if (sourceFamily && targetFamily && sourceFamily === targetFamily) {
    return 3;
  }

  return null;
}

function stripKnownClassSuffixFromNormalizedLabel(
  normalizedLabel: string,
  classLabels: string[],
) {
  let result = normalizedLabel;
  const suffixes = Array.from(
    new Set(
      classLabels
        .map((label) => normalizeFinanceText(label))
        .filter(Boolean)
        .sort((a, b) => b.length - a.length),
    ),
  );

  for (const classLabel of suffixes) {
    const suffix = ` - ${classLabel}`;
    if (result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length).trim();
      break;
    }
  }

  return result || normalizedLabel;
}

function financeScheduleSemanticKey(
  schedule: FinanceScheduleLike,
  targetClass: FinanceClassLike,
  classesById: Map<string, FinanceClassLike>,
  categoriesById: Map<string, FinanceFeeCategoryLike>,
) {
  const sourceClass = classesById.get(cleanFinanceId(schedule.class_id));
  const comparableClassLabels = [
    targetClass.label,
    targetClass.code,
    sourceClass?.label,
    sourceClass?.code,
    ...Array.from(classesById.values())
      .filter(
        (row) =>
          sameNormalizedText(row.level, targetClass.level) ||
          sameNormalizedText(row.official_track_code, targetClass.official_track_code) ||
          (financeClassGradeFamily(row) !== null &&
            financeClassGradeFamily(row) === financeClassGradeFamily(targetClass)),
      )
      .flatMap((row) => [row.label, row.code]),
  ]
    .map((value) => String(value ?? ""))
    .filter(Boolean);

  const normalizedLabel = stripKnownClassSuffixFromNormalizedLabel(
    normalizeFinanceText(schedule.label),
    comparableClassLabels,
  );

  return [
    financeScheduleKind(schedule, categoriesById),
    cleanFinanceId(schedule.fee_category_id),
    normalizedLabel,
    cleanFinanceId(schedule.due_date),
  ].join("|");
}

function financeScheduleBusinessKey(
  schedule: FinanceScheduleLike,
  targetClass: FinanceClassLike,
  classesById: Map<string, FinanceClassLike>,
  categoriesById: Map<string, FinanceFeeCategoryLike>,
) {
  const sourceClass = classesById.get(cleanFinanceId(schedule.class_id));
  const comparableClassLabels = [
    targetClass.label,
    targetClass.code,
    sourceClass?.label,
    sourceClass?.code,
    ...Array.from(classesById.values())
      .filter(
        (row) =>
          sameNormalizedText(row.level, targetClass.level) ||
          sameNormalizedText(row.official_track_code, targetClass.official_track_code) ||
          (financeClassGradeFamily(row) !== null &&
            financeClassGradeFamily(row) === financeClassGradeFamily(targetClass)),
      )
      .flatMap((row) => [row.label, row.code]),
  ]
    .map((value) => String(value ?? ""))
    .filter(Boolean);

  const normalizedLabel = stripKnownClassSuffixFromNormalizedLabel(
    normalizeFinanceText(schedule.label),
    comparableClassLabels,
  );

  const amount = Number(schedule.amount || 0);
  const amountKey = Number.isFinite(amount) ? amount.toFixed(2) : "0.00";

  return [
    financeScheduleKind(schedule, categoriesById),
    cleanFinanceId(schedule.fee_category_id),
    normalizedLabel,
    amountKey,
    cleanFinanceId(schedule.due_date),
  ].join("|");
}

export function financeScheduleLabelForClass(
  schedule: FinanceScheduleLike,
  targetClass: FinanceClassLike,
  classesById: Map<string, FinanceClassLike> = new Map(),
) {
  const original = String(schedule.label ?? "").trim();
  const targetLabel = String(targetClass.label ?? targetClass.code ?? "").trim();
  const sourceClass = classesById.get(cleanFinanceId(schedule.class_id));
  const sourceLabels = [sourceClass?.label, sourceClass?.code]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (!original || !targetLabel || sourceLabels.length === 0) return original;

  for (const sourceLabel of sourceLabels) {
    const escaped = sourceLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\s*-\\s*${escaped}\\s*$`, "i");
    if (pattern.test(original)) return original.replace(pattern, ` - ${targetLabel}`);
  }

  return original;
}

export function selectFinanceSchedulesForClass<T extends FinanceScheduleLike>({
  schedules,
  targetClass,
  classesById = new Map(),
  categoriesById = new Map(),
}: {
  schedules: T[];
  targetClass: FinanceClassLike;
  classesById?: Map<string, FinanceClassLike>;
  categoriesById?: Map<string, FinanceFeeCategoryLike>;
}) {
  const candidates = schedules
    .map((schedule) => {
      if (!scheduleYearMatchesClass(schedule, targetClass)) return null;
      const priority = financeClassMatchPriority(schedule, targetClass, classesById);
      if (priority === null) return null;
      return { schedule, priority };
    })
    .filter(Boolean) as Array<{ schedule: T; priority: number }>;

  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return normalizeFinanceText(a.schedule.label).localeCompare(
      normalizeFinanceText(b.schedule.label),
      "fr",
      { numeric: true, sensitivity: "base" },
    );
  });

  const semanticRows = candidates.map((candidate) => ({
    ...candidate,
    semanticKey: financeScheduleSemanticKey(
      candidate.schedule,
      targetClass,
      classesById,
      categoriesById,
    ),
    amountKey: Number(candidate.schedule.amount || 0).toFixed(2),
  }));

  const bestPriorityBySemanticKey = new Map<string, number>();
  for (const candidate of semanticRows) {
    const best = bestPriorityBySemanticKey.get(candidate.semanticKey);
    if (best === undefined || candidate.priority < best) {
      bestPriorityBySemanticKey.set(candidate.semanticKey, candidate.priority);
    }
  }

  // Un barème directement lié à la classe doit toujours gagner, même si un
  // barème de secours du même niveau porte un autre montant. Pour les secours
  // par niveau/famille (priorités 2 et 3), plusieurs montants concurrents sont
  // considérés comme ambigus : le moteur n'invente alors aucun tarif.
  const amountsByFallbackSemanticKey = new Map<string, Set<string>>();
  for (const candidate of semanticRows) {
    const best = bestPriorityBySemanticKey.get(candidate.semanticKey);
    if (candidate.priority !== best || candidate.priority < 2) continue;
    const amounts = amountsByFallbackSemanticKey.get(candidate.semanticKey) || new Set<string>();
    amounts.add(candidate.amountKey);
    amountsByFallbackSemanticKey.set(candidate.semanticKey, amounts);
  }

  const ambiguousFallbackKeys = new Set(
    Array.from(amountsByFallbackSemanticKey.entries())
      .filter(([, amounts]) => amounts.size > 1)
      .map(([key]) => key),
  );

  const selectedByKey = new Map<string, { schedule: T; priority: number }>();

  for (const candidate of semanticRows) {
    if (candidate.priority !== bestPriorityBySemanticKey.get(candidate.semanticKey)) continue;
    if (ambiguousFallbackKeys.has(candidate.semanticKey)) continue;

    const key = financeScheduleBusinessKey(
      candidate.schedule,
      targetClass,
      classesById,
      categoriesById,
    );
    const existing = selectedByKey.get(key);
    if (!existing || candidate.priority < existing.priority) {
      selectedByKey.set(key, candidate);
    }
  }

  return Array.from(selectedByKey.values()).map((item) => item.schedule);
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

  // Les cours de renforcement et les barèmes personnalisés restent appliqués
  // automatiquement, comme avant. S'ils ne doivent concerner qu'une partie
  // des élèves, ils doivent être gérés par un filtre métier plus précis.
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
