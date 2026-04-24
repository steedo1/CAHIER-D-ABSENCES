// src/lib/default-general-secondary-coefficients-ci.ts
// Référentiel par défaut — coefficients CI du secondaire général.
// Objectif : préremplir uniquement les disciplines/niveaux reconnus,
// sans créer de disciplines et sans modifier les matières non reconnues.

export type GeneralSecondarySubjectKey =
  | "english"
  | "arts_music"
  | "edhc"
  | "eps"
  | "french"
  | "history_geo"
  | "second_language"
  | "german"
  | "spanish"
  | "mathematics"
  | "philosophy"
  | "physics_chemistry"
  | "svt";

export type GeneralSecondaryLevelKey =
  | "6e"
  | "5e"
  | "4e"
  | "3e"
  | "2A"
  | "2C"
  | "1A"
  | "1A1"
  | "1A2"
  | "1C"
  | "1D"
  | "TA"
  | "TA1"
  | "TA2"
  | "TC"
  | "TD";

export type GeneralSecondaryCoeffComponentPreset = {
  code: string;
  label: string;
  coeff: number;
  order_index: number;
};

export type GeneralSecondaryCoeffPresetEntry = {
  coeff: number;
  optional?: boolean;
  note?: string;
  components?: GeneralSecondaryCoeffComponentPreset[];
};

export type GeneralSecondaryCoeffPresetPreviewItem = {
  level: string;
  levelKey: GeneralSecondaryLevelKey | null;
  subject_id: string;
  subject_name: string;
  subjectKey: GeneralSecondarySubjectKey | null;
  presetLabel: string | null;
  currentCoeff: number;
  coeff: number | null;
  optional: boolean;
  willApply: boolean;
  components: GeneralSecondaryCoeffComponentPreset[];
  note: string;
};

type SubjectCoeffLike = {
  level: string;
  subject_id: string;
  subject_name: string;
  coeff: number;
};

type SubjectComponentLike = {
  subject_id: string;
  subject_name: string;
  component_id: string;
  component_name: string;
  coeff: number;
  level?: string;
  code?: string;
  order_index?: number;
  is_active?: boolean;
};

const SUBJECT_LABELS: Record<GeneralSecondarySubjectKey, string> = {
  english: "Anglais",
  arts_music: "Dessin / Éducation musicale",
  edhc: "E.D.H.C.",
  eps: "E.P.S.",
  french: "Français",
  history_geo: "Histoire-Géographie",
  second_language: "LV2",
  german: "Allemand",
  spanish: "Espagnol",
  mathematics: "Mathématiques",
  philosophy: "Philosophie",
  physics_chemistry: "Physique-Chimie",
  svt: "S.V.T.",
};

const FRENCH_COMPONENTS_3: GeneralSecondaryCoeffComponentPreset[] = [
  { code: "fr_compo", label: "Composition française", coeff: 1, order_index: 1 },
  { code: "fr_oral", label: "Expression orale", coeff: 1, order_index: 2 },
  { code: "fr_og", label: "Orthographe-Grammaire", coeff: 1, order_index: 3 },
];

const FRENCH_COMPONENTS_4: GeneralSecondaryCoeffComponentPreset[] = [
  { code: "fr_compo", label: "Composition française", coeff: 2, order_index: 1 },
  { code: "fr_oral", label: "Expression orale", coeff: 1, order_index: 2 },
  { code: "fr_og", label: "Orthographe-Grammaire", coeff: 1, order_index: 3 },
];

function row(coeff: number, options: Omit<GeneralSecondaryCoeffPresetEntry, "coeff"> = {}): GeneralSecondaryCoeffPresetEntry {
  return { coeff, ...options };
}

function lv2(coeff: number, optional = false): GeneralSecondaryCoeffPresetEntry {
  return row(coeff, optional ? { optional: true, note: "LV2 facultative d'après la grille." } : {});
}

const LV2_PRESET: Partial<Record<GeneralSecondaryLevelKey, GeneralSecondaryCoeffPresetEntry>> = {
  "4e": lv2(1),
  "3e": lv2(1),
  "2A": lv2(3),
  "2C": lv2(1),
  "1A": lv2(3),
  "1A1": lv2(3),
  "1A2": lv2(3),
  "1C": lv2(1, true),
  "1D": lv2(1, true),
  TA: lv2(3),
  TA1: lv2(3),
  TA2: lv2(3),
  TC: lv2(1, true),
  TD: lv2(1, true),
};

const PRESET: Record<
  GeneralSecondarySubjectKey,
  Partial<Record<GeneralSecondaryLevelKey, GeneralSecondaryCoeffPresetEntry>>
