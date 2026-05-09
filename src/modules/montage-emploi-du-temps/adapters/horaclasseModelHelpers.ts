import {
  defaultSubjectHours,
  defaultSubjects,
} from "../catalog/defaultCatalog";
import type { DefaultSubjectHour, SubjectDefinition } from "../catalog/types";
import type { Room, SchoolClass } from "../scheduler/types";

export type BootstrapSubjectLike = {
  id: string;
  label?: string | null;
  code?: string | null;
};

export type BootstrapClassLike = {
  id: string;
  label?: string | null;
  level_code?: string | null;
  series_code?: string | null;
};

export type HoraclasseServiceMeta = {
  class_id: string;
  class_label: string;
  level_code: string;
  series_code: string | null;
  teacher_id: string;
  teacher_name: string;
  subject_id: string;
  subject_label: string;
  subject_code: string | null;
  catalog_subject_id: string;
  catalog_subject_label: string;
  weekly_units: number | null;
  split_pattern: string | null;
  room_type_required: string | null;
  source: "default_catalog" | "override" | "manual_missing_catalog";
  is_ready: boolean;
  missing_reason: string | null;
};

export function clean(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function toNumber(value: unknown, fallback = 0): number {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeText(value: unknown): string {
  return clean(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toUpperCase();
}

export function inferLevelCode(labelOrCode: unknown): string {
  const raw = normalizeText(labelOrCode);

  if (!raw) return "default";

  if (/\b6E\b/.test(raw) || /^6/.test(raw)) return "6e";
  if (/\b5E\b/.test(raw) || /^5/.test(raw)) return "5e";
  if (/\b4E\b/.test(raw) || /^4/.test(raw)) return "4e";
  if (/\b3E\b/.test(raw) || /^3/.test(raw)) return "3e";

  if (raw.includes("TERMINALE") || raw.includes("TLE") || /^T/.test(raw)) {
    if (raw.includes(" D") || raw.endsWith("D") || raw.includes("TD")) return "TleD";
    if (raw.includes(" C") || raw.endsWith("C") || raw.includes("TC")) return "TleC";
    return "TleA";
  }

  if (raw.includes("PREMIERE") || raw.includes("PREMIER") || raw.includes("1ERE") || raw.includes("1RE") || /^1/.test(raw)) {
    if (raw.includes(" D") || raw.endsWith("D") || raw.includes("1D")) return "1D";
    if (raw.includes(" C") || raw.endsWith("C") || raw.includes("1C")) return "1C";
    return "1A";
  }

  if (raw.includes("SECONDE") || raw.includes("2NDE") || /^2/.test(raw)) {
    if (raw.includes(" C") || raw.endsWith("C") || raw.includes("2C")) return "2C";
    return "2A";
  }

  return "default";
}

export function inferSeriesCode(levelCode: string): string | null {
  if (levelCode.endsWith("A")) return "A";
  if (levelCode.endsWith("C")) return "C";
  if (levelCode.endsWith("D")) return "D";
  return null;
}

export function inferCatalogSubjectId(input: {
  code?: unknown;
  label?: unknown;
  fallbackId?: unknown;
}): string {
  const code = normalizeText(input.code);
  const label = normalizeText(input.label);
  const fallback = clean(input.fallbackId);
  const value = `${code} ${label}`.trim();

  if (/\bMATHS?\b|MATHEMATIQUE/.test(value)) return "maths";

  // IMPORTANT : EPS avant P.C.
  // “Éducation Physique et Sportive” contient PHYSIQUE, mais ce n’est jamais P.C.
  if (/\bEPS\b|SPORT|PHYSIQUE ET SPORTIVE|EDUCATION PHYSIQUE/.test(value)) return "eps";

  if (/\bPC\b|\bP C\b|PHYSIQUE CHIMIE|SCIENCES PHYSIQUES|CHIMIE/.test(value)) return "pc";
  if (/\bSVT\b|SCIENCES DE LA VIE|VIE ET DE LA TERRE/.test(value)) return "svt";
  if (/\bFR\b|FRANCAIS|FRANCAISE/.test(value)) return "francais";
  if (/\bHG\b|HISTOIRE|GEOGRAPHIE/.test(value)) return "hg";
  if (/\bANG\b|ANGLAIS/.test(value)) return "anglais";
  if (/\bLV2\b|ESPAGNOL|ALLEMAND|\bESP\b|\bALL\b/.test(value)) return "lv2";
  if (/PHILO/.test(value)) return "philo";
  if (/\bEDHC\b|CITOYENNETE|DROITS DE L HOMME/.test(value)) return "edhc";
  if (/ARTS? PLASTIQUES?|PLASTIQUE/.test(value)) return "ap";
  if (/MUSIQUE|MUSICAL/.test(value)) return "musique";
  if (/\bTICE\b|INFORMATIQUE|TECHNOLOGIES DE L INFORMATION/.test(value)) return "informatique";
  if (/ENTREPRENE/.test(value)) return "entrepreneuriat";

  // Règle finale : on ne devine pas. Une matière non reconnue reste à compléter.
  return fallback;
}

export function getCatalogSubject(catalogSubjectId: string): SubjectDefinition | null {
  return defaultSubjects.find((item) => item.id === catalogSubjectId) || null;
}

export function findDefaultSubjectHour(levelCode: string, catalogSubjectId: string): DefaultSubjectHour | null {
  return (
    defaultSubjectHours.find(
      (item) => item.levelCode === levelCode && item.subjectId === catalogSubjectId,
    ) || null
  );
}

export function inferRoomTypeFromCatalogSubject(catalogSubjectId: string): string | null {
  return getCatalogSubject(catalogSubjectId)?.defaultRoomType ?? null;
}

export function buildSchoolClasses(classesRaw: BootstrapClassLike[]): SchoolClass[] {
  return classesRaw.map((item, index) => {
    const label = clean(item.label, "Classe");
    const levelCode = clean(item.level_code) || inferLevelCode(label);
    return {
      id: clean(item.id),
      name: label,
      shortName: label,
      levelCode,
      seriesCode: clean(item.series_code) || inferSeriesCode(levelCode),
      displayOrder: index + 1,
    };
  });
}

export function defaultRoomsForClasses(classes: SchoolClass[]): Room[] {
  return [
    ...classes.map((schoolClass) => ({
      id: `room_${schoolClass.id}`,
      name: `Salle ${schoolClass.shortName}`,
      roomType: "ordinary" as const,
    })),
    { id: "sports_field_default", name: "Terrain EPS", roomType: "sports_field" as const },
    { id: "pc_lab_default", name: "Laboratoire P.C", roomType: "pc_lab" as const },
    { id: "svt_lab_default", name: "Laboratoire SVT", roomType: "svt_lab" as const },
    { id: "computer_lab_default", name: "Salle informatique", roomType: "computer_lab" as const },
  ];
}
