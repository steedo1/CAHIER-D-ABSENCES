import {
  defaultSubjectHours,
  defaultSubjects,
} from "../catalog/defaultCatalog";
import type { DefaultSubjectHour, SubjectDefinition } from "../catalog/types";
import type { Room, SchoolClass } from "../scheduler/types";

export type OfficialTrackCode =
  | "6eme"
  | "5eme"
  | "4eme"
  | "3eme"
  | "2ndeA"
  | "2ndeC"
  | "1ereA1"
  | "1ereA2"
  | "1ereC"
  | "1ereD"
  | "tleA1"
  | "tleA2"
  | "tleC"
  | "tleD";

const OFFICIAL_TRACK_CODES = new Set<string>([
  "6eme",
  "5eme",
  "4eme",
  "3eme",
  "2ndeA",
  "2ndeC",
  "1ereA1",
  "1ereA2",
  "1ereC",
  "1ereD",
  "tleA1",
  "tleA2",
  "tleC",
  "tleD",
]);

export type BootstrapSubjectLike = {
  id: string;
  label?: string | null;
  code?: string | null;
};

export type BootstrapClassLike = {
  id: string;
  label?: string | null;
  level?: string | null;
  level_code?: string | null;
  series_code?: string | null;
  official_track_code?: string | null;
  officialTrackCode?: string | null;
};

export type ClassAcademicProfile = {
  label: string;
  level_code: string;
  series_code: string | null;
  official_track_code: OfficialTrackCode | null;
  official_track_source: "official" | "inferred" | "missing";
};

export type HoraclasseServiceMeta = {
  class_id: string;
  class_label: string;
  level_code: string;
  series_code: string | null;
  official_track_code: OfficialTrackCode | null;
  official_track_source: "official" | "inferred" | "missing";
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

function normalizeKey(value: unknown): string {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeOfficialTrackCode(value: unknown): OfficialTrackCode | null {
  const raw = clean(value);
  if (!raw) return null;
  return OFFICIAL_TRACK_CODES.has(raw) ? (raw as OfficialTrackCode) : null;
}

export function inferOfficialTrackCodeFromClass(value: unknown): OfficialTrackCode | null {
  const key = normalizeKey(value);
  if (!key) return null;

  if (/^6/.test(key)) return "6eme";
  if (/^5/.test(key)) return "5eme";
  if (/^4/.test(key)) return "4eme";
  if (/^3/.test(key)) return "3eme";

  if (/^(2NDEA|SECONDEA|2A)/.test(key)) return "2ndeA";
  if (/^(2NDEC|SECONDEC|2C)/.test(key)) return "2ndeC";

  if (/^(1ERED|PREMIERED|1D)/.test(key)) return "1ereD";
  if (/^(1EREC|PREMIEREC|1C)/.test(key)) return "1ereC";
  if (/^(1EREA1|PREMIEREA1|1A1)/.test(key)) return "1ereA1";
  if (/^(1EREA2|PREMIEREA2|1A2)/.test(key)) return "1ereA2";
  if (/^(1EREA|PREMIEREA|1A)/.test(key)) return "1ereA2";

  if (/^(TLED|TERMINALED|TD)/.test(key)) return "tleD";
  if (/^(TLEC|TERMINALEC|TC)/.test(key)) return "tleC";
  if (/^(TLEA1|TERMINALEA1|TA1)/.test(key)) return "tleA1";
  if (/^(TLEA2|TERMINALEA2|TA2)/.test(key)) return "tleA2";
  if (/^(TLEA|TERMINALEA|TA)/.test(key)) return "tleA2";

  return null;
}

export function officialTrackToLevelCode(track: OfficialTrackCode | null): string | null {
  switch (track) {
    case "6eme":
      return "6e";
    case "5eme":
      return "5e";
    case "4eme":
      return "4e";
    case "3eme":
      return "3e";
    case "2ndeA":
      return "2A";
    case "2ndeC":
      return "2C";
    case "1ereA1":
    case "1ereA2":
      return "1A";
    case "1ereC":
      return "1C";
    case "1ereD":
      return "1D";
    case "tleA1":
    case "tleA2":
      return "TleA";
    case "tleC":
      return "TleC";
    case "tleD":
      return "TleD";
    default:
      return null;
  }
}

export function officialTrackToSeriesCode(track: OfficialTrackCode | null): string | null {
  switch (track) {
    case "2ndeA":
      return "A";
    case "2ndeC":
      return "C";
    case "1ereA1":
    case "tleA1":
      return "A1";
    case "1ereA2":
    case "tleA2":
      return "A2";
    case "1ereC":
    case "tleC":
      return "C";
    case "1ereD":
    case "tleD":
      return "D";
    default:
      return null;
  }
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

export function buildClassAcademicProfile(input: {
  label?: unknown;
  level?: unknown;
  level_code?: unknown;
  series_code?: unknown;
  official_track_code?: unknown;
  officialTrackCode?: unknown;
}): ClassAcademicProfile {
  const label = clean(input.label, "Classe");
  const official = normalizeOfficialTrackCode(input.official_track_code ?? input.officialTrackCode ?? null);
  if (official) {
    const levelCode = officialTrackToLevelCode(official) || inferLevelCode(input.level_code || input.level || label);
    return {
      label,
      level_code: levelCode,
      series_code: officialTrackToSeriesCode(official) || clean(input.series_code) || inferSeriesCode(levelCode),
      official_track_code: official,
      official_track_source: "official",
    };
  }

  const inferred = inferOfficialTrackCodeFromClass(input.level_code || input.level || label);
  const levelCode = officialTrackToLevelCode(inferred) || clean(input.level_code) || inferLevelCode(input.level || label);

  return {
    label,
    level_code: levelCode,
    series_code: officialTrackToSeriesCode(inferred) || clean(input.series_code) || inferSeriesCode(levelCode),
    official_track_code: inferred,
    official_track_source: inferred ? "inferred" : "missing",
  };
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
    const profile = buildClassAcademicProfile(item);
    return {
      id: clean(item.id),
      name: profile.label,
      shortName: profile.label,
      levelCode: profile.level_code,
      seriesCode: profile.series_code,
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