> = {
  english: {
    "6e": row(2),
    "5e": row(2),
    "4e": row(2),
    "3e": row(2),
    "2A": row(3),
    "2C": row(3),
    "1A": row(4),
    "1A1": row(4),
    "1A2": row(4),
    "1C": row(2),
    "1D": row(2),
    TA: row(4),
    TA1: row(4),
    TA2: row(4),
    TC: row(1),
    TD: row(1),
  },
  arts_music: {
    "6e": row(1),
    "5e": row(1),
    "4e": row(1),
    "3e": row(1),
    "2A": row(1),
    "2C": row(1),
    "1A": row(1),
    "1A1": row(1),
    "1A2": row(1),
    "1C": row(1),
    "1D": row(1),
    TA: row(1),
    TA1: row(1),
    TA2: row(1),
    TC: row(1),
    TD: row(1),
  },
  edhc: {
    "6e": row(1),
    "5e": row(1),
    "4e": row(1),
    "3e": row(1),
  },
  eps: {
    "6e": row(1),
    "5e": row(1),
    "4e": row(1),
    "3e": row(1),
    "2A": row(1),
    "2C": row(1),
    "1A": row(1),
    "1A1": row(1),
    "1A2": row(1),
    "1C": row(1),
    "1D": row(1),
    TA: row(1),
    TA1: row(1),
    TA2: row(1),
    TC: row(1),
    TD: row(1),
  },
  french: {
    "6e": row(3, { components: FRENCH_COMPONENTS_3 }),
    "5e": row(3, { components: FRENCH_COMPONENTS_3 }),
    "4e": row(4, { components: FRENCH_COMPONENTS_4 }),
    "3e": row(4, { components: FRENCH_COMPONENTS_4 }),
    "2A": row(4),
    "2C": row(3),
    "1A": row(4),
    "1A1": row(4),
    "1A2": row(4),
    "1C": row(3),
    "1D": row(3),
    TA: row(4),
    TA1: row(4),
    TA2: row(4),
    TC: row(3),
    TD: row(3),
  },
  history_geo: {
    "6e": row(2),
    "5e": row(2),
    "4e": row(2),
    "3e": row(2),
    "2A": row(3),
    "2C": row(2),
    "1A": row(3),
    "1A1": row(3),
    "1A2": row(3),
    "1C": row(2),
    "1D": row(2),
    TA: row(3),
    TA1: row(3),
    TA2: row(3),
    TC: row(2),
    TD: row(2),
  },
  second_language: LV2_PRESET,
  german: LV2_PRESET,
  spanish: LV2_PRESET,
  mathematics: {
    "6e": row(3),
    "5e": row(3),
    "4e": row(3),
    "3e": row(3),
    "2A": row(3),
    "2C": row(5),
    "1A1": row(3, { note: "Mathématiques A1." }),
    "1A2": row(2, { note: "Mathématiques A2." }),
    "1C": row(5),
    "1D": row(4),
    TA1: row(4, { note: "Mathématiques A1." }),
    TA2: row(2, { note: "Mathématiques A2." }),
    TC: row(5),
    TD: row(4),
  },
  philosophy: {
    "1A": row(3),
    "1A1": row(3),
    "1A2": row(3),
    "1C": row(2),
    "1D": row(2),
    TA: row(5),
    TA1: row(5),
    TA2: row(5),
    TC: row(2),
    TD: row(2),
  },
  physics_chemistry: {
    "6e": row(2),
    "5e": row(2),
    "4e": row(2),
    "3e": row(2),
    "2A": row(2),
    "2C": row(4),
    "1A": row(1),
    "1A1": row(1),
    "1A2": row(1),
    "1C": row(5),
    "1D": row(4),
    TC: row(5),
    TD: row(4),
  },
  svt: {
    "6e": row(2),
    "5e": row(2),
    "4e": row(2),
    "3e": row(2),
    "2A": row(2),
    "2C": row(2),
    "1A": row(1),
    "1A1": row(1),
    "1A2": row(1),
    "1C": row(2),
    "1D": row(4),
    TA: row(2),
    TA1: row(2),
    TA2: row(2),
    TC: row(2),
    TD: row(4),
  },
};

function normalizeText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`´]/g, " ")
    .replace(/&/g, " et ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function compactText(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

export function resolveGeneralSecondaryLevelKey(level: string): GeneralSecondaryLevelKey | null {
  const clean = normalizeText(level);
  const compact = compactText(level);

  if (!clean) return null;

  if (/(^|\s)6(e|eme|ieme)?(\s|$)/.test(clean) || clean.includes("sixieme")) return "6e";
  if (/(^|\s)5(e|eme|ieme)?(\s|$)/.test(clean) || clean.includes("cinquieme")) return "5e";
  if (/(^|\s)4(e|eme|ieme)?(\s|$)/.test(clean) || clean.includes("quatrieme")) return "4e";
  if (/(^|\s)3(e|eme|ieme)?(\s|$)/.test(clean) || clean.includes("troisieme")) return "3e";

  const hasA1 = compact.includes("a1");
  const hasA2 = compact.includes("a2");
  const hasA = /(^|\s)a(\s|$)/.test(clean) || compact.endsWith("a") || hasA1 || hasA2;
  const hasC = /(^|\s)c(\s|$)/.test(clean) || compact.endsWith("c");
  const hasD = /(^|\s)d(\s|$)/.test(clean) || compact.endsWith("d");

  const isSeconde =
    clean.includes("seconde") ||
    compact.startsWith("2nde") ||
    compact.startsWith("2de") ||
    compact === "2a" ||
    compact === "2c" ||
    compact.startsWith("2a") ||
    compact.startsWith("2c");

  if (isSeconde) {
    if (hasA) return "2A";
    if (hasC) return "2C";
    return null;
  }

  const isPremiere =
    clean.includes("premiere") ||
    compact.startsWith("1ere") ||
    compact.startsWith("1re") ||
    compact === "1a" ||
    compact === "1c" ||
    compact === "1d" ||
    compact.startsWith("1a") ||
    compact.startsWith("1c") ||
    compact.startsWith("1d");

  if (isPremiere) {
    if (hasA1) return "1A1";
    if (hasA2) return "1A2";
    if (hasA) return "1A";
    if (hasC) return "1C";
    if (hasD) return "1D";
    return null;
  }

  const isTerminale =
    clean.includes("terminale") ||
    compact.startsWith("tle") ||
    compact.startsWith("terminal") ||
    compact === "ta" ||
    compact === "tc" ||
    compact === "td" ||
    compact.startsWith("ta") ||
    compact.startsWith("tc") ||
    compact.startsWith("td");

  if (isTerminale) {
    if (hasA1) return "TA1";
    if (hasA2) return "TA2";
    if (hasA || compact.startsWith("ta")) return "TA";
    if (hasC || compact.startsWith("tc")) return "TC";
    if (hasD || compact.startsWith("td")) return "TD";
    return null;
  }

  return null;
}

export function resolveGeneralSecondarySubjectKey(subjectName: string): GeneralSecondarySubjectKey | null {
  const clean = normalizeText(subjectName);
  const compact = compactText(subjectName);

  if (!clean) return null;

  if (clean.includes("anglais") || clean.includes("english")) return "english";

  const hasDessin = clean.includes("dessin") || clean.includes("arts plastiques") || clean.includes("art plastique");
  const hasMusic = clean.includes("musique") || clean.includes("musicale") || compact.includes("edmusicale") || compact.includes("educationmusicale");
  if (hasDessin && hasMusic) return "arts_music";

  if (compact === "edhc" || clean.includes("education aux droits") || clean.includes("droit de l homme") || clean.includes("droits de l homme") || clean.includes("citoyennete")) return "edhc";
  if (compact === "eps" || clean.includes("education physique") || clean.includes("sport")) return "eps";
  if (clean.includes("francais") || clean.includes("langue francaise")) return "french";
  if ((clean.includes("histoire") && clean.includes("geographie")) || compact === "hg" || compact === "histgeo" || compact === "histoiregeographie") return "history_geo";
  if (clean.includes("allemand") || clean.includes("german")) return "german";
  if (clean.includes("espagnol") || clean.includes("spanish")) return "spanish";
  if (compact === "lv2" || clean.includes("lv 2") || clean.includes("l v 2") || clean.includes("deuxieme langue") || clean.includes("langue vivante 2")) return "second_language";
  if (clean.includes("mathematique") || clean.includes("maths") || compact === "math") return "mathematics";
  if (clean.includes("philosophie") || clean.includes("philo")) return "philosophy";
  if ((clean.includes("physique") && clean.includes("chimie")) || compact === "pc" || compact === "physiquechimie") return "physics_chemistry";
  if (compact === "svt" || clean.includes("science de la vie") || clean.includes("sciences de la vie") || clean.includes("vie et de la terre") || clean.includes("vie et terre")) return "svt";

  return null;
}

function getPresetEntry(
  subjectKey: GeneralSecondarySubjectKey | null,
  levelKey: GeneralSecondaryLevelKey | null
): { entry: GeneralSecondaryCoeffPresetEntry | null; note: string } {
  if (!subjectKey) return { entry: null, note: "Discipline non reconnue par le référentiel CI." };
  if (!levelKey) return { entry: null, note: "Niveau/série non reconnu par le référentiel CI." };

  if (subjectKey === "mathematics" && levelKey === "1A") {
    return { entry: null, note: "Mathématiques en 1ère A : précisez A1 ou A2 pour appliquer automatiquement." };
  }
  if (subjectKey === "mathematics" && levelKey === "TA") {
    return { entry: null, note: "Mathématiques en Terminale A : précisez A1 ou A2 pour appliquer automatiquement." };
  }

  const entry = PRESET[subjectKey]?.[levelKey] || null;
  if (!entry) return { entry: null, note: "Aucun coefficient prévu pour cette discipline à ce niveau/série." };
  return { entry, note: entry.note || "Coefficient reconnu." };
}

export function buildGeneralSecondaryCoefficientPreview<TCoeff extends SubjectCoeffLike>(
  subjectCoeffs: TCoeff[]
): GeneralSecondaryCoeffPresetPreviewItem[] {
  return subjectCoeffs.map((row) => {
    const subjectKey = resolveGeneralSecondarySubjectKey(row.subject_name);
    const levelKey = resolveGeneralSecondaryLevelKey(row.level);
    const { entry, note } = getPresetEntry(subjectKey, levelKey);

    return {
      level: row.level,
      levelKey,
      subject_id: row.subject_id,
      subject_name: row.subject_name,
      subjectKey,
      presetLabel: subjectKey ? SUBJECT_LABELS[subjectKey] : null,
      currentCoeff: Number(row.coeff) || 0,
      coeff: entry ? entry.coeff : null,
      optional: !!entry?.optional,
      willApply: !!entry,
      components: entry?.components || [],
      note: entry?.optional ? `${note} Matière facultative.` : note,
    };
  });
}

export function applyGeneralSecondaryCoefficientPreset<
  TCoeff extends SubjectCoeffLike,
  TComponent extends SubjectComponentLike
>(
  subjectCoeffs: TCoeff[],
  subjectComponents: TComponent[]
): {
  subjectCoeffs: TCoeff[];
  subjectComponents: TComponent[];
  preview: GeneralSecondaryCoeffPresetPreviewItem[];
  appliedCoeffs: number;
  appliedComponents: number;
  optionalCount: number;
  ambiguousCount: number;
} {
  const preview = buildGeneralSecondaryCoefficientPreview(subjectCoeffs);
  const byRow = new Map<string, GeneralSecondaryCoeffPresetPreviewItem>();

  preview.forEach((item) => {
    byRow.set(`${item.level}::${item.subject_id}`, item);
  });

  let appliedCoeffs = 0;
  let appliedComponents = 0;
  let optionalCount = 0;
  let ambiguousCount = 0;

  const componentTargets = new Set<string>();
  const componentSubjectsWithEmptyCleanup = new Set<string>();
  const newComponents: TComponent[] = [];

  const nextSubjectCoeffs = subjectCoeffs.map((row) => {
    const item = byRow.get(`${row.level}::${row.subject_id}`);
    if (!item?.willApply || item.coeff === null) {
      if (item?.note.includes("A1") || item?.note.includes("A2")) ambiguousCount += 1;
      return row;
    }

    appliedCoeffs += 1;
    if (item.optional) optionalCount += 1;

    if (item.components.length > 0) {
      const level = String(row.level || "").trim();
      componentTargets.add(`${row.subject_id}::${level}`);
      componentSubjectsWithEmptyCleanup.add(row.subject_id);

      item.components.forEach((component) => {
        appliedComponents += 1;
        newComponents.push({
          subject_id: row.subject_id,
          subject_name: row.subject_name,
          component_id: `temp_ci_${row.subject_id}_${level}_${component.code}`,
          component_name: component.label,
          coeff: component.coeff,
          level,
          code: component.code,
          order_index: component.order_index,
          is_active: true,
        } as TComponent);
      });
    }

    return {
      ...row,
      coeff: item.coeff,
    };
  });

  const keptComponents = subjectComponents.filter((component) => {
    const level = String(component.level || "").trim();
    const key = `${component.subject_id}::${level}`;

    if (componentTargets.has(key)) return false;

    // Nettoyage côté état React : les sous-matières de Français sans niveau ne doivent plus être gardées
    // quand le référentiel vient de générer des sous-matières niveau par niveau.
    if (!level && componentSubjectsWithEmptyCleanup.has(component.subject_id)) return false;

    return true;
  });

  return {
    subjectCoeffs: nextSubjectCoeffs,
    subjectComponents: [...keptComponents, ...newComponents],
    preview,
    appliedCoeffs,
    appliedComponents,
    optionalCount,
    ambiguousCount,
  };
}
