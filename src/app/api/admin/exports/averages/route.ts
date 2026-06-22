// src/app/api/admin/exports/averages/route.ts
import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getSupabaseServerClient } from "@/lib/supabase-server";

type Role = "super_admin" | "admin" | "educator" | "teacher" | "parent" | string;

type GradePeriodRow = {
  id: string;
  academic_year: string | null;
  code: string | null;
  label: string | null;
  short_label: string | null;
  start_date: string;
  end_date: string;
  coeff: number | null;
};

type ClassRow = {
  id: string;
  label?: string | null;
  code?: string | null;
  level?: string | null;
  official_track_code?: string | null;
  academic_year?: string | null;
  institution_id?: string | null;
};

type StudentMetaRow = {
  student_id: string;
  class_id: string;
  class_label: string;
  class_level: string | null;
  class_official_track_code?: string | null;
  academic_year: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  matricule: string | null;
  gender?: string | null;
  birthdate?: string | null;
  birth_place?: string | null;
  nationality?: string | null;
  regime?: string | null;
  is_repeater?: boolean | null;
  is_boarder?: boolean | null;
  is_affecte?: boolean | null;
};

type BulletinPerSubject = {
  subject_id: string;
  avg20: number | null;
  bonus?: number | null;
  avg20_before_bonus?: number | null;
  subject_rank?: number | null;
  has_grade?: boolean | null;
  is_nc?: boolean | null;
  is_assigned?: boolean | null;
};

type BulletinPerSubjectComponent = {
  subject_id: string;
  component_id: string;
  avg20: number | null;
  component_rank?: number | null;
};

type BulletinSubjectMeta = {
  subject_id: string;
  subject_name?: string | null;
  coeff_bulletin?: number | null;
  include_in_average?: boolean | null;
};

type BulletinSubjectComponentMeta = {
  id: string;
  subject_id: string;
  label?: string | null;
  short_label?: string | null;
  coeff_in_subject?: number | null;
  order_index?: number | null;
};

type BulletinMissingSubject = {
  subject_id: string;
  subject_name: string;
};

type BulletinCoverage = {
  expected_subjects?: number;
  covered_subjects?: number;
  missing_subjects?: BulletinMissingSubject[];
  is_complete?: boolean;
  has_academic_grade?: boolean;
  status?: "complete" | "partial" | "empty" | string;
};

type BulletinMissingPeriod = {
  from?: string | null;
  to?: string | null;
  code?: string | null;
  label?: string | null;
  short_label?: string | null;
};

type BulletinAnnualCoverage = {
  expected_periods?: number;
  covered_periods?: number;
  missing_periods?: BulletinMissingPeriod[];
  is_complete?: boolean;
  status?: "complete" | "partial" | "empty" | "not_last_period" | string;
};

type BulletinItem = {
  student_id: string;
  full_name: string;
  matricule: string | null;
  gender?: string | null;
  birth_date?: string | null;
  birthdate?: string | null;
  birth_place?: string | null;
  nationality?: string | null;
  regime?: string | null;
  is_repeater?: boolean | null;
  is_boarder?: boolean | null;
  is_affecte?: boolean | null;

  general_avg: number | null;
  rank?: number | null;
  general_bonus?: number | null;
  general_avg_before_bonus?: number | null;

  coverage?: BulletinCoverage | null;
  general_avg_is_complete?: boolean | null;
  general_avg_status?: "complete" | "partial" | "empty" | "admin_nc" | string | null;

  admin_forced_nc?: boolean | null;
  general_avg_before_admin_nc?: number | null;
  rank_before_admin_nc?: number | null;
  admin_nc_reason?: string | null;
  admin_nc_missing_subjects_snapshot?: BulletinMissingSubject[] | null;

  annual_avg?: number | null;
  annual_rank?: number | null;
  annual_coverage?: BulletinAnnualCoverage | null;
  annual_avg_is_complete?: boolean | null;
  annual_avg_status?:
    | "complete"
    | "partial"
    | "empty"
    | "not_last_period"
    | "admin_nc"
    | string
    | null;

  admin_annual_forced_nc?: boolean | null;
  annual_avg_before_admin_nc?: number | null;
  annual_rank_before_admin_nc?: number | null;
  admin_annual_nc_reason?: string | null;

  per_subject?: BulletinPerSubject[];
  per_subject_components?: BulletinPerSubjectComponent[];
};

type BulletinResponse = {
  ok: boolean;
  class?: {
    id: string;
    label: string;
    academic_year?: string | null;
    level?: string | null;
    official_track_code?: string | null;
  };
  period?: {
    from: string | null;
    to: string | null;
    code?: string | null;
    label?: string | null;
    short_label?: string | null;
    academic_year?: string | null;
    coeff?: number | null;
  };
  items?: BulletinItem[];
  subjects?: BulletinSubjectMeta[];
  subject_components?: BulletinSubjectComponentMeta[];
};

type ConductAverageItem = {
  student_id: string;
  total?: number | null;
  avg20?: number | null;
  avg?: number | null;
  value?: number | null;
  score?: number | null;
  note?: number | null;
};

type ConductResponse =
  | { ok?: boolean; items?: ConductAverageItem[]; data?: ConductAverageItem[] }
  | ConductAverageItem[];

type ExportRow = {
  matricule: string;
  nom: string;
  prenoms: string;
  classe: string;
  annee_scolaire: string;
  periode: string;

  moyenne_generale: number | null;
  moyenne_generale_complete: boolean;
  moyenne_generale_has_star: boolean;
  rang: number | null;

  conduite: number | null;

  moyenne_annuelle: number | null;
  moyenne_annuelle_complete: boolean;
  moyenne_annuelle_has_star: boolean;
  rang_annuel: number | null;

  subject_values: Record<string, number | null>;
};

type ExportFormat = "xlsx" | "csv";
type ExportKind =
  | "legacy"
  | "dsps_notes"
  | "dsps_annual"
  | "desps_term_summary"
  | "desps_subject_summary"
  | "desps_dfa_summary"
  | "desps_official_term"
  | "desps_official_annual"
  | "rapport_f_official";

type ResolvedPeriod = {
  academicYear: string;
  requestedKind: "period" | "annual";
  requestedLabel: string;
  requestedCode: string;
  bulletinFrom: string;
  bulletinTo: string;
  bulletinPeriod: GradePeriodRow;
};

type PreparedSheet = {
  sheetName: string;
  aoa: unknown[][];
  cols?: { wch: number }[];
  merges?: { s: { r: number; c: number }; e: { r: number; c: number } }[];
  clearRanges?: string[];
};

type PreparedWorkbook = {
  filenameBase: string;
  mainSheetName: string;
  rows: Record<string, unknown>[];
  classSheets?: { sheetName: string; rows: Record<string, unknown>[] }[];
  sheets?: PreparedSheet[];
  templateFileName?: string;
  outputExtension?: "xlsx" | "xlsm";
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DSPS_FIRST_CYCLE_SUBJECT_HEADERS = [
  "Composition Française",
  "Orthographe",
  "Oral Français",
  "Anglais",
  "Philosophie",
  "Allemand",
  "Espagnol",
  "Histoire-Géographie",
  "Mathématiques",
  "Sciences Physiques",
  "SVT",
  "E.P.S",
  "EDHC",
  "Arts Plastiques",
  "Musique",
  "TIC",
] as const;

const DSPS_SECOND_CYCLE_SUBJECT_HEADERS = [
  "Français",
  "Anglais",
  "Philosophie",
  "Allemand",
  "Espagnol",
  "Histoire-Géographie",
  "Mathématiques",
  "Sciences Physiques",
  "SVT",
  "E.P.S",
  "EDHC",
  "Arts Plastiques",
  "Musique",
  "TIC",
] as const;

const DSPS_NOTES_BASE_HEADERS = ["Matricule", "Nom", "Série", "Niveau"] as const;
const DSPS_NOTES_END_HEADERS = ["Conduite", "Bonus"] as const;

const DSPS_ANNUAL_HEADERS = [
  "N°",
  "Matricule national",
  "Nom",
  "Prénoms",
  "Moy. 1er Trim",
  "Rang",
  "Moy. 2e Trim",
  "Rang ",
  "Moy. 3e Trim",
  "Rang  ",
  "MGA",
  "Rang   ",
  "Décision du conseil",
] as const;

const DESPS_TERM_SUMMARY_HEADERS = [
  "Niveau",
  "Série",
  "Classe",
  "Effectif total",
  "Filles",
  "Garçons",
  "Classés",
  "Filles classées",
  "Garçons classés",
  "Non classés",
  "Moy. >= 10",
  "Filles moy. >= 10",
  "Garçons moy. >= 10",
  "8,50 <= Moy. < 10",
  "Moy. < 8,50",
  "Moyenne générale classe",
  "Taux réussite %",
] as const;

const DESPS_SUBJECT_SUMMARY_HEADERS = [
  "Niveau",
  "Série",
  "Classe",
  "Discipline",
  "Effectif total",
  "Élèves notés",
  "Filles notées",
  "Garçons notés",
  "Non notés",
  "Moyenne discipline",
  "Notes >= 10",
  "Filles notes >= 10",
  "Garçons notes >= 10",
  "Notes < 10",
  "Taux réussite %",
] as const;

const DESPS_DFA_SUMMARY_HEADERS = [
  "Cycle",
  "Niveau",
  "Série",
  "Classe",
  "Effectif total",
  "Filles",
  "Garçons",
  "Classés annuels",
  "Non classés annuels",
  "Moy. annuelle >= 10",
  "Filles moy. annuelle >= 10",
  "Garçons moy. annuelle >= 10",
  "Moy. annuelle < 10",
  "Admis automatiques",
  "À examiner en conseil",
  "Redoublants saisis",
  "Exclus saisis",
  "Moyenne annuelle classe",
  "Taux admission automatique %",
] as const;

const SUBJECT_ALIASES: Record<string, string[]> = {
  "Composition Française": [
    "composition francaise",
    "composition francais",
    "composition",
    "expression ecrite",
    "redaction",
    "production ecrite",
  ],
  Orthographe: ["orthographe", "grammaire orthographe", "langue"],
  "Oral Français": ["oral francais", "oral", "expression orale", "lecture", "recitation"],
  Français: ["francais", "français", "lettres modernes", "fr"],
  Anglais: ["anglais", "english", "ang"],
  Philosophie: ["philosophie", "philo"],
  Allemand: ["allemand", "all"],
  Espagnol: ["espagnol", "esp"],
  "Histoire-Géographie": ["histoire geographie", "histoire-geographie", "histoire", "geographie", "hg", "h g"],
  Mathématiques: ["mathematiques", "mathématiques", "maths", "math"],
  "Sciences Physiques": ["sciences physiques", "physique chimie", "physique-chimie", "pc", "physique", "chimie"],
  SVT: ["svt", "sciences de la vie", "sciences naturelles", "biologie", "geologie"],
  "E.P.S": ["eps", "e p s", "education physique", "sport"],
  EDHC: ["edhc", "education aux droits", "droit de l homme", "citoyennete", "education civique"],
  "Arts Plastiques": ["arts plastiques", "art plastique", "arts", "dessin"],
  Musique: ["musique", "education musicale"],
  TIC: ["tic", "tice", "informatique", "numerique"],
};

function cleanNumber(value: unknown, precision = 2): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(precision));
}

function cleanRank(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function isUuid(v: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    v
  );
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (/[";\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(csvEscape).join(";")];

  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(";"));
  }

  return `\uFEFF${lines.join("\r\n")}`;
}

function buildCsvFromAoa(aoa: unknown[][]): string {
  return `\uFEFF${aoa.map((row) => row.map(csvEscape).join(";")).join("\r\n")}`;
}

function toFileSafePart(value: string): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function safeSheetName(value: string): string {
  const s = String(value || "Feuille")
    .replace(/[\\/?:*\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (s || "Feuille").slice(0, 31);
}

function normalizeForMatch(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compactForMatch(value: string | null | undefined): string {
  return normalizeForMatch(value).replace(/\s+/g, "");
}

function labelMatchesHeader(label: string | null | undefined, header: string): boolean {
  const normalizedLabel = normalizeForMatch(label);
  const compactLabel = compactForMatch(label);
  if (!normalizedLabel) return false;

  const aliases = SUBJECT_ALIASES[header] || [header];

  for (const alias of aliases) {
    const normalizedAlias = normalizeForMatch(alias);
    const compactAlias = compactForMatch(alias);
    if (!normalizedAlias) continue;

    if (normalizedLabel === normalizedAlias || compactLabel === compactAlias) return true;

    if (normalizedAlias.length >= 4) {
      if (normalizedLabel.includes(normalizedAlias) || compactLabel.includes(compactAlias)) {
        return true;
      }
    }
  }

  return false;
}

function splitStudentName(meta: Pick<StudentMetaRow, "first_name" | "last_name" | "full_name">) {
  const lastName = String(meta.last_name || "").trim();
  const firstName = String(meta.first_name || "").trim();
  const fullName = String(meta.full_name || "").trim();

  if (lastName || firstName) {
    return {
      nom: lastName,
      prenoms: firstName,
      nom_prenoms: [lastName, firstName].filter(Boolean).join(" ").trim() || fullName,
    };
  }

  if (!fullName) {
    return { nom: "", prenoms: "", nom_prenoms: "" };
  }

  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return { nom: parts[0], prenoms: "", nom_prenoms: fullName };
  }

  return {
    nom: parts[0],
    prenoms: parts.slice(1).join(" "),
    nom_prenoms: fullName,
  };
}

const BULLETIN_EXPORT_FETCH_TIMEOUT_MS = Number(process.env.BULLETIN_EXPORT_FETCH_TIMEOUT_MS || 45000);
const BULLETIN_EXPORT_CONCURRENCY = Math.max(
  1,
  Math.min(8, Number(process.env.BULLETIN_EXPORT_CONCURRENCY || 4) || 4)
);

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runOne = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runOne())
  );

  return results;
}

function pickOrigin(req: NextRequest) {
  const host =
    req.headers.get("x-forwarded-host") ??
    req.headers.get("host") ??
    process.env.VERCEL_URL ??
    null;

  if (!host) {
    return (
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.PUBLIC_APP_URL ||
      process.env.APP_URL ||
      "http://localhost:3000"
    );
  }

  const protoHeader =
    req.headers.get("x-forwarded-proto") ??
    req.headers.get("x-forwarded-protocol") ??
    null;

  const isLocal =
    host.includes("localhost") ||
    host.includes("127.0.0.1") ||
    host.includes("0.0.0.0");

  const proto = protoHeader ?? (isLocal ? "http" : "https");

  return host.startsWith("http://") || host.startsWith("https://")
    ? host
    : `${proto}://${host}`;
}

function normalizeLevel(level?: string | null): string {
  const raw = normalizeForMatch(level);
  if (!raw) return "";

  if (raw === "6e" || raw.startsWith("6")) return "6e";
  if (raw === "5e" || raw.startsWith("5")) return "5e";
  if (raw === "4e" || raw.startsWith("4")) return "4e";
  if (raw === "3e" || raw.startsWith("3")) return "3e";
  if (raw.includes("seconde") || raw.startsWith("2")) return "seconde";
  if (raw.includes("premiere") || raw.startsWith("1")) return "première";
  if (raw.includes("terminale") || raw.startsWith("t")) return "terminale";

  return raw;
}

function isFirstCycleLevel(level?: string | null): boolean {
  const n = normalizeLevel(level);
  return n === "6e" || n === "5e" || n === "4e" || n === "3e";
}

function extractSeriesFromClass(cls: ClassRow): string {
  const label = String(cls.label || cls.code || "").toUpperCase();
  const level = normalizeLevel(cls.level);

  if (level !== "seconde" && level !== "première" && level !== "terminale") return "";

  const normalized = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

  const match = normalized.match(/\b(A1|A2|D1|D2|G1|G2|TI|TIC|C|D|B|E|F|L|S)\b/);
  if (!match?.[1]) return "";
  return match[1].replace(/^(D|G)[12]$/, "$1");
}


function normalizeOfficialTrackCode(value?: string | null): string {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function officialTrackToDespsLevel(value?: string | null): string {
  const code = normalizeOfficialTrackCode(value);

  switch (code) {
    case "6eme":
    case "6e":
      return "6ème";
    case "5eme":
    case "5e":
      return "5ème";
    case "4eme":
    case "4e":
      return "4ème";
    case "3eme":
    case "3e":
      return "3ème";
    case "2ndea":
    case "2dea":
    case "2a":
      return "2ndeA";
    case "2ndec":
    case "2dec":
    case "2c":
      return "2ndeC";
    case "1erea1":
    case "1a1":
      return "1èreA1";
    case "1erea2":
    case "1a2":
    case "1a":
      return "1èreA2";
    case "1erec":
    case "1c":
      return "1èreC";
    case "1ered":
    case "1d":
      return "1èreD";
    case "tlea1":
    case "ta1":
      return "TleA1";
    case "tlea2":
    case "ta2":
    case "ta":
      return "TleA2";
    case "tlec":
    case "tc":
      return "TleC";
    case "tled":
    case "td":
      return "TleD";
    default:
      return "";
  }
}

function officialTrackToRapportClassCode(value?: string | null): string {
  const level = officialTrackToDespsLevel(value);

  if (level === "6ème") return "6è";
  if (level === "5ème") return "5è";
  if (level === "4ème") return "4è";
  if (level === "3ème") return "3è";
  if (level === "2ndeA") return "2NDEA";
  if (level === "2ndeC") return "2NDEC";
  if (level === "1èreA1" || level === "1èreA2") return "1EREA";
  if (level === "1èreC") return "1EREC";
  if (level === "1èreD") return "1ERED";
  if (level === "TleA1" || level === "TleA2") return "TA";
  if (level === "TleC") return "TC";
  if (level === "TleD") return "TD";
  return "";
}

function officialTrackCycle(value?: string | null): "first" | "second" | "other" {
  const level = officialTrackToDespsLevel(value);
  if (["6ème", "5ème", "4ème", "3ème"].includes(level)) return "first";
  if (level.startsWith("2nde") || level.startsWith("1ère") || level.startsWith("Tle")) return "second";
  return "other";
}

function displayLevelForDsps(cls: ClassRow): string {
  const level = String(cls.level || "").trim();
  if (level) return level;
  return String(cls.label || cls.code || "").trim();
}

function isAdminForcedNc(item: BulletinItem | null | undefined): boolean {
  if (!item) return false;
  return item.admin_forced_nc === true || item.general_avg_status === "admin_nc";
}

function isAdminAnnualForcedNc(item: BulletinItem | null | undefined): boolean {
  if (!item) return false;
  return item.admin_annual_forced_nc === true || item.annual_avg_status === "admin_nc";
}

function formatAverageForExport(value: number | null, _hasStar: boolean): number | string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "NC";
  return Number(Number(value).toFixed(2));
}

function formatOptionalAverageForExport(
  value: number | null,
  _hasStar: boolean
): number | string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  return Number(Number(value).toFixed(2));
}

function formatRankForExport(rank: number | null, isClassable: boolean): number | string {
  if (!isClassable) return "NC";
  if (rank === null || rank === undefined || !Number.isFinite(Number(rank))) return "NC";
  return Number(rank);
}

function formatSubjectValueForExport(
  subjectValues: Record<string, number | null>,
  header: string
): number | string {
  if (!Object.prototype.hasOwnProperty.call(subjectValues, header)) return "";

  const value = subjectValues[header];

  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "NC";

  return Number(Number(value).toFixed(2));
}

function formatDspsNumber(value: unknown): number | string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return Number(n.toFixed(2));
}

function formatDspsRank(value: unknown): number | string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return Math.round(n);
}

function annualDecisionLabel(avg: number | null | undefined): string {
  if (avg === null || avg === undefined || !Number.isFinite(Number(avg))) return "";
  const g = Number(avg);
  if (g >= 16) return "Excellence";
  if (g >= 14) return "Tableau d’honneur";
  if (g >= 12) return "Encouragement";
  return "";
}

function buildExportRows(rows: ExportRow[], subjectHeaders: string[]) {
  return rows.map((row) => {
    const base: Record<string, unknown> = {
      Matricule: row.matricule,
      Nom: row.nom,
      "Prénoms": row.prenoms,
      Classe: row.classe,
      "Année scolaire": row.annee_scolaire,
      Période: row.periode,
      "Moyenne générale": formatAverageForExport(
        row.moyenne_generale,
        row.moyenne_generale_has_star
      ),
      Rang: formatRankForExport(row.rang, row.moyenne_generale_complete),
      Conduite: row.conduite ?? "",
      "Moyenne annuelle": formatOptionalAverageForExport(
        row.moyenne_annuelle,
        row.moyenne_annuelle_has_star
      ),
      "Rang annuel":
        row.moyenne_annuelle === null
          ? ""
          : formatRankForExport(row.rang_annuel, row.moyenne_annuelle_complete),
    };

    for (const header of subjectHeaders) {
      base[header] = formatSubjectValueForExport(row.subject_values, header);
    }

    return base;
  });
}

function assignRanks<
  T extends {
    moyenne_generale: number | null;
    moyenne_annuelle: number | null;
    moyenne_generale_complete: boolean;
    moyenne_annuelle_complete: boolean;
  }
>(rows: T[]) {
  const periodRankByIndex = new Map<number, number>();
  const annualRankByIndex = new Map<number, number>();

  const periodEntries = rows
    .map((row, index) => ({ index, value: row.moyenne_generale }))
    .filter((x) => typeof x.value === "number" && Number.isFinite(x.value))
    .sort((a, b) => Number(b.value) - Number(a.value));

  let currentRank = 0;
  let lastValue: number | null = null;
  let position = 0;

  for (const entry of periodEntries) {
    position += 1;
    const value = Number(entry.value);
    if (lastValue === null || value !== lastValue) {
      currentRank = position;
      lastValue = value;
    }
    periodRankByIndex.set(entry.index, currentRank);
  }

  const annualEntries = rows
    .map((row, index) => ({ index, value: row.moyenne_annuelle }))
    .filter((x) => typeof x.value === "number" && Number.isFinite(x.value))
    .sort((a, b) => Number(b.value) - Number(a.value));

  currentRank = 0;
  lastValue = null;
  position = 0;

  for (const entry of annualEntries) {
    position += 1;
    const value = Number(entry.value);
    if (lastValue === null || value !== lastValue) {
      currentRank = position;
      lastValue = value;
    }
    annualRankByIndex.set(entry.index, currentRank);
  }

  return { periodRankByIndex, annualRankByIndex };
}

function sortRowsByClassRankAndName<T extends { Classe?: unknown; classe?: unknown; Rang?: unknown; rang?: unknown; MGA?: unknown; moyenne_generale?: unknown; Nom?: unknown; nom?: unknown; "Prénoms"?: unknown; prenoms?: unknown }>(rows: T[]) {
  return rows.sort((a, b) => {
    const classA = String(a.Classe ?? a.classe ?? "");
    const classB = String(b.Classe ?? b.classe ?? "");
    const classCmp = classA.localeCompare(classB, "fr", { numeric: true, sensitivity: "base" });
    if (classCmp !== 0) return classCmp;

    const rankA = Number.isFinite(Number(a.Rang ?? a.rang)) ? Number(a.Rang ?? a.rang) : 999999;
    const rankB = Number.isFinite(Number(b.Rang ?? b.rang)) ? Number(b.Rang ?? b.rang) : 999999;
    if (rankA !== rankB) return rankA - rankB;

    const avgA = Number.isFinite(Number(a.MGA ?? a.moyenne_generale)) ? Number(a.MGA ?? a.moyenne_generale) : -Infinity;
    const avgB = Number.isFinite(Number(b.MGA ?? b.moyenne_generale)) ? Number(b.MGA ?? b.moyenne_generale) : -Infinity;
    if (avgB !== avgA) return avgB - avgA;

    return `${a.Nom ?? a.nom ?? ""} ${a["Prénoms"] ?? a.prenoms ?? ""}`
      .trim()
      .localeCompare(`${b.Nom ?? b.nom ?? ""} ${b["Prénoms"] ?? b.prenoms ?? ""}`.trim(), "fr", {
        sensitivity: "base",
        numeric: true,
      });
  });
}


type SummaryAccumulator = {
  total: number;
  girls: number;
  boys: number;
  classed: number;
  classedGirls: number;
  classedBoys: number;
  nonClassed: number;
  ge10: number;
  ge10Girls: number;
  ge10Boys: number;
  between850And10: number;
  lt850: number;
  sum: number;
};

function makeSummaryAccumulator(): SummaryAccumulator {
  return {
    total: 0,
    girls: 0,
    boys: 0,
    classed: 0,
    classedGirls: 0,
    classedBoys: 0,
    nonClassed: 0,
    ge10: 0,
    ge10Girls: 0,
    ge10Boys: 0,
    between850And10: 0,
    lt850: 0,
    sum: 0,
  };
}

function normalizeGender(value?: string | null): "F" | "M" | "" {
  const raw = normalizeForMatch(value);
  if (!raw) return "";

  if (
    raw === "f" ||
    raw === "feminin" ||
    raw === "feminine" ||
    raw === "female" ||
    raw === "fille" ||
    raw === "filles"
  ) {
    return "F";
  }

  if (
    raw === "m" ||
    raw === "masculin" ||
    raw === "masculine" ||
    raw === "male" ||
    raw === "garcon" ||
    raw === "garcons" ||
    raw === "homme"
  ) {
    return "M";
  }

  return "";
}

function addGenderCount(acc: Pick<SummaryAccumulator, "girls" | "boys">, gender: "F" | "M" | "") {
  if (gender === "F") acc.girls += 1;
  else acc.boys += 1;
}

function addPeriodAverageToAccumulator(
  acc: SummaryAccumulator,
  avg: number | null,
  gender: "F" | "M" | ""
) {
  acc.total += 1;
  addGenderCount(acc, gender);

  if (avg === null || !Number.isFinite(Number(avg))) {
    acc.nonClassed += 1;
    return;
  }

  const value = Number(avg);
  acc.classed += 1;
  acc.sum += value;

  if (gender === "F") acc.classedGirls += 1;
  else acc.classedBoys += 1;

  if (value >= 10) {
    acc.ge10 += 1;
    if (gender === "F") acc.ge10Girls += 1;
    else acc.ge10Boys += 1;
  } else if (value >= 8.5) {
    acc.between850And10 += 1;
  } else {
    acc.lt850 += 1;
  }
}

function percent(value: number, total: number): number | string {
  if (!total) return "";
  return Number(((value / total) * 100).toFixed(2));
}

type ExcelCellValue = { __excelCell: true; value: unknown; numFmt?: string };

function excelCell(value: unknown, numFmt?: string): ExcelCellValue {
  return { __excelCell: true, value, numFmt };
}

function isExcelCellValue(value: unknown): value is ExcelCellValue {
  return !!value && typeof value === "object" && (value as ExcelCellValue).__excelCell === true;
}

function percentCell(value: number, total: number): ExcelCellValue | string {
  if (!total) return "";
  return excelCell(Number((value / total).toFixed(4)), "0.00%");
}

function meanFromAccumulator(acc: Pick<SummaryAccumulator, "sum" | "classed">): number | string {
  if (!acc.classed) return "";
  return Number((acc.sum / acc.classed).toFixed(2));
}

function getStudentGender(params: {
  meta?: StudentMetaRow | null;
  item?: BulletinItem | null;
}): "F" | "M" | "" {
  return normalizeGender(params.meta?.gender ?? params.item?.gender ?? null);
}

function getRapportGender(params: { meta?: StudentMetaRow | null; item?: BulletinItem | null }): "F" | "G" | "" {
  const gender = getStudentGender(params);
  if (gender === "F") return "F";
  if (gender === "M") return "G";
  return "";
}

function parseDateLike(value?: string | null): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const match = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateFr(value?: string | null): string {
  const d = parseDateLike(value);
  if (!d) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function datePart(value: string | null | undefined, part: "day" | "month" | "year"): string | number {
  const d = parseDateLike(value);
  if (!d) return "";
  if (part === "day") return d.getDate();
  if (part === "month") return d.getMonth() + 1;
  return d.getFullYear();
}

function ageAtAcademicYear(value: string | null | undefined, academicYear: string): string | number {
  const d = parseDateLike(value);
  if (!d) return "";

  const startYear = Number(String(academicYear || "").split("-")[0]);
  const referenceYear = Number.isFinite(startYear) ? startYear : new Date().getFullYear();
  const reference = new Date(referenceYear, 11, 31);

  let age = reference.getFullYear() - d.getFullYear();
  const birthdayPassed =
    reference.getMonth() > d.getMonth() ||
    (reference.getMonth() === d.getMonth() && reference.getDate() >= d.getDate());
  if (!birthdayPassed) age -= 1;
  return age >= 0 && age < 100 ? age : "";
}

function getStudentBirthdate(meta?: StudentMetaRow | null, item?: BulletinItem | null): string | null {
  return item?.birth_date || item?.birthdate || meta?.birthdate || null;
}

function getStudentNationality(meta?: StudentMetaRow | null, item?: BulletinItem | null): string {
  const value = String(item?.nationality || meta?.nationality || "").trim();
  return value || "IVOIRIENNE";
}

function getStudentRepeater(meta?: StudentMetaRow | null, item?: BulletinItem | null): string {
  const value = item?.is_repeater ?? meta?.is_repeater;
  if (value === true) return "OUI";
  if (value === false) return "NON";
  return "";
}

function officialRapportClassCode(cls: ClassRow): string {
  const codeFromOfficialTrack = officialTrackToRapportClassCode(cls.official_track_code);
  if (codeFromOfficialTrack) return codeFromOfficialTrack;

  const level = normalizeLevel(cls.level);
  const series = extractSeriesFromClass(cls).toUpperCase();
  const label = normalizeForMatch(`${cls.label || ""} ${cls.code || ""}`);

  if (level === "6e") return "6è";
  if (level === "5e") return "5è";
  if (level === "4e") return "4è";
  if (level === "3e") return "3è";

  if (level === "seconde") {
    if (series === "C" || label.includes("2nde c") || label.includes("2nd c")) return "2NDEC";
    return "2NDEA";
  }

  if (level === "première") {
    if (series === "C") return "1EREC";
    if (series === "D") return "1ERED";
    return "1EREA";
  }

  if (level === "terminale") {
    if (series === "C") return "TC";
    if (series === "D") return "TD";
    return "TA";
  }

  return String(cls.label || cls.code || "Classe").trim();
}

function classCycleLabel(cls: ClassRow): string {
  const cycleFromOfficialTrack = officialTrackCycle(cls.official_track_code);
  if (cycleFromOfficialTrack === "first") return "1er cycle";
  if (cycleFromOfficialTrack === "second") return "2nd cycle";
  return isFirstCycleLevel(cls.level) ? "1er cycle" : "2nd cycle";
}

function dfaAutoDecision(avg: number | null): "admis" | "examiner" | "non_classe" {
  if (avg === null || !Number.isFinite(Number(avg))) return "non_classe";
  return Number(avg) >= 10 ? "admis" : "examiner";
}

async function getAdminAndInstitution() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { supabase, error: "UNAUTHENTICATED" as const };
  }

  const { data: roleRow, error: roleErr } = await supabase
    .from("user_roles")
    .select("institution_id, role")
    .eq("profile_id", user.id)
    .in("role", ["admin", "super_admin"])
    .limit(1)
    .maybeSingle();

  if (roleErr || !roleRow) {
    return { supabase, error: "PROFILE_NOT_FOUND" as const };
  }

  const role = roleRow.role as Role;
  if (!["super_admin", "admin"].includes(role)) {
    return { supabase, error: "FORBIDDEN" as const };
  }

  if (!roleRow.institution_id) {
    return { supabase, error: "NO_INSTITUTION" as const };
  }

  return {
    supabase,
    institutionId: String(roleRow.institution_id),
    role,
    userId: user.id,
  };
}

async function resolvePeriod(params: {
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  institutionId: string;
  academicYear: string;
  periodRef: string;
}): Promise<ResolvedPeriod | null> {
  const { supabase, institutionId, academicYear, periodRef } = params;

  if (periodRef.startsWith("period:")) {
    const periodId = periodRef.slice("period:".length).trim();
    if (!isUuid(periodId)) return null;

    const { data: period } = await supabase
      .from("grade_periods")
      .select("id, academic_year, code, label, short_label, start_date, end_date, coeff")
      .eq("institution_id", institutionId)
      .eq("id", periodId)
      .maybeSingle();

    if (!period) return null;

    const row = period as GradePeriodRow;
    const year = String(row.academic_year || academicYear || "").trim();
    const label = String(row.short_label || row.label || row.code || "Période").trim();
    const code = String(row.code || row.short_label || row.label || "period").trim();

    return {
      academicYear: year,
      requestedKind: "period",
      requestedLabel: label,
      requestedCode: code,
      bulletinFrom: row.start_date,
      bulletinTo: row.end_date,
      bulletinPeriod: row,
    };
  }

  if (periodRef.startsWith("annual:")) {
    const year = periodRef.slice("annual:".length).trim() || academicYear;

    const periods = await loadAcademicPeriods({ supabase, institutionId, academicYear: year });
    if (!periods.length) return null;

    const lastPeriod = periods[periods.length - 1];

    return {
      academicYear: year,
      requestedKind: "annual",
      requestedLabel: "Annuel",
      requestedCode: "ANNUEL",
      bulletinFrom: String(lastPeriod.start_date),
      bulletinTo: String(lastPeriod.end_date),
      bulletinPeriod: lastPeriod,
    };
  }

  return null;
}

async function loadAcademicPeriods(params: {
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  institutionId: string;
  academicYear: string;
}) {
  const { supabase, institutionId, academicYear } = params;

  const { data: periods } = await supabase
    .from("grade_periods")
    .select("id, academic_year, code, label, short_label, start_date, end_date, coeff")
    .eq("institution_id", institutionId)
    .eq("academic_year", academicYear)
    .order("start_date", { ascending: true });

  return ((periods || []) as GradePeriodRow[]).sort((a, b) => {
    const as = String(a.start_date || "");
    const bs = String(b.start_date || "");
    if (as !== bs) return as.localeCompare(bs);
    return String(a.end_date || "").localeCompare(String(b.end_date || ""));
  });
}

async function loadClasses(params: {
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  institutionId: string;
  academicYear: string;
  classId: string;
}) {
  const { supabase, institutionId, academicYear, classId } = params;

  let classesQuery = supabase
    .from("classes")
    .select("id, label, code, level, official_track_code, academic_year, institution_id")
    .eq("institution_id", institutionId)
    .eq("academic_year", academicYear)
    .order("level", { ascending: true })
    .order("label", { ascending: true });

  if (classId) {
    if (!isUuid(classId)) return { classes: [] as ClassRow[], error: "INVALID_CLASS_ID" as const };
    classesQuery = classesQuery.eq("id", classId);
  }

  const { data, error } = await classesQuery;

  if (error) return { classes: [] as ClassRow[], error: "CLASSES_ERROR" as const };
  return { classes: (data || []) as ClassRow[], error: null };
}

async function loadStudentMeta(params: {
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  classes: ClassRow[];
  academicYear: string;
  activeFrom: string;
}) {
  const { supabase, classes, academicYear, activeFrom } = params;
  void activeFrom; // Les exports DESPS doivent suivre la liste active actuelle, comme les bulletins.
  const targetClassIds = classes.map((c) => String(c.id));
  const classMap = new Map<string, ClassRow>(classes.map((c) => [String(c.id), c]));
  const studentMetaByKey = new Map<string, StudentMetaRow>();

  if (!targetClassIds.length) return studentMetaByKey;

  const { data: enrollments } = await supabase
    .from("class_enrollments")
    .select(
      `
      class_id,
      student_id,
      students(
        first_name,
        last_name,
        full_name,
        matricule,
        gender,
        birthdate,
        birth_place,
        nationality,
        regime,
        is_repeater,
        is_boarder,
        is_affecte
      )
    `
    )
    .in("class_id", targetClassIds)
    .is("end_date", null)
    .order("student_id", { ascending: true });

  for (const row of (enrollments || []) as any[]) {
    const currentClassId = String(row?.class_id || "");
    const studentId = String(row?.student_id || "");

    if (!currentClassId || !studentId) continue;

    const cls = classMap.get(currentClassId);
    if (!cls) continue;

    const student = row?.students || {};
    const key = `${currentClassId}__${studentId}`;

    studentMetaByKey.set(key, {
      student_id: studentId,
      class_id: currentClassId,
      class_label: String(cls.label || cls.code || "Classe"),
      class_level: cls.level ?? null,
      class_official_track_code: cls.official_track_code ?? null,
      academic_year: cls.academic_year ?? academicYear,
      first_name: student.first_name ?? null,
      last_name: student.last_name ?? null,
      full_name: student.full_name ?? null,
      matricule: student.matricule ?? null,
      gender: student.gender ?? null,
      birthdate: student.birthdate ?? null,
      birth_place: student.birth_place ?? null,
      nationality: student.nationality ?? null,
      regime: student.regime ?? null,
      is_repeater: student.is_repeater ?? null,
      is_boarder: student.is_boarder ?? null,
      is_affecte: student.is_affecte ?? null,
    });
  }

  return studentMetaByKey;
}

async function fetchBulletinForClass(params: {
  req: NextRequest;
  classId: string;
  from: string;
  to: string;
}): Promise<BulletinResponse | null> {
  const origin = pickOrigin(params.req);
  const url = new URL("/api/admin/grades/bulletin", origin);

  url.searchParams.set("class_id", params.classId);
  url.searchParams.set("from", params.from);
  url.searchParams.set("to", params.to);
  url.searchParams.set("published", "true");
  // Les exports DESPS n'ont pas besoin des QR code ni des images PNG des bulletins.
  // Ce mode allège fortement les appels internes et évite les délais excessifs.
  url.searchParams.set("export_light", "true");

  const cookie = params.req.headers.get("cookie") ?? "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BULLETIN_EXPORT_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: cookie ? { cookie } : {},
      cache: "no-store",
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const data = (await res.json().catch(() => null)) as BulletinResponse | null;
    if (!data?.ok) return null;

    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchConductMap(params: {
  req: NextRequest;
  classId: string;
  from: string;
  to: string;
}): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const origin = pickOrigin(params.req);
  const url = new URL("/api/admin/conduite/averages", origin);

  url.searchParams.set("class_id", params.classId);
  url.searchParams.set("from", params.from);
  url.searchParams.set("to", params.to);

  const cookie = params.req.headers.get("cookie") ?? "";

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: cookie ? { cookie } : {},
      cache: "no-store",
    });

    if (!res.ok) return out;

    const json = (await res.json().catch(() => null)) as ConductResponse | null;
    const items = Array.isArray(json)
      ? json
      : Array.isArray(json?.items)
      ? json.items
      : Array.isArray(json?.data)
      ? json.data
      : [];

    for (const item of items) {
      const sid = String(item?.student_id || "");
      if (!sid) continue;

      const raw =
        item?.total ??
        item?.avg20 ??
        item?.avg ??
        item?.value ??
        item?.score ??
        item?.note ??
        null;

      out.set(sid, cleanNumber(raw, 4));
    }
  } catch {
    return out;
  }

  return out;
}

function getSubjectMaps(bulletinData: BulletinResponse) {
  const subjectNameById = new Map<string, string>();
  const componentById = new Map<string, BulletinSubjectComponentMeta>();

  for (const subject of bulletinData.subjects || []) {
    const sid = String(subject?.subject_id || "");
    if (!sid) continue;
    subjectNameById.set(sid, String(subject?.subject_name || sid).trim() || sid);
  }

  for (const comp of bulletinData.subject_components || []) {
    const cid = String(comp?.id || "");
    if (!cid) continue;
    componentById.set(cid, comp);
  }

  return { subjectNameById, componentById };
}

function findSubjectAverageForHeader(
  item: BulletinItem,
  subjectNameById: Map<string, string>,
  header: string
): number | null {
  for (const ps of item.per_subject || []) {
    const label = subjectNameById.get(String(ps.subject_id)) || "";
    if (labelMatchesHeader(label, header)) {
      return cleanNumber(ps.avg20, 4);
    }
  }
  return null;
}

function findFrenchComponentAverageForHeader(
  item: BulletinItem,
  subjectNameById: Map<string, string>,
  componentById: Map<string, BulletinSubjectComponentMeta>,
  header: string
): number | null {
  for (const psc of item.per_subject_components || []) {
    const subjectLabel = subjectNameById.get(String(psc.subject_id)) || "";
    if (!labelMatchesHeader(subjectLabel, "Français")) continue;

    const comp = componentById.get(String(psc.component_id));
    const compLabel = String(comp?.short_label || comp?.label || "");
    if (!labelMatchesHeader(compLabel, header)) continue;

    return cleanNumber(psc.avg20, 4);
  }

  return null;
}

function valueForDspsSubjectHeader(params: {
  item: BulletinItem;
  subjectNameById: Map<string, string>;
  componentById: Map<string, BulletinSubjectComponentMeta>;
  header: string;
  firstCycle: boolean;
}): number | null {
  const { item, subjectNameById, componentById, header, firstCycle } = params;

  if (firstCycle && ["Composition Française", "Orthographe", "Oral Français"].includes(header)) {
    const componentValue = findFrenchComponentAverageForHeader(
      item,
      subjectNameById,
      componentById,
      header
    );

    if (componentValue !== null) return componentValue;

    // Fallback utile si l'établissement n'a pas encore configuré les sous-matières.
    if (header === "Composition Française") {
      return findSubjectAverageForHeader(item, subjectNameById, "Français");
    }

    return null;
  }

  return findSubjectAverageForHeader(item, subjectNameById, header);
}

function buildDspsNotesHeadersForClasses(classes: ClassRow[]) {
  const hasFirstCycle = classes.some((cls) => isFirstCycleLevel(cls.level));
  const hasSecondCycle = classes.some((cls) => !isFirstCycleLevel(cls.level));

  const subjectHeaders =
    hasFirstCycle && hasSecondCycle
      ? Array.from(
          new Set([...DSPS_FIRST_CYCLE_SUBJECT_HEADERS, ...DSPS_SECOND_CYCLE_SUBJECT_HEADERS])
        )
      : hasFirstCycle
      ? [...DSPS_FIRST_CYCLE_SUBJECT_HEADERS]
      : [...DSPS_SECOND_CYCLE_SUBJECT_HEADERS];

  return [...DSPS_NOTES_BASE_HEADERS, ...subjectHeaders, ...DSPS_NOTES_END_HEADERS];
}

function buildOrderedRow(headers: readonly string[], values: Record<string, unknown>) {
  const row: Record<string, unknown> = {};
  for (const header of headers) row[header] = values[header] ?? "";
  return row;
}

async function prepareLegacyExport(params: {
  req: NextRequest;
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  institutionId: string;
  institutionName: string;
  academicYear: string;
  periodRef: string;
  classId: string;
  includeSubjects: boolean;
}): Promise<PreparedWorkbook | { error: string; status: number }> {
  const {
    req,
    supabase,
    institutionId,
    institutionName,
    academicYear,
    periodRef,
    classId,
    includeSubjects,
  } = params;

  const resolvedPeriod = await resolvePeriod({ supabase, institutionId, academicYear, periodRef });

  if (!resolvedPeriod) {
    return { error: "INVALID_PERIOD_REF", status: 400 };
  }

  const { classes, error: classError } = await loadClasses({
    supabase,
    institutionId,
    academicYear: resolvedPeriod.academicYear,
    classId,
  });

  if (classError) return { error: classError, status: classError === "INVALID_CLASS_ID" ? 400 : 500 };
  if (!classes.length) return { error: "NO_CLASSES_FOUND", status: 404 };

  const studentMetaByKey = await loadStudentMeta({
    supabase,
    classes,
    academicYear: resolvedPeriod.academicYear,
    activeFrom: resolvedPeriod.bulletinFrom,
  });

  const allExportRows: ExportRow[] = [];
  const subjectHeaderOrder: string[] = [];
  const subjectHeaderSeen = new Set<string>();

  for (const cls of classes) {
    const currentClassId = String(cls.id);

    const [bulletinData, conductMap] = await Promise.all([
      fetchBulletinForClass({
        req,
        classId: currentClassId,
        from: resolvedPeriod.bulletinFrom,
        to: resolvedPeriod.bulletinTo,
      }),
      fetchConductMap({
        req,
        classId: currentClassId,
        from: resolvedPeriod.bulletinFrom,
        to: resolvedPeriod.bulletinTo,
      }),
    ]);

    if (!bulletinData?.items?.length) continue;

    const { subjectNameById } = getSubjectMaps(bulletinData);
    const classSubjectLabels: string[] = [];

    for (const subject of bulletinData.subjects || []) {
      const sid = String(subject?.subject_id || "");
      if (!sid) continue;

      const label = subjectNameById.get(sid) || sid;
      classSubjectLabels.push(label);

      if (includeSubjects && !subjectHeaderSeen.has(label)) {
        subjectHeaderSeen.add(label);
        subjectHeaderOrder.push(label);
      }
    }

    const classRows: ExportRow[] = bulletinData.items.map((item) => {
      const key = `${currentClassId}__${String(item.student_id)}`;
      const meta = studentMetaByKey.get(key);

      const split = splitStudentName({
        first_name: meta?.first_name ?? null,
        last_name: meta?.last_name ?? null,
        full_name: meta?.full_name ?? item.full_name ?? null,
      });

      const generalForcedNc = isAdminForcedNc(item);
      const annualForcedNc = isAdminAnnualForcedNc(item);

      const currentGeneral = generalForcedNc ? null : cleanNumber(item.general_avg, 4);
      const currentAnnual = annualForcedNc ? null : cleanNumber(item.annual_avg, 4);
      const currentConduct = cleanNumber(conductMap.get(String(item.student_id)) ?? null, 4);

      const exportedAverage =
        resolvedPeriod.requestedKind === "annual" ? currentAnnual : currentGeneral;

      const exportedRank =
        exportedAverage !== null
          ? resolvedPeriod.requestedKind === "annual"
            ? cleanRank(item.annual_rank)
            : cleanRank(item.rank)
          : null;

      const subjectValues: Record<string, number | null> = {};

      if (includeSubjects) {
        for (const label of classSubjectLabels) subjectValues[label] = null;

        for (const ps of item.per_subject || []) {
          const sid = String(ps?.subject_id || "");
          if (!sid) continue;

          const label = subjectNameById.get(sid) || `Matière ${sid.slice(0, 8)}`;

          if (!subjectHeaderSeen.has(label)) {
            subjectHeaderSeen.add(label);
            subjectHeaderOrder.push(label);
          }

          subjectValues[label] = cleanNumber(ps?.avg20, 4);
        }
      }

      return {
        matricule: String(meta?.matricule || item.matricule || ""),
        nom: split.nom,
        prenoms: split.prenoms,
        classe: String(meta?.class_label || cls.label || cls.code || "Classe"),
        annee_scolaire: String(meta?.academic_year || resolvedPeriod.academicYear || ""),
        periode: resolvedPeriod.requestedLabel,

        moyenne_generale: exportedAverage,
        moyenne_generale_complete: exportedAverage !== null,
        moyenne_generale_has_star: false,
        rang: exportedRank,

        conduite: currentConduct,

        moyenne_annuelle: currentAnnual,
        moyenne_annuelle_complete: currentAnnual !== null,
        moyenne_annuelle_has_star: false,
        rang_annuel: currentAnnual !== null ? cleanRank(item.annual_rank) : null,

        subject_values: subjectValues,
      };
    });

    const { periodRankByIndex, annualRankByIndex } = assignRanks(classRows);

    classRows.forEach((row, index) => {
      if (row.moyenne_generale !== null && (row.rang === null || row.rang === undefined)) {
        row.rang = periodRankByIndex.get(index) ?? null;
      }

      if (row.moyenne_annuelle !== null && (row.rang_annuel === null || row.rang_annuel === undefined)) {
        row.rang_annuel = annualRankByIndex.get(index) ?? null;
      }

      if (row.moyenne_generale === null) row.rang = null;
      if (row.moyenne_annuelle === null) row.rang_annuel = null;
    });

    allExportRows.push(...classRows);
  }

  if (!allExportRows.length) return { error: "NO_EXPORTABLE_DATA", status: 404 };

  allExportRows.sort((a, b) => {
    const classCmp = a.classe.localeCompare(b.classe, "fr", { numeric: true, sensitivity: "base" });
    if (classCmp !== 0) return classCmp;

    const rankA = Number.isFinite(Number(a.rang)) ? Number(a.rang) : 999999;
    const rankB = Number.isFinite(Number(b.rang)) ? Number(b.rang) : 999999;
    if (rankA !== rankB) return rankA - rankB;

    const avgA = a.moyenne_generale !== null && Number.isFinite(Number(a.moyenne_generale)) ? Number(a.moyenne_generale) : -Infinity;
    const avgB = b.moyenne_generale !== null && Number.isFinite(Number(b.moyenne_generale)) ? Number(b.moyenne_generale) : -Infinity;
    if (avgB !== avgA) return avgB - avgA;

    return `${a.nom} ${a.prenoms}`.trim().localeCompare(`${b.nom} ${b.prenoms}`.trim(), "fr", {
      sensitivity: "base",
      numeric: true,
    });
  });

  const preparedRows = buildExportRows(allExportRows, includeSubjects ? subjectHeaderOrder : []);

  return {
    filenameBase: [
      "export-moyennes",
      toFileSafePart(institutionName || "etablissement"),
      toFileSafePart(resolvedPeriod.academicYear || "annee"),
      toFileSafePart(resolvedPeriod.requestedCode || "periode"),
      classes.length === 1 ? toFileSafePart(String(classes[0].label || classes[0].code || "")) : "toutes-classes",
    ]
      .filter(Boolean)
      .join("_"),
    mainSheetName: "Moyennes",
    rows: preparedRows,
    classSheets:
      classes.length > 1
        ? classes
            .map((cls) => {
              const classLabel = String(cls.label || cls.code || "Classe");
              const classRows = allExportRows.filter((row) => row.classe === classLabel);
              if (!classRows.length) return null;
              return {
                sheetName: safeSheetName(classLabel),
                rows: buildExportRows(classRows, includeSubjects ? subjectHeaderOrder : []),
              };
            })
            .filter(Boolean) as { sheetName: string; rows: Record<string, unknown>[] }[]
        : [],
  };
}

async function prepareDspsNotesExport(params: {
  req: NextRequest;
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  institutionId: string;
  institutionName: string;
  academicYear: string;
  periodRef: string;
  classId: string;
}): Promise<PreparedWorkbook | { error: string; status: number }> {
  const { req, supabase, institutionId, institutionName, academicYear, periodRef, classId } = params;

  const resolvedPeriod = await resolvePeriod({ supabase, institutionId, academicYear, periodRef });

  if (!resolvedPeriod || resolvedPeriod.requestedKind !== "period") {
    return { error: "INVALID_PERIOD_REF", status: 400 };
  }

  const { classes, error: classError } = await loadClasses({
    supabase,
    institutionId,
    academicYear: resolvedPeriod.academicYear,
    classId,
  });

  if (classError) return { error: classError, status: classError === "INVALID_CLASS_ID" ? 400 : 500 };
  if (!classes.length) return { error: "NO_CLASSES_FOUND", status: 404 };

  const headers = buildDspsNotesHeadersForClasses(classes);
  const studentMetaByKey = await loadStudentMeta({
    supabase,
    classes,
    academicYear: resolvedPeriod.academicYear,
    activeFrom: resolvedPeriod.bulletinFrom,
  });

  const rows: Record<string, unknown>[] = [];
  const classSheets: { sheetName: string; rows: Record<string, unknown>[] }[] = [];

  for (const cls of classes) {
    const currentClassId = String(cls.id);
    const firstCycle = isFirstCycleLevel(cls.level);
    const classHeaders = [
      ...DSPS_NOTES_BASE_HEADERS,
      ...(firstCycle ? DSPS_FIRST_CYCLE_SUBJECT_HEADERS : DSPS_SECOND_CYCLE_SUBJECT_HEADERS),
      ...DSPS_NOTES_END_HEADERS,
    ];

    const [bulletinData, conductMap] = await Promise.all([
      fetchBulletinForClass({
        req,
        classId: currentClassId,
        from: resolvedPeriod.bulletinFrom,
        to: resolvedPeriod.bulletinTo,
      }),
      fetchConductMap({
        req,
        classId: currentClassId,
        from: resolvedPeriod.bulletinFrom,
        to: resolvedPeriod.bulletinTo,
      }),
    ]);

    if (!bulletinData?.items?.length) continue;

    const { subjectNameById, componentById } = getSubjectMaps(bulletinData);
    const classRows: Record<string, unknown>[] = [];

    for (const item of bulletinData.items) {
      const key = `${currentClassId}__${String(item.student_id)}`;
      const meta = studentMetaByKey.get(key);
      const split = splitStudentName({
        first_name: meta?.first_name ?? null,
        last_name: meta?.last_name ?? null,
        full_name: meta?.full_name ?? item.full_name ?? null,
      });

      const rowValues: Record<string, unknown> = {
        Matricule: String(meta?.matricule || item.matricule || ""),
        Nom: split.nom_prenoms || [split.nom, split.prenoms].filter(Boolean).join(" "),
        Série: extractSeriesFromClass(cls),
        Niveau: displayLevelForDsps(cls),
        Conduite: formatDspsNumber(conductMap.get(String(item.student_id)) ?? null),
        Bonus: formatDspsNumber(item.general_bonus ?? null),
      };

      for (const header of firstCycle ? DSPS_FIRST_CYCLE_SUBJECT_HEADERS : DSPS_SECOND_CYCLE_SUBJECT_HEADERS) {
        const value = valueForDspsSubjectHeader({
          item,
          subjectNameById,
          componentById,
          header,
          firstCycle,
        });
        rowValues[header] = formatDspsNumber(value);
      }

      const rowForClass = buildOrderedRow(classHeaders, rowValues);
      const rowForGlobal = buildOrderedRow(headers, rowValues);
      classRows.push(rowForClass);
      rows.push(rowForGlobal);
    }

    sortRowsByClassRankAndName(classRows as any[]);
    classSheets.push({ sheetName: safeSheetName(String(cls.label || cls.code || "Classe")), rows: classRows });
  }

  if (!rows.length) return { error: "NO_EXPORTABLE_DATA", status: 404 };

  sortRowsByClassRankAndName(rows as any[]);

  return {
    filenameBase: [
      "export-desps-notes",
      toFileSafePart(institutionName || "etablissement"),
      toFileSafePart(resolvedPeriod.academicYear || "annee"),
      toFileSafePart(resolvedPeriod.requestedCode || "periode"),
      classes.length === 1 ? toFileSafePart(String(classes[0].label || classes[0].code || "")) : "toutes-classes",
    ]
      .filter(Boolean)
      .join("_"),
    mainSheetName: "Notes DESPS",
    rows,
    classSheets: classes.length > 1 ? classSheets : [],
  };
}

async function prepareDspsAnnualExport(params: {
  req: NextRequest;
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  institutionId: string;
  institutionName: string;
  academicYear: string;
  classId: string;
}): Promise<PreparedWorkbook | { error: string; status: number }> {
  const { req, supabase, institutionId, institutionName, academicYear, classId } = params;

  const periods = await loadAcademicPeriods({ supabase, institutionId, academicYear });
  if (!periods.length) return { error: "NO_PERIODS_FOUND", status: 404 };

  const displayPeriods = periods.slice(0, 3);
  const firstActiveDate = periods[0]?.start_date || `${academicYear.split("-")[0] || new Date().getFullYear()}-01-01`;

  const { classes, error: classError } = await loadClasses({
    supabase,
    institutionId,
    academicYear,
    classId,
  });

  if (classError) return { error: classError, status: classError === "INVALID_CLASS_ID" ? 400 : 500 };
  if (!classes.length) return { error: "NO_CLASSES_FOUND", status: 404 };

  const studentMetaByKey = await loadStudentMeta({
    supabase,
    classes,
    academicYear,
    activeFrom: firstActiveDate,
  });

  const allRows: Record<string, unknown>[] = [];
  const classSheets: { sheetName: string; rows: Record<string, unknown>[] }[] = [];

  for (const cls of classes) {
    const currentClassId = String(cls.id);
    const bulletinsByPeriod = new Map<string, BulletinResponse>();

    await Promise.all(
      displayPeriods.map(async (period) => {
        const bulletin = await fetchBulletinForClass({
          req,
          classId: currentClassId,
          from: period.start_date,
          to: period.end_date,
        });
        if (bulletin) bulletinsByPeriod.set(period.id, bulletin);
      })
    );

    const studentIds = new Set<string>();
    const itemsByPeriodStudent = new Map<string, BulletinItem>();

    for (const period of displayPeriods) {
      const bulletin = bulletinsByPeriod.get(period.id);
      for (const item of bulletin?.items || []) {
        studentIds.add(String(item.student_id));
        itemsByPeriodStudent.set(`${period.id}__${String(item.student_id)}`, item);
      }
    }

    for (const [key, meta] of studentMetaByKey.entries()) {
      if (key.startsWith(`${currentClassId}__`)) studentIds.add(meta.student_id);
    }

    const rawRows = Array.from(studentIds).map((studentId) => {
      const meta = studentMetaByKey.get(`${currentClassId}__${studentId}`);
      const firstItem = displayPeriods
        .map((period) => itemsByPeriodStudent.get(`${period.id}__${studentId}`) || null)
        .find(Boolean) as BulletinItem | null;

      const split = splitStudentName({
        first_name: meta?.first_name ?? null,
        last_name: meta?.last_name ?? null,
        full_name: meta?.full_name ?? firstItem?.full_name ?? null,
      });

      const periodCells = displayPeriods.map((period) => {
        const item = itemsByPeriodStudent.get(`${period.id}__${studentId}`) || null;
        const avg = item && !isAdminForcedNc(item) ? cleanNumber(item.general_avg, 4) : null;
        return {
          avg,
          rank: avg !== null ? cleanRank(item?.rank) : null,
        };
      });

      const lastItem = [...displayPeriods]
        .reverse()
        .map((period) => itemsByPeriodStudent.get(`${period.id}__${studentId}`) || null)
        .find(Boolean) as BulletinItem | null;

      const annualForcedNc = isAdminAnnualForcedNc(lastItem);
      const validPeriodAvgs = periodCells
        .map((p) => p.avg)
        .filter((v): v is number => v !== null && Number.isFinite(Number(v)));

      const annualFromApi = !annualForcedNc ? cleanNumber(lastItem?.annual_avg, 4) : null;
      const annualAvg =
        annualFromApi !== null
          ? annualFromApi
          : annualForcedNc
          ? null
          : validPeriodAvgs.length
          ? cleanNumber(validPeriodAvgs.reduce((sum, value) => sum + value, 0) / validPeriodAvgs.length, 4)
          : null;

      return {
        studentId,
        matricule: String(meta?.matricule || firstItem?.matricule || ""),
        nom: split.nom,
        prenoms: split.prenoms,
        periodCells,
        annualAvg,
        annualRank: annualAvg !== null ? cleanRank(lastItem?.annual_rank) : null,
      };
    });

    const annualRankMap = new Map<string, number>();
    const annualEntries = rawRows
      .filter((row) => row.annualAvg !== null && Number.isFinite(Number(row.annualAvg)))
      .sort((a, b) => Number(b.annualAvg) - Number(a.annualAvg));

    let lastScore: number | null = null;
    let lastRank = 0;
    annualEntries.forEach((row, idx) => {
      const score = Number(row.annualAvg);
      if (lastScore === null || score !== lastScore) {
        lastRank = idx + 1;
        lastScore = score;
      }
      annualRankMap.set(row.studentId, lastRank);
    });

    const classRows = rawRows
      .map((row) => {
        const p1 = row.periodCells[0] || { avg: null, rank: null };
        const p2 = row.periodCells[1] || { avg: null, rank: null };
        const p3 = row.periodCells[2] || { avg: null, rank: null };
        const annualRank = row.annualRank ?? annualRankMap.get(row.studentId) ?? null;

        return buildOrderedRow(DSPS_ANNUAL_HEADERS, {
          "N°": 0,
          "Matricule national": row.matricule,
          Nom: row.nom,
          "Prénoms": row.prenoms,
          "Moy. 1er Trim": formatDspsNumber(p1.avg),
          Rang: formatDspsRank(p1.rank),
          "Moy. 2e Trim": formatDspsNumber(p2.avg),
          "Rang ": formatDspsRank(p2.rank),
          "Moy. 3e Trim": formatDspsNumber(p3.avg),
          "Rang  ": formatDspsRank(p3.rank),
          MGA: formatDspsNumber(row.annualAvg),
          "Rang   ": formatDspsRank(annualRank),
          "Décision du conseil": annualDecisionLabel(row.annualAvg),
        });
      })
      .sort((a, b) => {
        const rankA = Number.isFinite(Number(a["Rang   "])) ? Number(a["Rang   "]) : 999999;
        const rankB = Number.isFinite(Number(b["Rang   "])) ? Number(b["Rang   "]) : 999999;
        if (rankA !== rankB) return rankA - rankB;

        const avgA = Number.isFinite(Number(a.MGA)) ? Number(a.MGA) : -Infinity;
        const avgB = Number.isFinite(Number(b.MGA)) ? Number(b.MGA) : -Infinity;
        if (avgB !== avgA) return avgB - avgA;

        return `${a.Nom ?? ""} ${a["Prénoms"] ?? ""}`.trim().localeCompare(
          `${b.Nom ?? ""} ${b["Prénoms"] ?? ""}`.trim(),
          "fr",
          { sensitivity: "base", numeric: true }
        );
      })
      .map((row, index) => ({ ...row, "N°": index + 1 }));

    allRows.push(...classRows);
    classSheets.push({ sheetName: safeSheetName(String(cls.label || cls.code || "Classe")), rows: classRows });
  }

  if (!allRows.length) return { error: "NO_EXPORTABLE_DATA", status: 404 };

  const globalRows = classes.length > 1 ? allRows.map((row, index) => ({ ...row, "N°": index + 1 })) : allRows;

  return {
    filenameBase: [
      "export-desps-recapitulatif-annuel",
      toFileSafePart(institutionName || "etablissement"),
      toFileSafePart(academicYear || "annee"),
      classes.length === 1 ? toFileSafePart(String(classes[0].label || classes[0].code || "")) : "toutes-classes",
    ]
      .filter(Boolean)
      .join("_"),
    mainSheetName: "Récapitulatif annuel",
    rows: globalRows,
    classSheets: classes.length > 1 ? classSheets : [],
  };
}


async function prepareDespsTermSummaryExport(params: {
  req: NextRequest;
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  institutionId: string;
  institutionName: string;
  academicYear: string;
  periodRef: string;
  classId: string;
}): Promise<PreparedWorkbook | { error: string; status: number }> {
  const { req, supabase, institutionId, institutionName, academicYear, periodRef, classId } = params;

  const resolvedPeriod = await resolvePeriod({ supabase, institutionId, academicYear, periodRef });

  if (!resolvedPeriod || resolvedPeriod.requestedKind !== "period") {
    return { error: "INVALID_PERIOD_REF", status: 400 };
  }

  const { classes, error: classError } = await loadClasses({
    supabase,
    institutionId,
    academicYear: resolvedPeriod.academicYear,
    classId,
  });

  if (classError) return { error: classError, status: classError === "INVALID_CLASS_ID" ? 400 : 500 };
  if (!classes.length) return { error: "NO_CLASSES_FOUND", status: 404 };

  const studentMetaByKey = await loadStudentMeta({
    supabase,
    classes,
    academicYear: resolvedPeriod.academicYear,
    activeFrom: resolvedPeriod.bulletinFrom,
  });

  const rows: Record<string, unknown>[] = [];
  const totalAcc = makeSummaryAccumulator();

  for (const cls of classes) {
    const currentClassId = String(cls.id);
    const bulletinData = await fetchBulletinForClass({
      req,
      classId: currentClassId,
      from: resolvedPeriod.bulletinFrom,
      to: resolvedPeriod.bulletinTo,
    });

    const itemByStudent = new Map<string, BulletinItem>();
    for (const item of bulletinData?.items || []) itemByStudent.set(String(item.student_id), item);

    const studentIds = new Set<string>();
    for (const key of studentMetaByKey.keys()) {
      if (key.startsWith(`${currentClassId}__`)) {
        studentIds.add(key.slice(`${currentClassId}__`.length));
      }
    }
    for (const item of bulletinData?.items || []) studentIds.add(String(item.student_id));

    const classAcc = makeSummaryAccumulator();

    for (const studentId of studentIds) {
      const meta = studentMetaByKey.get(`${currentClassId}__${studentId}`);
      const item = itemByStudent.get(studentId) || null;
      const forcedNc = isAdminForcedNc(item);
      const avg = item && !forcedNc ? cleanNumber(item.general_avg, 4) : null;
      const gender = getStudentGender({ meta, item });

      addPeriodAverageToAccumulator(classAcc, avg, gender);
      addPeriodAverageToAccumulator(totalAcc, avg, gender);
    }

    rows.push(
      buildOrderedRow(DESPS_TERM_SUMMARY_HEADERS, {
        Niveau: displayLevelForDsps(cls),
        Série: extractSeriesFromClass(cls),
        Classe: String(cls.label || cls.code || "Classe"),
        "Effectif total": classAcc.total,
        Filles: classAcc.girls,
        Garçons: classAcc.boys,
        Classés: classAcc.classed,
        "Filles classées": classAcc.classedGirls,
        "Garçons classés": classAcc.classedBoys,
        "Non classés": classAcc.nonClassed,
        "Moy. >= 10": classAcc.ge10,
        "Filles moy. >= 10": classAcc.ge10Girls,
        "Garçons moy. >= 10": classAcc.ge10Boys,
        "8,50 <= Moy. < 10": classAcc.between850And10,
        "Moy. < 8,50": classAcc.lt850,
        "Moyenne générale classe": meanFromAccumulator(classAcc),
        "Taux réussite %": percent(classAcc.ge10, classAcc.classed),
      })
    );
  }

  if (!rows.length) return { error: "NO_EXPORTABLE_DATA", status: 404 };

  rows.sort((a, b) => {
    const levelCmp = String(a.Niveau || "").localeCompare(String(b.Niveau || ""), "fr", {
      numeric: true,
      sensitivity: "base",
    });
    if (levelCmp !== 0) return levelCmp;
    return String(a.Classe || "").localeCompare(String(b.Classe || ""), "fr", {
      numeric: true,
      sensitivity: "base",
    });
  });

  rows.push(
    buildOrderedRow(DESPS_TERM_SUMMARY_HEADERS, {
      Niveau: "TOTAL",
      Série: "",
      Classe: "Toutes les classes",
      "Effectif total": totalAcc.total,
      Filles: totalAcc.girls,
      Garçons: totalAcc.boys,
      Classés: totalAcc.classed,
      "Filles classées": totalAcc.classedGirls,
      "Garçons classés": totalAcc.classedBoys,
      "Non classés": totalAcc.nonClassed,
      "Moy. >= 10": totalAcc.ge10,
      "Filles moy. >= 10": totalAcc.ge10Girls,
      "Garçons moy. >= 10": totalAcc.ge10Boys,
      "8,50 <= Moy. < 10": totalAcc.between850And10,
      "Moy. < 8,50": totalAcc.lt850,
      "Moyenne générale classe": meanFromAccumulator(totalAcc),
      "Taux réussite %": percent(totalAcc.ge10, totalAcc.classed),
    })
  );

  return {
    filenameBase: [
      "export-desps-rendement-trimestriel",
      toFileSafePart(institutionName || "etablissement"),
      toFileSafePart(resolvedPeriod.academicYear || "annee"),
      toFileSafePart(resolvedPeriod.requestedCode || "periode"),
      classes.length === 1 ? toFileSafePart(String(classes[0].label || classes[0].code || "")) : "toutes-classes",
    ]
      .filter(Boolean)
      .join("_"),
    mainSheetName: "Rendement général",
    rows,
  };
}

async function prepareDespsSubjectSummaryExport(params: {
  req: NextRequest;
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  institutionId: string;
  institutionName: string;
  academicYear: string;
  periodRef: string;
  classId: string;
}): Promise<PreparedWorkbook | { error: string; status: number }> {
  const { req, supabase, institutionId, institutionName, academicYear, periodRef, classId } = params;

  const resolvedPeriod = await resolvePeriod({ supabase, institutionId, academicYear, periodRef });

  if (!resolvedPeriod || resolvedPeriod.requestedKind !== "period") {
    return { error: "INVALID_PERIOD_REF", status: 400 };
  }

  const { classes, error: classError } = await loadClasses({
    supabase,
    institutionId,
    academicYear: resolvedPeriod.academicYear,
    classId,
  });

  if (classError) return { error: classError, status: classError === "INVALID_CLASS_ID" ? 400 : 500 };
  if (!classes.length) return { error: "NO_CLASSES_FOUND", status: 404 };

  const studentMetaByKey = await loadStudentMeta({
    supabase,
    classes,
    academicYear: resolvedPeriod.academicYear,
    activeFrom: resolvedPeriod.bulletinFrom,
  });

  const rows: Record<string, unknown>[] = [];

  for (const cls of classes) {
    const currentClassId = String(cls.id);
    const firstCycle = isFirstCycleLevel(cls.level);
    const subjectHeaders = firstCycle
      ? DSPS_FIRST_CYCLE_SUBJECT_HEADERS
      : DSPS_SECOND_CYCLE_SUBJECT_HEADERS;

    const bulletinData = await fetchBulletinForClass({
      req,
      classId: currentClassId,
      from: resolvedPeriod.bulletinFrom,
      to: resolvedPeriod.bulletinTo,
    });

    if (!bulletinData?.items?.length) {
      continue;
    }

    const { subjectNameById, componentById } = getSubjectMaps(bulletinData);
    const metaByStudent = new Map<string, StudentMetaRow>();
    const allStudentIds = new Set<string>();

    for (const key of studentMetaByKey.keys()) {
      if (key.startsWith(`${currentClassId}__`)) {
        const studentId = key.slice(`${currentClassId}__`.length);
        allStudentIds.add(studentId);
        const meta = studentMetaByKey.get(key);
        if (meta) metaByStudent.set(studentId, meta);
      }
    }

    for (const item of bulletinData.items || []) allStudentIds.add(String(item.student_id));

    for (const header of subjectHeaders) {
      let noted = 0;
      let notedGirls = 0;
      let notedBoys = 0;
      let ge10 = 0;
      let ge10Girls = 0;
      let ge10Boys = 0;
      let lt10 = 0;
      let sum = 0;

      for (const item of bulletinData.items || []) {
        const studentId = String(item.student_id);
        const meta = metaByStudent.get(studentId);
        const gender = getStudentGender({ meta, item });
        const value = valueForDspsSubjectHeader({
          item,
          subjectNameById,
          componentById,
          header,
          firstCycle,
        });

        if (value === null || !Number.isFinite(Number(value))) continue;

        const avg = Number(value);
        noted += 1;
        sum += avg;

        if (gender === "F") notedGirls += 1;
        else notedBoys += 1;

        if (avg >= 10) {
          ge10 += 1;
          if (gender === "F") ge10Girls += 1;
          else ge10Boys += 1;
        } else {
          lt10 += 1;
        }
      }

      rows.push(
        buildOrderedRow(DESPS_SUBJECT_SUMMARY_HEADERS, {
          Niveau: displayLevelForDsps(cls),
          Série: extractSeriesFromClass(cls),
          Classe: String(cls.label || cls.code || "Classe"),
          Discipline: header,
          "Effectif total": allStudentIds.size,
          "Élèves notés": noted,
          "Filles notées": notedGirls,
          "Garçons notés": notedBoys,
          "Non notés": Math.max(0, allStudentIds.size - noted),
          "Moyenne discipline": noted ? Number((sum / noted).toFixed(2)) : "",
          "Notes >= 10": ge10,
          "Filles notes >= 10": ge10Girls,
          "Garçons notes >= 10": ge10Boys,
          "Notes < 10": lt10,
          "Taux réussite %": percent(ge10, noted),
        })
      );
    }
  }

  if (!rows.length) return { error: "NO_EXPORTABLE_DATA", status: 404 };

  rows.sort((a, b) => {
    const classCmp = String(a.Classe || "").localeCompare(String(b.Classe || ""), "fr", {
      numeric: true,
      sensitivity: "base",
    });
    if (classCmp !== 0) return classCmp;
    return String(a.Discipline || "").localeCompare(String(b.Discipline || ""), "fr", {
      numeric: true,
      sensitivity: "base",
    });
  });

  return {
    filenameBase: [
      "export-desps-moyennes-disciplines",
      toFileSafePart(institutionName || "etablissement"),
      toFileSafePart(resolvedPeriod.academicYear || "annee"),
      toFileSafePart(resolvedPeriod.requestedCode || "periode"),
      classes.length === 1 ? toFileSafePart(String(classes[0].label || classes[0].code || "")) : "toutes-classes",
    ]
      .filter(Boolean)
      .join("_"),
    mainSheetName: "Moyennes disciplines",
    rows,
  };
}

async function prepareDespsDfaSummaryExport(params: {
  req: NextRequest;
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  institutionId: string;
  institutionName: string;
  academicYear: string;
  classId: string;
}): Promise<PreparedWorkbook | { error: string; status: number }> {
  const { req, supabase, institutionId, institutionName, academicYear, classId } = params;

  const periods = await loadAcademicPeriods({ supabase, institutionId, academicYear });
  if (!periods.length) return { error: "NO_PERIODS_FOUND", status: 404 };

  const displayPeriods = periods.slice(0, 3);
  const firstActiveDate = periods[0]?.start_date || `${academicYear.split("-")[0] || new Date().getFullYear()}-01-01`;

  const { classes, error: classError } = await loadClasses({
    supabase,
    institutionId,
    academicYear,
    classId,
  });

  if (classError) return { error: classError, status: classError === "INVALID_CLASS_ID" ? 400 : 500 };
  if (!classes.length) return { error: "NO_CLASSES_FOUND", status: 404 };

  const studentMetaByKey = await loadStudentMeta({
    supabase,
    classes,
    academicYear,
    activeFrom: firstActiveDate,
  });

  const rows: Record<string, unknown>[] = [];
  const total = {
    effectif: 0,
    girls: 0,
    boys: 0,
    classed: 0,
    nonClassed: 0,
    ge10: 0,
    ge10Girls: 0,
    ge10Boys: 0,
    lt10: 0,
    admitted: 0,
    toReview: 0,
    repeaters: 0,
    excluded: 0,
    sum: 0,
  };

  for (const cls of classes) {
    const currentClassId = String(cls.id);
    const bulletinsByPeriod = new Map<string, BulletinResponse>();

    await Promise.all(
      displayPeriods.map(async (period) => {
        const bulletin = await fetchBulletinForClass({
          req,
          classId: currentClassId,
          from: period.start_date,
          to: period.end_date,
        });
        if (bulletin) bulletinsByPeriod.set(period.id, bulletin);
      })
    );

    const studentIds = new Set<string>();
    const itemsByPeriodStudent = new Map<string, BulletinItem>();

    for (const period of displayPeriods) {
      const bulletin = bulletinsByPeriod.get(period.id);
      for (const item of bulletin?.items || []) {
        studentIds.add(String(item.student_id));
        itemsByPeriodStudent.set(`${period.id}__${String(item.student_id)}`, item);
      }
    }

    for (const [key, meta] of studentMetaByKey.entries()) {
      if (key.startsWith(`${currentClassId}__`)) studentIds.add(meta.student_id);
    }

    let girls = 0;
    let boys = 0;
    let classed = 0;
    let nonClassed = 0;
    let ge10 = 0;
    let ge10Girls = 0;
    let ge10Boys = 0;
    let lt10 = 0;
    let admitted = 0;
    let toReview = 0;
    let repeaters = 0;
    let excluded = 0;
    let sum = 0;

    for (const studentId of studentIds) {
      const meta = studentMetaByKey.get(`${currentClassId}__${studentId}`);
      const periodCells = displayPeriods.map((period) => {
        const item = itemsByPeriodStudent.get(`${period.id}__${studentId}`) || null;
        return item && !isAdminForcedNc(item) ? cleanNumber(item.general_avg, 4) : null;
      });

      const lastItem = [...displayPeriods]
        .reverse()
        .map((period) => itemsByPeriodStudent.get(`${period.id}__${studentId}`) || null)
        .find(Boolean) as BulletinItem | null;

      const gender = getStudentGender({ meta, item: lastItem });
      if (gender === "F") girls += 1;
      else boys += 1;

      const annualForcedNc = isAdminAnnualForcedNc(lastItem);
      const validPeriodAvgs = periodCells.filter((v): v is number => v !== null && Number.isFinite(Number(v)));
      const annualFromApi = !annualForcedNc ? cleanNumber(lastItem?.annual_avg, 4) : null;
      const annualAvg =
        annualFromApi !== null
          ? annualFromApi
          : annualForcedNc
          ? null
          : validPeriodAvgs.length
          ? cleanNumber(validPeriodAvgs.reduce((acc, value) => acc + value, 0) / validPeriodAvgs.length, 4)
          : null;

      const decision = dfaAutoDecision(annualAvg);

      if (annualAvg === null) {
        nonClassed += 1;
      } else {
        const avg = Number(annualAvg);
        classed += 1;
        sum += avg;

        if (avg >= 10) {
          ge10 += 1;
          admitted += 1;
          if (gender === "F") ge10Girls += 1;
          else ge10Boys += 1;
        } else {
          lt10 += 1;
        }
      }

      if (decision === "examiner") toReview += 1;
    }

    total.effectif += studentIds.size;
    total.girls += girls;
    total.boys += boys;
    total.classed += classed;
    total.nonClassed += nonClassed;
    total.ge10 += ge10;
    total.ge10Girls += ge10Girls;
    total.ge10Boys += ge10Boys;
    total.lt10 += lt10;
    total.admitted += admitted;
    total.toReview += toReview;
    total.repeaters += repeaters;
    total.excluded += excluded;
    total.sum += sum;

    rows.push(
      buildOrderedRow(DESPS_DFA_SUMMARY_HEADERS, {
        Cycle: classCycleLabel(cls),
        Niveau: displayLevelForDsps(cls),
        Série: extractSeriesFromClass(cls),
        Classe: String(cls.label || cls.code || "Classe"),
        "Effectif total": studentIds.size,
        Filles: girls,
        Garçons: boys,
        "Classés annuels": classed,
        "Non classés annuels": nonClassed,
        "Moy. annuelle >= 10": ge10,
        "Filles moy. annuelle >= 10": ge10Girls,
        "Garçons moy. annuelle >= 10": ge10Boys,
        "Moy. annuelle < 10": lt10,
        "Admis automatiques": admitted,
        "À examiner en conseil": toReview,
        "Redoublants saisis": repeaters,
        "Exclus saisis": excluded,
        "Moyenne annuelle classe": classed ? Number((sum / classed).toFixed(2)) : "",
        "Taux admission automatique %": percent(admitted, classed),
      })
    );
  }

  if (!rows.length) return { error: "NO_EXPORTABLE_DATA", status: 404 };

  rows.sort((a, b) => {
    const cycleCmp = String(a.Cycle || "").localeCompare(String(b.Cycle || ""), "fr", {
      numeric: true,
      sensitivity: "base",
    });
    if (cycleCmp !== 0) return cycleCmp;
    const levelCmp = String(a.Niveau || "").localeCompare(String(b.Niveau || ""), "fr", {
      numeric: true,
      sensitivity: "base",
    });
    if (levelCmp !== 0) return levelCmp;
    return String(a.Classe || "").localeCompare(String(b.Classe || ""), "fr", {
      numeric: true,
      sensitivity: "base",
    });
  });

  rows.push(
    buildOrderedRow(DESPS_DFA_SUMMARY_HEADERS, {
      Cycle: "TOTAL",
      Niveau: "TOTAL",
      Série: "",
      Classe: "Toutes les classes",
      "Effectif total": total.effectif,
      Filles: total.girls,
      Garçons: total.boys,
      "Classés annuels": total.classed,
      "Non classés annuels": total.nonClassed,
      "Moy. annuelle >= 10": total.ge10,
      "Filles moy. annuelle >= 10": total.ge10Girls,
      "Garçons moy. annuelle >= 10": total.ge10Boys,
      "Moy. annuelle < 10": total.lt10,
      "Admis automatiques": total.admitted,
      "À examiner en conseil": total.toReview,
      "Redoublants saisis": total.repeaters,
      "Exclus saisis": total.excluded,
      "Moyenne annuelle classe": total.classed ? Number((total.sum / total.classed).toFixed(2)) : "",
      "Taux admission automatique %": percent(total.admitted, total.classed),
    })
  );

  return {
    filenameBase: [
      "export-desps-dfa-synthese",
      toFileSafePart(institutionName || "etablissement"),
      toFileSafePart(academicYear || "annee"),
      classes.length === 1 ? toFileSafePart(String(classes[0].label || classes[0].code || "")) : "toutes-classes",
    ]
      .filter(Boolean)
      .join("_"),
    mainSheetName: "Synthèse DFA",
    rows,
  };
}

const OFFICIAL_DRENA_LIST = [
  "ABENGOUROU",
  "ABIDJAN 1",
  "ABIDJAN 2",
  "ABIDJAN 3",
  "ABIDJAN 4",
  "ABOISSO",
  "ADZOPE",
  "AGBOVILLE",
  "BONDOUKOU",
  "BONGOUANOU",
  "BOUAFLE",
  "BOUAKE 1",
  "BOUAKE 2",
  "BOUNA",
  "BOUNDIALI",
  "DABOU",
  "DALOA",
  "DANANE",
  "DAOUKRO",
  "DIMBOKRO",
  "DIVO",
  "DUEKOUE",
  "FERKESSEDOUGOU",
  "GAGNOA",
  "GRAND BASSAM",
  "GUIGLO",
  "ISSIA",
  "KATIOLA",
  "KORHOGO",
  "MAN",
  "MANKONO",
  "MINIGNAN",
  "ODIENNE",
  "SAN-PEDRO",
  "SASSANDRA",
  "SEGUELA",
  "SINFRA",
  "SOUBRE",
  "TIASSALE",
  "TOUBA",
  "YAMOUSSOUKRO",
];

const OFFICIAL_TERM_LEVELS = [
  "6ème",
  "5ème",
  "4ème",
  "3ème",
  "1er CYCLE",
  "2ndeA",
  "2ndeC",
  "1èreA1",
  "1èreA2",
  "1èreC",
  "1èreD",
  "TleA1",
  "TleA2",
  "TleC",
  "TleD",
  "2nd CYCLE",
  "TOTAL",
] as const;

const OFFICIAL_DFA_INTERMEDIATE_LEVELS = [
  "6ème",
  "5ème",
  "4ème",
  "1er CYCLE",
  "2ndeA",
  "2ndeC",
  "1èreA1",
  "1èreA2",
  "1èreC",
  "1èreD",
  "2nd CYCLE",
  "TOTAL",
] as const;

const OFFICIAL_DFA_EXAM_LEVELS = ["3ème", "1er CYCLE", "TleA1", "TleA2", "TleC", "TleD", "2nd CYCLE", "TOTAL"] as const;

const OFFICIAL_SUBJECT_COLUMNS = [
  { title: "COMPO. FR", header: "Composition Française", col: 2 },
  { title: "ORTH/GRAM", header: "Orthographe", col: 5 },
  { title: "ANGLAIS", header: "Anglais", col: 8 },
  { title: "ALLEMAND", header: "Allemand", col: 11 },
  { title: "ESPAGNOL", header: "Espagnol", col: 14 },
  { title: "HG", header: "Histoire-Géographie", col: 17 },
  { title: "MATHS", header: "Mathématiques", col: 20 },
  { title: "PC", header: "Sciences Physiques", col: 23 },
  { title: "SVT", header: "SVT", col: 26 },
  { title: "PHILO", header: "Philosophie", col: 29 },
  { title: "Français (uniquement pour le 2nd cycle)", header: "Français", col: 32 },
] as const;

type OfficialGeneralStats = {
  girls: number;
  boys: number;
  classedGirls: number;
  classedBoys: number;
  nonClassedGirls: number;
  nonClassedBoys: number;
  ge10Girls: number;
  ge10Boys: number;
  betweenGirls: number;
  betweenBoys: number;
  lt850Girls: number;
  lt850Boys: number;
  sum: number;
};

type OfficialSubjectStats = {
  classedGirls: number;
  classedBoys: number;
  lt10Girls: number;
  lt10Boys: number;
};

type OfficialDfaStats = OfficialGeneralStats & {
  admittedGirls: number;
  admittedBoys: number;
  repeatGirls: number;
  repeatBoys: number;
  excludedGirls: number;
  excludedBoys: number;
};

function makeOfficialGeneralStats(): OfficialGeneralStats {
  return {
    girls: 0,
    boys: 0,
    classedGirls: 0,
    classedBoys: 0,
    nonClassedGirls: 0,
    nonClassedBoys: 0,
    ge10Girls: 0,
    ge10Boys: 0,
    betweenGirls: 0,
    betweenBoys: 0,
    lt850Girls: 0,
    lt850Boys: 0,
    sum: 0,
  };
}

function makeOfficialSubjectStats(): OfficialSubjectStats {
  return { classedGirls: 0, classedBoys: 0, lt10Girls: 0, lt10Boys: 0 };
}

function makeOfficialDfaStats(): OfficialDfaStats {
  return {
    ...makeOfficialGeneralStats(),
    admittedGirls: 0,
    admittedBoys: 0,
    repeatGirls: 0,
    repeatBoys: 0,
    excludedGirls: 0,
    excludedBoys: 0,
  };
}

function officialTotal(stats: Pick<OfficialGeneralStats, "girls" | "boys">) {
  return stats.girls + stats.boys;
}

function officialClassed(stats: Pick<OfficialGeneralStats, "classedGirls" | "classedBoys">) {
  return stats.classedGirls + stats.classedBoys;
}

function officialLevelKey(cls: ClassRow): string {
  const codeFromOfficialTrack = officialTrackToDespsLevel(cls.official_track_code);
  if (codeFromOfficialTrack) return codeFromOfficialTrack;

  const level = normalizeLevel(cls.level);
  const label = normalizeForMatch(`${cls.label || ""} ${cls.code || ""}`);

  if (level === "6e") return "6ème";
  if (level === "5e") return "5ème";
  if (level === "4e") return "4ème";
  if (level === "3e") return "3ème";

  const series = extractSeriesFromClass(cls).toUpperCase();

  if (level === "seconde") {
    if (series === "C" || label.includes("2nde c") || label.includes("2nd c")) return "2ndeC";
    return "2ndeA";
  }

  if (level === "première") {
    if (series === "C") return "1èreC";
    if (series === "D") return "1èreD";
    return "1èreA2";
  }

  if (level === "terminale") {
    if (series === "C") return "TleC";
    if (series === "D") return "TleD";
    return "TleA2";
  }

  return displayLevelForDsps(cls) || "Autre";
}

function officialCycleKey(levelKey: string): "first" | "second" | "other" {
  if (["6ème", "5ème", "4ème", "3ème"].includes(levelKey)) return "first";
  if (levelKey.startsWith("2nde") || levelKey.startsWith("1ère") || levelKey.startsWith("Tle")) return "second";
  return "other";
}

function addOfficialGeneral(stats: OfficialGeneralStats, avg: number | null, gender: "F" | "M" | "") {
  const isGirl = gender === "F";
  if (isGirl) stats.girls += 1;
  else stats.boys += 1;

  if (avg === null || !Number.isFinite(Number(avg))) {
    if (isGirl) stats.nonClassedGirls += 1;
    else stats.nonClassedBoys += 1;
    return;
  }

  const value = Number(avg);
  stats.sum += value;
  if (isGirl) stats.classedGirls += 1;
  else stats.classedBoys += 1;

  if (value >= 10) {
    if (isGirl) stats.ge10Girls += 1;
    else stats.ge10Boys += 1;
  } else if (value >= 8.5) {
    if (isGirl) stats.betweenGirls += 1;
    else stats.betweenBoys += 1;
  } else if (isGirl) stats.lt850Girls += 1;
  else stats.lt850Boys += 1;
}

function addOfficialDfa(stats: OfficialDfaStats, avg: number | null, gender: "F" | "M" | "") {
  addOfficialGeneral(stats, avg, gender);
  const isGirl = gender === "F";
  if (avg === null || !Number.isFinite(Number(avg))) return;
  if (Number(avg) >= 10) {
    if (isGirl) stats.admittedGirls += 1;
    else stats.admittedBoys += 1;
  } else if (isGirl) stats.repeatGirls += 1;
  else stats.repeatBoys += 1;
}

function addOfficialSubject(stats: OfficialSubjectStats, value: number | null, gender: "F" | "M" | "") {
  if (value === null || !Number.isFinite(Number(value))) return;
  const isGirl = gender === "F";
  const avg = Number(value);
  if (isGirl) stats.classedGirls += 1;
  else stats.classedBoys += 1;
  if (avg < 10) {
    if (isGirl) stats.lt10Girls += 1;
    else stats.lt10Boys += 1;
  }
}

function mergeOfficialGeneral(target: OfficialGeneralStats, source: OfficialGeneralStats) {
  for (const key of Object.keys(target) as (keyof OfficialGeneralStats)[]) {
    target[key] = Number(target[key] || 0) + Number(source[key] || 0);
  }
}

function mergeOfficialDfa(target: OfficialDfaStats, source: OfficialDfaStats) {
  for (const key of Object.keys(target) as (keyof OfficialDfaStats)[]) {
    target[key] = Number(target[key] || 0) + Number(source[key] || 0);
  }
}

function cellRefToIndexes(ref: string) {
  const match = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!match) return { r: 0, c: 0 };
  let c = 0;
  for (const ch of match[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(match[2]) - 1, c: c - 1 };
}

function setAoaCell(aoa: unknown[][], ref: string, value: unknown) {
  const { r, c } = cellRefToIndexes(ref);
  while (aoa.length <= r) aoa.push([]);
  while (aoa[r].length <= c) aoa[r].push("");
  aoa[r][c] = value;
}

function makeAoa(rows: number, cols: number) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => "" as unknown));
}

function termText(term: 1 | 2 | 3) {
  if (term === 1) return { label: "1er", title: "1er TRIMESTRE", mg: "MGT1", mt: "MT1" };
  if (term === 2) return { label: "2ème", title: "2ème TRIMESTRE", mg: "MGT2", mt: "MT2" };
  return { label: "3ème", title: "3ème TRIMESTRE", mg: "MGT3", mt: "MT3" };
}

function putTermGeneralRow(aoa: unknown[][], rowIndex1: number, level: string, stats: OfficialGeneralStats, institutionName: string) {
  const r = rowIndex1;
  setAoaCell(aoa, `B${r}`, institutionName);
  setAoaCell(aoa, `C${r}`, "Public");
  setAoaCell(aoa, `D${r}`, level);
  setAoaCell(aoa, `E${r}`, stats.girls);
  setAoaCell(aoa, `F${r}`, stats.boys);
  setAoaCell(aoa, `G${r}`, officialTotal(stats));
  setAoaCell(aoa, `H${r}`, stats.classedGirls);
  setAoaCell(aoa, `I${r}`, stats.classedBoys);
  setAoaCell(aoa, `J${r}`, officialClassed(stats));
  setAoaCell(aoa, `K${r}`, stats.nonClassedGirls);
  setAoaCell(aoa, `L${r}`, stats.nonClassedBoys);
  setAoaCell(aoa, `M${r}`, stats.nonClassedGirls + stats.nonClassedBoys);
  setAoaCell(aoa, `N${r}`, stats.ge10Girls);
  setAoaCell(aoa, `O${r}`, percentCell(stats.ge10Girls, stats.classedGirls));
  setAoaCell(aoa, `P${r}`, stats.ge10Boys);
  setAoaCell(aoa, `Q${r}`, percentCell(stats.ge10Boys, stats.classedBoys));
  setAoaCell(aoa, `R${r}`, stats.ge10Girls + stats.ge10Boys);
  setAoaCell(aoa, `S${r}`, percentCell(stats.ge10Girls + stats.ge10Boys, officialClassed(stats)));
  setAoaCell(aoa, `T${r}`, stats.betweenGirls);
  setAoaCell(aoa, `U${r}`, percentCell(stats.betweenGirls, stats.classedGirls));
  setAoaCell(aoa, `V${r}`, stats.betweenBoys);
  setAoaCell(aoa, `W${r}`, percentCell(stats.betweenBoys, stats.classedBoys));
  setAoaCell(aoa, `X${r}`, stats.betweenGirls + stats.betweenBoys);
  setAoaCell(aoa, `Y${r}`, percentCell(stats.betweenGirls + stats.betweenBoys, officialClassed(stats)));
  setAoaCell(aoa, `Z${r}`, stats.lt850Girls);
  setAoaCell(aoa, `AA${r}`, percentCell(stats.lt850Girls, stats.classedGirls));
  setAoaCell(aoa, `AB${r}`, stats.lt850Boys);
  setAoaCell(aoa, `AC${r}`, percentCell(stats.lt850Boys, stats.classedBoys));
  setAoaCell(aoa, `AD${r}`, stats.lt850Girls + stats.lt850Boys);
  setAoaCell(aoa, `AE${r}`, percentCell(stats.lt850Girls + stats.lt850Boys, officialClassed(stats)));
}

function buildOfficialTermGeneralSheet(term: 1 | 2 | 3, academicYear: string, institutionName: string, statsByLevel: Map<string, OfficialGeneralStats>) {
  const t = termText(term);
  const aoa = makeAoa(88, 31);
  setAoaCell(aoa, "B1", `ANALYSE DU RENDEMENT DES ELEVES AU ${t.title} (${academicYear})`);
  setAoaCell(aoa, "C3", `Tableau 1: Récapitulatif des résultats des élèves par tranche de moyennes générales du ${t.label} trimestre`);
  setAoaCell(aoa, "A5", "DRENA");
  setAoaCell(aoa, "B5", "Etablissement");
  setAoaCell(aoa, "C5", "Statut (Public/Privé)");
  setAoaCell(aoa, "D5", "NIVEAU");
  setAoaCell(aoa, "E5", "Effectif total inscrit");
  setAoaCell(aoa, "H5", "Effectif classé");
  setAoaCell(aoa, "K5", "Effectif non classé");
  setAoaCell(aoa, "N5", `${t.mg}≥ 10`);
  setAoaCell(aoa, "T5", `8,50 ≤ ${t.mg}< 10`);
  setAoaCell(aoa, "Z5", ` ${t.mg}< 8,50`);
  for (const ref of ["E6", "H6", "K6"]) setAoaCell(aoa, ref, "Filles");
  for (const ref of ["F6", "I6", "L6"]) setAoaCell(aoa, ref, "Garçons");
  for (const ref of ["G6", "J6", "M6", "R6", "X6", "AD6"]) setAoaCell(aoa, ref, "Total");
  for (const ref of ["N6", "T6", "Z6"]) setAoaCell(aoa, ref, "Effectif filles");
  for (const ref of ["P6", "V6", "AB6"]) setAoaCell(aoa, ref, "Effectif garçons");
  for (const ref of ["O6", "U6", "AA6"]) setAoaCell(aoa, ref, "% filles");
  for (const ref of ["Q6", "W6", "AC6"]) setAoaCell(aoa, ref, "% garçons");
  for (const ref of ["S6", "Y6", "AE6"]) setAoaCell(aoa, ref, "% Total");

  const rowByLevel: Record<string, number> = {
    "6ème": 7,
    "5ème": 8,
    "4ème": 9,
    "3ème": 10,
    "1er CYCLE": 11,
    "2ndeA": 12,
    "2ndeC": 13,
    "1èreA1": 14,
    "1èreA2": 15,
    "1èreC": 16,
    "1èreD": 17,
    "TleA1": 18,
    "TleA2": 19,
    "TleC": 20,
    "TleD": 21,
    "2nd CYCLE": 22,
    TOTAL: 24,
  };

  for (const level of OFFICIAL_TERM_LEVELS) {
    const stats = statsByLevel.get(level) || makeOfficialGeneralStats();
    putTermGeneralRow(aoa, rowByLevel[level], level === "TOTAL" ? "" : level, stats, institutionName);
  }
  setAoaCell(aoa, "B24", "TOTAL");
  return aoa;
}

function putSubjectTriple(aoa: unknown[][], rowIndex1: number, startCol: number, stats: OfficialSubjectStats, gender: "F" | "M" | "T") {
  const classed = gender === "F" ? stats.classedGirls : gender === "M" ? stats.classedBoys : stats.classedGirls + stats.classedBoys;
  const lt10 = gender === "F" ? stats.lt10Girls : gender === "M" ? stats.lt10Boys : stats.lt10Girls + stats.lt10Boys;
  const r = rowIndex1 - 1;
  aoa[r][startCol] = classed;
  aoa[r][startCol + 1] = lt10;
  aoa[r][startCol + 2] = percentCell(lt10, classed);
}

function buildOfficialTermSubjectSheet(term: 1 | 2 | 3, subjectsByLevel: Map<string, Map<string, OfficialSubjectStats>>) {
  const t = termText(term);
  const aoa = makeAoa(56, 35);
  setAoaCell(aoa, "A2", `Tableau 2: Proportion d'élèves n'ayant pas obtenu la moyenne au ${t.label} trimestre par niveau et par discipline au général`);
  setAoaCell(aoa, "A4", "    Disciplines                                                             Niveaux                 ");
  setAoaCell(aoa, "B4", "Genre");

  for (const item of OFFICIAL_SUBJECT_COLUMNS) {
    aoa[3][item.col] = item.title;
    aoa[4][item.col] = "Effectif classé";
    aoa[4][item.col + 1] = ` ${t.mt}<10`;
    aoa[5][item.col + 1] = "Effectif";
    aoa[5][item.col + 2] = "% ";
  }

  const rows: { level: string; row: number }[] = [
    { level: "6ème", row: 7 },
    { level: "5ème", row: 10 },
    { level: "4ème", row: 13 },
    { level: "3ème", row: 16 },
    { level: "1er CYCLE", row: 19 },
    { level: "2ndeA", row: 23 },
    { level: "2ndeC", row: 26 },
    { level: "1èreA1", row: 29 },
    { level: "1èreA2", row: 32 },
    { level: "1èreC", row: 35 },
    { level: "1èreD", row: 38 },
    { level: "TleA1", row: 41 },
    { level: "TleA2", row: 44 },
    { level: "TleC", row: 47 },
    { level: "TleD", row: 50 },
    { level: "2nd CYCLE", row: 53 },
  ];

  for (const { level, row } of rows) {
    setAoaCell(aoa, `A${row}`, `${level} `);
    setAoaCell(aoa, `B${row}`, "Féminin");
    setAoaCell(aoa, `B${row + 1}`, "Masculin");
    setAoaCell(aoa, `B${row + 2}`, "Ensemble");

    const levelMap = subjectsByLevel.get(level) || new Map<string, OfficialSubjectStats>();
    for (const item of OFFICIAL_SUBJECT_COLUMNS) {
      const stats = levelMap.get(item.title) || makeOfficialSubjectStats();
      putSubjectTriple(aoa, row, item.col, stats, "F");
      putSubjectTriple(aoa, row + 1, item.col, stats, "M");
      putSubjectTriple(aoa, row + 2, item.col, stats, "T");
    }
  }

  return aoa;
}


function buildOfficialAnnualSubjectSheet(subjectsByLevel: Map<string, Map<string, OfficialSubjectStats>>) {
  const aoa = makeAoa(56, 35);
  setAoaCell(aoa, "A2", "Tableau 3: Proportion d'élèves n'ayant pas obtenu la moyenne annuelle par niveau et par discipline au général");
  setAoaCell(aoa, "A4", "    Disciplines                                                             Niveaux                 ");
  setAoaCell(aoa, "B4", "Genre");

  for (const item of OFFICIAL_SUBJECT_COLUMNS) {
    aoa[3][item.col] = item.title;
    aoa[4][item.col] = "Effectif classé";
    aoa[4][item.col + 1] = " MA<10";
    aoa[5][item.col + 1] = "Effectif";
    aoa[5][item.col + 2] = "% ";
  }

  const rows: { level: string; row: number }[] = [
    { level: "6ème", row: 7 },
    { level: "5ème", row: 10 },
    { level: "4ème", row: 13 },
    { level: "3ème", row: 16 },
    { level: "1er CYCLE", row: 19 },
    { level: "2ndeA", row: 23 },
    { level: "2ndeC", row: 26 },
    { level: "1èreA1", row: 29 },
    { level: "1èreA2", row: 32 },
    { level: "1èreC", row: 35 },
    { level: "1èreD", row: 38 },
    { level: "TleA1", row: 41 },
    { level: "TleA2", row: 44 },
    { level: "TleC", row: 47 },
    { level: "TleD", row: 50 },
    { level: "2nd CYCLE", row: 53 },
  ];

  for (const { level, row } of rows) {
    setAoaCell(aoa, `A${row}`, `${level} `);
    setAoaCell(aoa, `B${row}`, "Féminin");
    setAoaCell(aoa, `B${row + 1}`, "Masculin");
    setAoaCell(aoa, `B${row + 2}`, "Ensemble");

    const levelMap = subjectsByLevel.get(level) || new Map<string, OfficialSubjectStats>();
    for (const item of OFFICIAL_SUBJECT_COLUMNS) {
      const stats = levelMap.get(item.title) || makeOfficialSubjectStats();
      putSubjectTriple(aoa, row, item.col, stats, "F");
      putSubjectTriple(aoa, row + 1, item.col, stats, "M");
      putSubjectTriple(aoa, row + 2, item.col, stats, "T");
    }
  }

  return aoa;
}

function buildDropdownSheets(): PreparedSheet[] {
  return [
    {
      sheetName: "Liste déroulante motifs",
      aoa: [
        [""],
        ["Difficultés scolaires"],
        ["Classe d'examen avec de faibles résultats scolaires"],
        ["Nombre élevé de redoublants"],
        ["Effectif pléthorique"],
        ["Classe turbulente et indisciplinée "],
        ["Absences répétées"],
        ["Désintérêt pour le travail scolaire"],
        ["Autre"],
      ],
      cols: [{ wch: 48 }],
    },
    { sheetName: "Feuil1", aoa: OFFICIAL_DRENA_LIST.map((x) => [x]), cols: [{ wch: 22 }] },
    { sheetName: "Feuil2", aoa: [[""], [""], [""], [""], [""], [""], [""], [""], [""], [""], ["Public"], ["Privé"], ["Communautaire"]], cols: [{ wch: 16 }] },
  ];
}

async function collectOfficialTermStats(params: {
  req: NextRequest;
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  institutionId: string;
  academicYear: string;
  periodRef: string;
  classId: string;
}) {
  const { req, supabase, institutionId, academicYear, periodRef, classId } = params;
  const resolvedPeriod = await resolvePeriod({ supabase, institutionId, academicYear, periodRef });
  if (!resolvedPeriod || resolvedPeriod.requestedKind !== "period") return { error: "INVALID_PERIOD_REF" as const, status: 400 };

  const { classes, error: classError } = await loadClasses({ supabase, institutionId, academicYear: resolvedPeriod.academicYear, classId });
  if (classError) return { error: classError, status: classError === "INVALID_CLASS_ID" ? 400 : 500 };
  if (!classes.length) return { error: "NO_CLASSES_FOUND" as const, status: 404 };

  const studentMetaByKey = await loadStudentMeta({ supabase, classes, academicYear: resolvedPeriod.academicYear, activeFrom: resolvedPeriod.bulletinFrom });
  const generalByLevel = new Map<string, OfficialGeneralStats>();
  const subjectsByLevel = new Map<string, Map<string, OfficialSubjectStats>>();

  const ensureGeneral = (level: string) => {
    if (!generalByLevel.has(level)) generalByLevel.set(level, makeOfficialGeneralStats());
    return generalByLevel.get(level)!;
  };
  const ensureSubject = (level: string, title: string) => {
    if (!subjectsByLevel.has(level)) subjectsByLevel.set(level, new Map<string, OfficialSubjectStats>());
    const m = subjectsByLevel.get(level)!;
    if (!m.has(title)) m.set(title, makeOfficialSubjectStats());
    return m.get(title)!;
  };

  const classBulletins = await mapWithConcurrency(classes, BULLETIN_EXPORT_CONCURRENCY, async (cls) => {
    const currentClassId = String(cls.id);
    const bulletinData = await fetchBulletinForClass({
      req,
      classId: currentClassId,
      from: resolvedPeriod.bulletinFrom,
      to: resolvedPeriod.bulletinTo,
    });
    return { cls, currentClassId, bulletinData };
  });

  for (const { cls, currentClassId, bulletinData } of classBulletins) {
    const levelKey = officialLevelKey(cls);
    const cycleKey = officialCycleKey(levelKey);
    const itemByStudent = new Map<string, BulletinItem>();
    for (const item of bulletinData?.items || []) itemByStudent.set(String(item.student_id), item);

    const studentIds = new Set<string>();
    for (const key of studentMetaByKey.keys()) {
      if (key.startsWith(`${currentClassId}__`)) studentIds.add(key.slice(`${currentClassId}__`.length));
    }

    for (const studentId of studentIds) {
      const meta = studentMetaByKey.get(`${currentClassId}__${studentId}`);
      const item = itemByStudent.get(studentId) || null;
      const avg = item && !isAdminForcedNc(item) ? cleanNumber(item.general_avg, 4) : null;
      const gender = getStudentGender({ meta, item });
      addOfficialGeneral(ensureGeneral(levelKey), avg, gender);
    }

    if (bulletinData?.items?.length) {
      const { subjectNameById, componentById } = getSubjectMaps(bulletinData);
      for (const item of bulletinData.items) {
        const meta = studentMetaByKey.get(`${currentClassId}__${String(item.student_id)}`);
        if (!meta) continue;
        const gender = getStudentGender({ meta, item });
        for (const col of OFFICIAL_SUBJECT_COLUMNS) {
          if (cycleKey === "first" && col.title === "Français (uniquement pour le 2nd cycle)") continue;
          if (cycleKey === "first" && col.title === "PHILO") continue;
          if (cycleKey === "second" && ["COMPO. FR", "ORTH/GRAM"].includes(col.title)) continue;
          const value = valueForDspsSubjectHeader({ item, subjectNameById, componentById, header: col.header, firstCycle: cycleKey === "first" });
          addOfficialSubject(ensureSubject(levelKey, col.title), value, gender);
        }
      }
    }
  }

  const firstCycleTotal = makeOfficialGeneralStats();
  const secondCycleTotal = makeOfficialGeneralStats();
  const globalTotal = makeOfficialGeneralStats();
  for (const level of ["6ème", "5ème", "4ème", "3ème"]) mergeOfficialGeneral(firstCycleTotal, generalByLevel.get(level) || makeOfficialGeneralStats());
  for (const level of ["2ndeA", "2ndeC", "1èreA1", "1èreA2", "1èreC", "1èreD", "TleA1", "TleA2", "TleC", "TleD"]) mergeOfficialGeneral(secondCycleTotal, generalByLevel.get(level) || makeOfficialGeneralStats());
  mergeOfficialGeneral(globalTotal, firstCycleTotal);
  mergeOfficialGeneral(globalTotal, secondCycleTotal);
  generalByLevel.set("1er CYCLE", firstCycleTotal);
  generalByLevel.set("2nd CYCLE", secondCycleTotal);
  generalByLevel.set("TOTAL", globalTotal);

  const addSubjectTotal = (target: string, sourceLevels: string[]) => {
    for (const col of OFFICIAL_SUBJECT_COLUMNS) {
      const total = makeOfficialSubjectStats();
      for (const level of sourceLevels) {
        const stats = subjectsByLevel.get(level)?.get(col.title);
        if (!stats) continue;
        total.classedGirls += stats.classedGirls;
        total.classedBoys += stats.classedBoys;
        total.lt10Girls += stats.lt10Girls;
        total.lt10Boys += stats.lt10Boys;
      }
      ensureSubject(target, col.title).classedGirls = total.classedGirls;
      ensureSubject(target, col.title).classedBoys = total.classedBoys;
      ensureSubject(target, col.title).lt10Girls = total.lt10Girls;
      ensureSubject(target, col.title).lt10Boys = total.lt10Boys;
    }
  };
  addSubjectTotal("1er CYCLE", ["6ème", "5ème", "4ème", "3ème"]);
  addSubjectTotal("2nd CYCLE", ["2ndeA", "2ndeC", "1èreA1", "1èreA2", "1èreC", "1èreD", "TleA1", "TleA2", "TleC", "TleD"]);

  return { resolvedPeriod, generalByLevel, subjectsByLevel, classes };
}

async function prepareDespsOfficialTermExport(params: {
  req: NextRequest;
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  institutionId: string;
  institutionName: string;
  academicYear: string;
  periodRef: string;
  classId: string;
  term: 1 | 2 | 3;
}): Promise<PreparedWorkbook | { error: string; status: number }> {
  const collected = await collectOfficialTermStats(params);
  if ((collected as { error?: string }).error) {
    return collected as { error: string; status: number };
  }
  const { resolvedPeriod, generalByLevel, subjectsByLevel, classes } = collected as {
    resolvedPeriod: ResolvedPeriod;
    generalByLevel: Map<string, OfficialGeneralStats>;
    subjectsByLevel: Map<string, Map<string, OfficialSubjectStats>>;
    classes: ClassRow[];
  };
  return {
    templateFileName:
      params.term === 1
        ? "recueil_moyennes_t1.xlsx"
        : params.term === 2
        ? "recueil_moyennes_t2.xlsx"
        : "recueil_moyennes_t3.xlsx",
    outputExtension: "xlsx",
    filenameBase: [
      `fichier-recueil-moyennes-etablissement-${params.term}e-trimestre`,
      toFileSafePart(params.institutionName || "etablissement"),
      toFileSafePart(resolvedPeriod.academicYear || params.academicYear || "annee"),
      classes.length === 1 ? toFileSafePart(String(classes[0].label || classes[0].code || "")) : "toutes-classes",
    ]
      .filter(Boolean)
      .join("_"),
    mainSheetName: "Etab Rendement au général",
    rows: [],
    sheets: [
      ...buildDropdownSheets().slice(0, 1),
      {
        sheetName: "Etab Rendement au général",
        aoa: buildOfficialTermGeneralSheet(params.term, resolvedPeriod.academicYear, params.institutionName, generalByLevel),
        cols: Array.from({ length: 31 }, (_, i) => ({ wch: i < 4 ? 18 : 12 })),
        merges: [
          { s: { r: 0, c: 1 }, e: { r: 0, c: 30 } },
          { s: { r: 2, c: 2 }, e: { r: 2, c: 30 } },
        ],
      },
      {
        sheetName: "Moy par discipline au général",
        aoa: buildOfficialTermSubjectSheet(params.term, subjectsByLevel),
        cols: Array.from({ length: 35 }, (_, i) => ({ wch: i === 0 ? 14 : i === 1 ? 12 : 11 })),
        merges: [
          { s: { r: 1, c: 0 }, e: { r: 1, c: 34 } },
        ],
      },
      ...buildDropdownSheets().slice(1),
    ],
  };
}

function putDfaRow(aoa: unknown[][], rowIndex1: number, level: string, stats: OfficialDfaStats, institutionName: string, exam = false) {
  const r = rowIndex1;
  setAoaCell(aoa, `B${r}`, institutionName);
  setAoaCell(aoa, `C${r}`, "Public");
  setAoaCell(aoa, `D${r}`, level);
  setAoaCell(aoa, `E${r}`, stats.girls);
  setAoaCell(aoa, `F${r}`, stats.boys);
  setAoaCell(aoa, `G${r}`, officialTotal(stats));
  setAoaCell(aoa, `H${r}`, stats.classedGirls);
  setAoaCell(aoa, `I${r}`, stats.classedBoys);
  setAoaCell(aoa, `J${r}`, officialClassed(stats));
  setAoaCell(aoa, `K${r}`, stats.nonClassedGirls);
  setAoaCell(aoa, `L${r}`, stats.nonClassedBoys);
  setAoaCell(aoa, `M${r}`, stats.nonClassedGirls + stats.nonClassedBoys);
  const nGirls = exam ? stats.repeatGirls : stats.admittedGirls;
  const nBoys = exam ? stats.repeatBoys : stats.admittedBoys;
  setAoaCell(aoa, `N${r}`, nGirls);
  setAoaCell(aoa, `O${r}`, percentCell(nGirls, stats.classedGirls));
  setAoaCell(aoa, `P${r}`, nBoys);
  setAoaCell(aoa, `Q${r}`, percentCell(nBoys, stats.classedBoys));
  setAoaCell(aoa, `R${r}`, nGirls + nBoys);
  setAoaCell(aoa, `S${r}`, percentCell(nGirls + nBoys, officialClassed(stats)));

  const secondBlockGirls = exam ? stats.excludedGirls : stats.repeatGirls;
  const secondBlockBoys = exam ? stats.excludedBoys : stats.repeatBoys;
  setAoaCell(aoa, `T${r}`, secondBlockGirls);
  setAoaCell(aoa, `U${r}`, percentCell(secondBlockGirls, stats.classedGirls));
  setAoaCell(aoa, `V${r}`, secondBlockBoys);
  setAoaCell(aoa, `W${r}`, percentCell(secondBlockBoys, stats.classedBoys));
  setAoaCell(aoa, `X${r}`, secondBlockGirls + secondBlockBoys);
  setAoaCell(aoa, `Y${r}`, percentCell(secondBlockGirls + secondBlockBoys, officialClassed(stats)));

  if (!exam) {
    setAoaCell(aoa, `Z${r}`, stats.excludedGirls);
    setAoaCell(aoa, `AA${r}`, percentCell(stats.excludedGirls, stats.classedGirls));
    setAoaCell(aoa, `AB${r}`, stats.excludedBoys);
    setAoaCell(aoa, `AC${r}`, percentCell(stats.excludedBoys, stats.classedBoys));
    setAoaCell(aoa, `AD${r}`, stats.excludedGirls + stats.excludedBoys);
    setAoaCell(aoa, `AE${r}`, percentCell(stats.excludedGirls + stats.excludedBoys, officialClassed(stats)));
  }
}

function buildDfaIntermediateSheet(academicYear: string, institutionName: string, statsByLevel: Map<string, OfficialDfaStats>) {
  const aoa = makeAoa(83, 31);
  setAoaCell(aoa, "B1", `ANALYSE DU RENDEMENT ANNUEL DES ELEVES (${academicYear})`);
  setAoaCell(aoa, "C3", "Tableau 1: Récapitulatif de la répartition des élèves des classes intermédiaires par décision de fin d'année (DFA) selon le genre");
  setAoaCell(aoa, "A5", "DRENA");
  setAoaCell(aoa, "B5", "Etablissement");
  setAoaCell(aoa, "C5", "Statut (Public/Privé)");
  setAoaCell(aoa, "D5", "NIVEAU");
  setAoaCell(aoa, "E5", "Effectif total inscrit");
  setAoaCell(aoa, "H5", "Effectif classé");
  setAoaCell(aoa, "K5", "Effectif non classé");
  setAoaCell(aoa, "N5", "Admis‧e‧s");
  setAoaCell(aoa, "T5", "Redoublant‧e‧s");
  setAoaCell(aoa, "Z5", "Exclu‧e‧s");
  for (const ref of ["E6", "H6", "K6"]) setAoaCell(aoa, ref, "Filles");
  for (const ref of ["F6", "I6", "L6"]) setAoaCell(aoa, ref, "Garçons");
  for (const ref of ["G6", "J6", "M6", "R6", "X6", "AD6"]) setAoaCell(aoa, ref, "Ensemble");
  for (const ref of ["N6", "T6", "Z6"]) setAoaCell(aoa, ref, "Effectif filles");
  for (const ref of ["P6", "V6", "AB6"]) setAoaCell(aoa, ref, "Effectif garçons");
  for (const ref of ["O6", "U6", "AA6"]) setAoaCell(aoa, ref, "% filles");
  for (const ref of ["Q6", "W6", "AC6"]) setAoaCell(aoa, ref, "% garçons");
  for (const ref of ["S6", "Y6", "AE6"]) setAoaCell(aoa, ref, "% Ensemble");
  const rows: Record<string, number> = { "6ème": 7, "5ème": 8, "4ème": 9, "1er CYCLE": 10, "2ndeA": 11, "2ndeC": 12, "1èreA1": 13, "1èreA2": 14, "1èreC": 15, "1èreD": 16, "2nd CYCLE": 17, TOTAL: 19 };
  for (const level of OFFICIAL_DFA_INTERMEDIATE_LEVELS) putDfaRow(aoa, rows[level], level === "TOTAL" ? "" : level, statsByLevel.get(level) || makeOfficialDfaStats(), institutionName, false);
  setAoaCell(aoa, "B19", "TOTAL");
  return aoa;
}

function buildDfaExamSheet(academicYear: string, institutionName: string, statsByLevel: Map<string, OfficialDfaStats>) {
  const aoa = makeAoa(79, 25);
  setAoaCell(aoa, "B1", `ANALYSE DU RENDEMENT ANNUEL DES ELEVES (${academicYear})`);
  setAoaCell(aoa, "C3", "Tableau 2: Récapitulatif de la répartition des élèves des classes d'examen au secondaire général  par décision de fin d'année (DFA) selon le genre ");
  setAoaCell(aoa, "A5", "DRENA");
  setAoaCell(aoa, "B5", "Etablissement");
  setAoaCell(aoa, "C5", "Statut (Public/Privé)");
  setAoaCell(aoa, "D5", "NIVEAU");
  setAoaCell(aoa, "E5", "Effectif total inscrit");
  setAoaCell(aoa, "H5", "Effectif classé");
  setAoaCell(aoa, "K5", "Effectif non classé");
  setAoaCell(aoa, "N5", "Redouble si non orienté‧e/Redouble en cas d'échec");
  setAoaCell(aoa, "T5", "Exclu‧e si non orienté‧e/Exclu‧e en cas d'écchec");
  for (const ref of ["E6", "H6", "K6"]) setAoaCell(aoa, ref, "Filles");
  for (const ref of ["F6", "I6", "L6"]) setAoaCell(aoa, ref, "Garçons");
  for (const ref of ["G6", "J6", "M6", "R6", "X6"]) setAoaCell(aoa, ref, "Ensemble");
  for (const ref of ["N6", "T6"]) setAoaCell(aoa, ref, "Effectif filles");
  for (const ref of ["P6", "V6"]) setAoaCell(aoa, ref, "Effectif garçons");
  for (const ref of ["O6", "U6"]) setAoaCell(aoa, ref, "% filles");
  for (const ref of ["Q6", "W6"]) setAoaCell(aoa, ref, "% garçons");
  for (const ref of ["S6", "Y6"]) setAoaCell(aoa, ref, "% Ensemble");
  const rows: Record<string, number> = { "3ème": 7, "1er CYCLE": 8, "TleA1": 9, "TleA2": 10, "TleC": 11, "TleD": 12, "2nd CYCLE": 13, TOTAL: 15 };
  for (const level of OFFICIAL_DFA_EXAM_LEVELS) putDfaRow(aoa, rows[level], level === "TOTAL" ? "" : level, statsByLevel.get(level) || makeOfficialDfaStats(), institutionName, true);
  setAoaCell(aoa, "B15", "TOTAL");
  return aoa;
}

async function prepareDespsOfficialAnnualExport(params: {
  req: NextRequest;
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  institutionId: string;
  institutionName: string;
  academicYear: string;
  classId: string;
}): Promise<PreparedWorkbook | { error: string; status: number }> {
  const { req, supabase, institutionId, institutionName, academicYear, classId } = params;
  const periods = await loadAcademicPeriods({ supabase, institutionId, academicYear });
  if (!periods.length) return { error: "NO_PERIODS_FOUND", status: 404 };
  const displayPeriods = periods.slice(0, 3);
  const firstActiveDate = periods[0]?.start_date || `${academicYear.split("-")[0] || new Date().getFullYear()}-01-01`;
  const { classes, error: classError } = await loadClasses({ supabase, institutionId, academicYear, classId });
  if (classError) return { error: classError, status: classError === "INVALID_CLASS_ID" ? 400 : 500 };
  if (!classes.length) return { error: "NO_CLASSES_FOUND", status: 404 };

  const studentMetaByKey = await loadStudentMeta({ supabase, classes, academicYear, activeFrom: firstActiveDate });
  const statsByLevel = new Map<string, OfficialDfaStats>();
  const annualSubjectsByLevel = new Map<string, Map<string, OfficialSubjectStats>>();
  const ensure = (level: string) => {
    if (!statsByLevel.has(level)) statsByLevel.set(level, makeOfficialDfaStats());
    return statsByLevel.get(level)!;
  };
  const ensureAnnualSubject = (level: string, title: string) => {
    if (!annualSubjectsByLevel.has(level)) annualSubjectsByLevel.set(level, new Map<string, OfficialSubjectStats>());
    const m = annualSubjectsByLevel.get(level)!;
    if (!m.has(title)) m.set(title, makeOfficialSubjectStats());
    return m.get(title)!;
  };

  const classBulletins = await mapWithConcurrency(classes, BULLETIN_EXPORT_CONCURRENCY, async (cls) => {
    const currentClassId = String(cls.id);
    const bulletinsByPeriod = new Map<string, BulletinResponse>();
    await Promise.all(displayPeriods.map(async (period) => {
      const bulletin = await fetchBulletinForClass({
        req,
        classId: currentClassId,
        from: period.start_date,
        to: period.end_date,
      });
      if (bulletin) bulletinsByPeriod.set(period.id, bulletin);
    }));
    return { cls, currentClassId, bulletinsByPeriod };
  });

  for (const { cls, currentClassId, bulletinsByPeriod } of classBulletins) {
    const levelKey = officialLevelKey(cls);
    const studentIds = new Set<string>();
    const itemsByPeriodStudent = new Map<string, BulletinItem>();
    const subjectValuesByStudent = new Map<string, Map<string, number[]>>();
    const cycleKey = officialCycleKey(levelKey);

    const pushAnnualSubjectValue = (studentId: string, title: string, value: number | null) => {
      if (value === null || !Number.isFinite(Number(value))) return;
      if (!subjectValuesByStudent.has(studentId)) subjectValuesByStudent.set(studentId, new Map<string, number[]>());
      const bySubject = subjectValuesByStudent.get(studentId)!;
      if (!bySubject.has(title)) bySubject.set(title, []);
      bySubject.get(title)!.push(Number(value));
    };

    for (const period of displayPeriods) {
      const bulletin = bulletinsByPeriod.get(period.id);
      const { subjectNameById, componentById } = getSubjectMaps(bulletin || { ok: true, items: [], subjects: [], subject_components: [] });
      for (const item of bulletin?.items || []) {
        const studentId = String(item.student_id);
        studentIds.add(studentId);
        itemsByPeriodStudent.set(`${period.id}__${studentId}`, item);

        for (const col of OFFICIAL_SUBJECT_COLUMNS) {
          if (cycleKey === "first" && col.title === "Français (uniquement pour le 2nd cycle)") continue;
          if (cycleKey === "first" && col.title === "PHILO") continue;
          if (cycleKey === "second" && ["COMPO. FR", "ORTH/GRAM"].includes(col.title)) continue;
          const value = valueForDspsSubjectHeader({ item, subjectNameById, componentById, header: col.header, firstCycle: cycleKey === "first" });
          pushAnnualSubjectValue(studentId, col.title, value);
        }
      }
    }
    for (const [key, meta] of studentMetaByKey.entries()) if (key.startsWith(`${currentClassId}__`)) studentIds.add(meta.student_id);

    for (const studentId of studentIds) {
      const meta = studentMetaByKey.get(`${currentClassId}__${studentId}`);
      const periodCells = displayPeriods.map((period) => {
        const item = itemsByPeriodStudent.get(`${period.id}__${studentId}`) || null;
        return item && !isAdminForcedNc(item) ? cleanNumber(item.general_avg, 4) : null;
      });
      const lastItem = [...displayPeriods].reverse().map((period) => itemsByPeriodStudent.get(`${period.id}__${studentId}`) || null).find(Boolean) as BulletinItem | null;
      const annualForcedNc = isAdminAnnualForcedNc(lastItem);
      const valid = periodCells.filter((v): v is number => v !== null && Number.isFinite(Number(v)));
      const annualFromApi = !annualForcedNc ? cleanNumber(lastItem?.annual_avg, 4) : null;
      const annualAvg = annualFromApi !== null ? annualFromApi : annualForcedNc ? null : valid.length ? cleanNumber(valid.reduce((a, b) => a + b, 0) / valid.length, 4) : null;
      const gender = getStudentGender({ meta, item: lastItem });
      addOfficialDfa(ensure(levelKey), annualAvg, gender);

      const bySubject = subjectValuesByStudent.get(studentId);
      for (const col of OFFICIAL_SUBJECT_COLUMNS) {
        const values = bySubject?.get(col.title) || [];
        const avg = values.length ? cleanNumber(values.reduce((a, b) => a + b, 0) / values.length, 4) : null;
        addOfficialSubject(ensureAnnualSubject(levelKey, col.title), avg, gender);
      }
    }
  }

  const firstIntermediate = makeOfficialDfaStats();
  const secondIntermediate = makeOfficialDfaStats();
  const totalIntermediate = makeOfficialDfaStats();
  for (const level of ["6ème", "5ème", "4ème"]) mergeOfficialDfa(firstIntermediate, statsByLevel.get(level) || makeOfficialDfaStats());
  for (const level of ["2ndeA", "2ndeC", "1èreA1", "1èreA2", "1èreC", "1èreD"]) mergeOfficialDfa(secondIntermediate, statsByLevel.get(level) || makeOfficialDfaStats());
  mergeOfficialDfa(totalIntermediate, firstIntermediate);
  mergeOfficialDfa(totalIntermediate, secondIntermediate);
  statsByLevel.set("1er CYCLE", firstIntermediate);
  statsByLevel.set("2nd CYCLE", secondIntermediate);
  statsByLevel.set("TOTAL", totalIntermediate);

  const examStats = new Map<string, OfficialDfaStats>();
  for (const [level, stats] of statsByLevel.entries()) examStats.set(level, stats);
  const firstExam = makeOfficialDfaStats();
  const secondExam = makeOfficialDfaStats();
  const totalExam = makeOfficialDfaStats();
  mergeOfficialDfa(firstExam, statsByLevel.get("3ème") || makeOfficialDfaStats());
  for (const level of ["TleA1", "TleA2", "TleC", "TleD"]) mergeOfficialDfa(secondExam, statsByLevel.get(level) || makeOfficialDfaStats());
  mergeOfficialDfa(totalExam, firstExam);
  mergeOfficialDfa(totalExam, secondExam);
  examStats.set("1er CYCLE", firstExam);
  examStats.set("2nd CYCLE", secondExam);
  examStats.set("TOTAL", totalExam);

  const addAnnualSubjectTotal = (target: string, sourceLevels: string[]) => {
    for (const col of OFFICIAL_SUBJECT_COLUMNS) {
      const total = makeOfficialSubjectStats();
      for (const level of sourceLevels) {
        const stats = annualSubjectsByLevel.get(level)?.get(col.title);
        if (!stats) continue;
        total.classedGirls += stats.classedGirls;
        total.classedBoys += stats.classedBoys;
        total.lt10Girls += stats.lt10Girls;
        total.lt10Boys += stats.lt10Boys;
      }
      const targetStats = ensureAnnualSubject(target, col.title);
      targetStats.classedGirls = total.classedGirls;
      targetStats.classedBoys = total.classedBoys;
      targetStats.lt10Girls = total.lt10Girls;
      targetStats.lt10Boys = total.lt10Boys;
    }
  };
  addAnnualSubjectTotal("1er CYCLE", ["6ème", "5ème", "4ème", "3ème"]);
  addAnnualSubjectTotal("2nd CYCLE", ["2ndeA", "2ndeC", "1èreA1", "1èreA2", "1èreC", "1èreD", "TleA1", "TleA2", "TleC", "TleD"]);

  return {
    templateFileName: "resultats_annuels_dfa.xlsx",
    outputExtension: "xlsx",
    filenameBase: ["etablissement-resultats-annuels-dfa", toFileSafePart(institutionName || "etablissement"), toFileSafePart(academicYear || "annee")].join("_"),
    mainSheetName: "Classes intermédiaires",
    rows: [],
    sheets: [
      { sheetName: "Classes intermédiaires", aoa: buildDfaIntermediateSheet(academicYear, institutionName, statsByLevel), cols: Array.from({ length: 31 }, (_, i) => ({ wch: i < 4 ? 18 : 12 })) },
      { sheetName: "Classes d'examen", aoa: buildDfaExamSheet(academicYear, institutionName, examStats), cols: Array.from({ length: 25 }, (_, i) => ({ wch: i < 4 ? 18 : 12 })) },
      {
        sheetName: "Moy par discipline au général",
        aoa: buildOfficialAnnualSubjectSheet(annualSubjectsByLevel),
        cols: Array.from({ length: 35 }, (_, i) => ({ wch: i === 0 ? 14 : i === 1 ? 12 : 11 })),
        merges: [{ s: { r: 1, c: 0 }, e: { r: 1, c: 34 } }],
      },
    ],
  };
}

function rapportBaseHeaders() {
  return [
    "N°",
    "MATRICULE",
    "NOM PRENOMS",
    "DATE DE NAISSANCE",
    "JOUR",
    "MOIS",
    "ANNEE DE NAISSANCE",
    "AGE",
    "CLASSE",
    "N° DE LA CLASSE",
    "CONTACTS PARENTS",
    "NATIONALITE ",
    "GENRE",
    "REDOUBLANTS",
    "LANGUE VIVANTE 2",
    "MOY. 1er TRI",
    "MOY. 2ème TRI",
    "MOY. 3ème TRI",
    "DFA",
  ];
}

type RapportFSettings = {
  drenaet: string;
  ddenaet: string;
  locality: string;
  report_author_name: string;
  report_author_phone: string;
  report_author_role: string;
  report_author_email: string;
  administrative_observation: string;
  opening_meeting_participants_count: string;
  up_count: string;
  up_functional_count: string;
  up_difficulties: string;
  teaching_council_count: string;
  class_visit_planned_count: string;
  class_visit_done_count: string;
  class_visit_difficulties: string;
  major_discipline_cases: string;
  disciplinary_measures: string;
  internal_council_held: string;
  sports_activities: string;
  cultural_activities: string;
  school_clubs: string;
  extracurricular_activities_done: string;
  term1_up_comment: string;
  term2_up_comment: string;
  term3_up_comment: string;
  term1_teaching_council_comment: string;
  term2_teaching_council_comment: string;
  term3_teaching_council_comment: string;
  term1_class_visit_comment: string;
  term2_class_visit_comment: string;
  term3_class_visit_comment: string;
  term1_discipline_comment: string;
  term2_discipline_comment: string;
  term3_discipline_comment: string;
  term1_internal_council_comment: string;
  term2_internal_council_comment: string;
  term3_internal_council_comment: string;
  term1_extracurricular_comment: string;
  term2_extracurricular_comment: string;
  term3_extracurricular_comment: string;
  term1_general_observation: string;
  term2_general_observation: string;
  term3_general_observation: string;
  opening_meeting_date: string;
  opening_meeting_organizer: string;
  opening_meeting_location: string;
  opening_meeting_observation: string;
  textbook_exists: string;
  gradebook_exists: string;
  attendance_register_exists: string;
  pedagogical_documents_observation: string;
  pedagogical_documents_comment: string;
  up_comment: string;
  teaching_council_comment: string;
  class_visit_comment: string;
  discipline_comment: string;
  internal_council_comment: string;
  extracurricular_comment: string;
  general_observation: string;
};

const DEFAULT_RAPPORT_F_SETTINGS: RapportFSettings = {
  drenaet: "",
  ddenaet: "",
  locality: "",
  report_author_name: "",
  report_author_phone: "",
  report_author_role: "",
  report_author_email: "",
  administrative_observation: "",
  opening_meeting_participants_count: "",
  up_count: "",
  up_functional_count: "",
  up_difficulties: "",
  teaching_council_count: "",
  class_visit_planned_count: "",
  class_visit_done_count: "",
  class_visit_difficulties: "",
  major_discipline_cases: "",
  disciplinary_measures: "",
  internal_council_held: "",
  sports_activities: "",
  cultural_activities: "",
  school_clubs: "",
  extracurricular_activities_done: "",
  term1_up_comment: "",
  term2_up_comment: "",
  term3_up_comment: "",
  term1_teaching_council_comment: "",
  term2_teaching_council_comment: "",
  term3_teaching_council_comment: "",
  term1_class_visit_comment: "",
  term2_class_visit_comment: "",
  term3_class_visit_comment: "",
  term1_discipline_comment: "",
  term2_discipline_comment: "",
  term3_discipline_comment: "",
  term1_internal_council_comment: "",
  term2_internal_council_comment: "",
  term3_internal_council_comment: "",
  term1_extracurricular_comment: "",
  term2_extracurricular_comment: "",
  term3_extracurricular_comment: "",
  term1_general_observation: "",
  term2_general_observation: "",
  term3_general_observation: "",
  opening_meeting_date: "",
  opening_meeting_organizer: "",
  opening_meeting_location: "",
  opening_meeting_observation: "",
  textbook_exists: "OUI",
  gradebook_exists: "OUI",
  attendance_register_exists: "OUI",
  pedagogical_documents_observation: "Bien",
  pedagogical_documents_comment: "",
  up_comment: "",
  teaching_council_comment: "",
  class_visit_comment: "",
  discipline_comment: "",
  internal_council_comment: "",
  extracurricular_comment: "",
  general_observation: "",
};

function normalizeRapportFSettings(value: unknown): RapportFSettings {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out: RapportFSettings = { ...DEFAULT_RAPPORT_F_SETTINGS };

  for (const key of Object.keys(DEFAULT_RAPPORT_F_SETTINGS) as (keyof RapportFSettings)[]) {
    const raw = source[key];
    if (typeof raw === "string") out[key] = raw;
    else if (raw !== null && raw !== undefined) out[key] = String(raw);
  }

  return out;
}

async function loadRapportFSettings(params: {
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  institutionId: string;
  academicYear: string;
}): Promise<RapportFSettings> {
  const { supabase, institutionId, academicYear } = params;

  const { data } = await supabase
    .from("institutions")
    .select("settings_json")
    .eq("id", institutionId)
    .maybeSingle();

  const settingsJson = (data as any)?.settings_json;
  const byYear =
    settingsJson &&
    typeof settingsJson === "object" &&
    !Array.isArray(settingsJson) &&
    settingsJson.rapport_f_by_year &&
    typeof settingsJson.rapport_f_by_year === "object" &&
    !Array.isArray(settingsJson.rapport_f_by_year)
      ? settingsJson.rapport_f_by_year
      : {};

  return normalizeRapportFSettings((byYear as Record<string, unknown>)[academicYear]);
}

function cleanRapportValue(value: unknown): string {
  return String(value ?? "").trim();
}

function rapportYesNo(value: string): string {
  const raw = normalizeForMatch(value);
  if (!raw) return "";
  return raw === "non" || raw === "no" || raw === "0" || raw === "false" ? "NON" : "OUI";
}

function makeSparseAoa(rows: number, cols: number) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => undefined as unknown));
}

function setSparseAoaCell(aoa: unknown[][], ref: string, value: unknown) {
  if (value === undefined || value === null) return;
  const cleaned = typeof value === "string" ? value.trim() : value;
  if (cleaned === "") return;
  const { r, c } = cellRefToIndexes(ref);
  while (aoa.length <= r) aoa.push([]);
  while (aoa[r].length <= c) aoa[r].push(undefined as unknown);
  aoa[r][c] = cleaned;
}

function buildRapportFManualSheets(settings: RapportFSettings, institutionName: string): PreparedSheet[] {
  const meetingDate = formatDateFr(settings.opening_meeting_date) || settings.opening_meeting_date;
  const sheets: PreparedSheet[] = [];

  const buildSheet = (sheetName: string, term: 1 | 2 | 3): PreparedSheet => {
    const aoa = makeSparseAoa(140, 8);
    const docRow = term === 1 ? 15 : 13;
    const docCommentRow = term === 1 ? 18 : 16;
    const upCommentRow = term === 1 ? 130 : term === 2 ? 76 : 77;
    const ceCommentRow = term === 1 ? 168 : term === 2 ? 122 : 136;

    if (term === 1) {
      setSparseAoaCell(aoa, "B9", institutionName);
      setSparseAoaCell(aoa, "C9", meetingDate);
      setSparseAoaCell(aoa, "D9", settings.opening_meeting_organizer);
      setSparseAoaCell(aoa, "E9", settings.opening_meeting_location);
      setSparseAoaCell(aoa, "F9", settings.opening_meeting_observation);
    } else {
      setSparseAoaCell(aoa, `B${docRow}`, institutionName);
    }

    setSparseAoaCell(aoa, `C${docRow}`, rapportYesNo(settings.textbook_exists));
    setSparseAoaCell(aoa, `D${docRow}`, rapportYesNo(settings.gradebook_exists));
    setSparseAoaCell(aoa, `E${docRow}`, rapportYesNo(settings.attendance_register_exists));
    setSparseAoaCell(aoa, `F${docRow}`, settings.pedagogical_documents_observation);
    setSparseAoaCell(aoa, `B${docCommentRow}`, settings.pedagogical_documents_comment);
    setSparseAoaCell(aoa, `B${upCommentRow}`, settings.up_comment);
    setSparseAoaCell(aoa, `B${ceCommentRow}`, settings.teaching_council_comment);

    return { sheetName, aoa };
  };

  sheets.push(buildSheet("PREMIER TRIMES.", 1));
  sheets.push(buildSheet("DEUXIEME TRIMES.", 2));
  sheets.push(buildSheet("TROISIEME TRI et BILAN", 3));

  return sheets;
}

async function prepareRapportFOfficialExport(params: {
  req: NextRequest;
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  institutionId: string;
  institutionName: string;
  academicYear: string;
  classId: string;
}): Promise<PreparedWorkbook | { error: string; status: number }> {
  const { req, supabase, institutionId, institutionName, academicYear, classId } = params;
  const periods = await loadAcademicPeriods({ supabase, institutionId, academicYear });
  const displayPeriods = periods.slice(0, 3);
  const firstActiveDate = periods[0]?.start_date || `${academicYear.split("-")[0] || new Date().getFullYear()}-01-01`;
  const { classes, error: classError } = await loadClasses({ supabase, institutionId, academicYear, classId });
  if (classError) return { error: classError, status: classError === "INVALID_CLASS_ID" ? 400 : 500 };
  if (!classes.length) return { error: "NO_CLASSES_FOUND", status: 404 };
  const studentMetaByKey = await loadStudentMeta({ supabase, classes, academicYear, activeFrom: firstActiveDate });
  const rapportFSettings = await loadRapportFSettings({ supabase, institutionId, academicYear });
  const rapportDrena = cleanRapportValue(rapportFSettings.drenaet || rapportFSettings.ddenaet);

  const rows: unknown[][] = [["MODELE D'ECRITURE DES CLASSES", "", "", "6è", "5è", "2NDE", "1ERE", "TA"], ["", "", "", "4è", "3è", "2NDEA", "1EREA", "TC"], ["MODELE D'ECRITURE DU GENRE(Garçon / Fille)", "", "", "G", "F", "2NDEC", "1EREC", "TD"], [], rapportBaseHeaders()];

  let line = 1;
  for (const cls of classes) {
    const currentClassId = String(cls.id);
    const bulletinsByPeriod = new Map<string, BulletinResponse>();
    await Promise.all(displayPeriods.map(async (period) => {
      const bulletin = await fetchBulletinForClass({ req, classId: currentClassId, from: period.start_date, to: period.end_date });
      if (bulletin) bulletinsByPeriod.set(period.id, bulletin);
    }));

    const studentIds = new Set<string>();
    const itemsByPeriodStudent = new Map<string, BulletinItem>();
    for (const period of displayPeriods) {
      const bulletin = bulletinsByPeriod.get(period.id);
      for (const item of bulletin?.items || []) {
        studentIds.add(String(item.student_id));
        itemsByPeriodStudent.set(`${period.id}__${String(item.student_id)}`, item);
      }
    }
    for (const [key, meta] of studentMetaByKey.entries()) if (key.startsWith(`${currentClassId}__`)) studentIds.add(meta.student_id);

    const sorted = [...studentIds].sort((a, b) => {
      const ma = studentMetaByKey.get(`${currentClassId}__${a}`);
      const mb = studentMetaByKey.get(`${currentClassId}__${b}`);
      return String(`${ma?.last_name || ""} ${ma?.first_name || ""}`.trim() || ma?.full_name || "").localeCompare(String(`${mb?.last_name || ""} ${mb?.first_name || ""}`.trim() || mb?.full_name || ""), "fr", { sensitivity: "base", numeric: true });
    });

    for (const studentId of sorted) {
      const meta = studentMetaByKey.get(`${currentClassId}__${studentId}`);
      const avgs = displayPeriods.map((period) => {
        const item = itemsByPeriodStudent.get(`${period.id}__${studentId}`) || null;
        return item && !isAdminForcedNc(item) ? cleanNumber(item.general_avg, 2) : null;
      });
      const valid = avgs.filter((v): v is number => v !== null && Number.isFinite(Number(v)));
      const annualAverage = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
      const dfa = annualAverage === null ? "" : annualAverage >= 10 ? "Admis" : "Redouble";
      const birthdate = getStudentBirthdate(meta, [...displayPeriods].reverse().map((period) => itemsByPeriodStudent.get(`${period.id}__${studentId}`) || null).find(Boolean) || null);
      const referenceItem = [...displayPeriods].reverse().map((period) => itemsByPeriodStudent.get(`${period.id}__${studentId}`) || null).find(Boolean) || null;
      rows.push([
        line,
        meta?.matricule || "",
        String(`${meta?.last_name || ""} ${meta?.first_name || ""}`.trim() || meta?.full_name || "").trim(),
        formatDateFr(birthdate),
        datePart(birthdate, "day"),
        datePart(birthdate, "month"),
        datePart(birthdate, "year"),
        ageAtAcademicYear(birthdate, academicYear),
        officialRapportClassCode(cls),
        "",
        "",
        getStudentNationality(meta, referenceItem),
        getRapportGender({ meta, item: referenceItem }),
        getStudentRepeater(meta, referenceItem),
        "",
        avgs[0] ?? "",
        avgs[1] ?? "",
        avgs[2] ?? "",
        dfa,
      ]);
      line += 1;
    }
  }

  return {
    templateFileName: "rapport_f.xlsm",
    outputExtension: "xlsm",
    filenameBase: ["rapport-f", toFileSafePart(institutionName || "etablissement"), toFileSafePart(academicYear || "annee")].join("_"),
    mainSheetName: "BASE DE DONNEES",
    rows: [],
    sheets: [
      ...buildRapportFManualSheets(rapportFSettings, institutionName),
      {
        sheetName: "ETABLISSEMENTS",
        aoa: [
          ["F_26-40_R_0", "SAISIR LA LISTE DE VOS ETABLISSEMENTS", "", "CLIQUEZ POUR CHOISIR LE NOM DE LA DRENA ET DE L'ANNEE SCOLAIRE DANS LES  CELLULES  CI-DESSOUS."],
          ["N°", "ETABLISSEMENT", "CHOIX_DRENA :", rapportDrena],
          [1, institutionName, "CHOIX_ANNEE SCOLAIRE :", academicYear],
        ],
        clearRanges: ["A4:B369"],
        cols: [{ wch: 12 }, { wch: 42 }, { wch: 22 }, { wch: 22 }],
      },
      {
        sheetName: "BASE DE DONNEES",
        aoa: rows,
        clearRanges: ["A6:S10005"],
        cols: rapportBaseHeaders().map((h) => ({ wch: h.length < 8 ? 10 : Math.min(Math.max(h.length + 2, 14), 28) })),
      },
    ],
  };
}


const DESPS_TEMPLATE_DIR = path.join(process.cwd(), "src", "templates", "desps");

function despsTemplatePath(fileName: string) {
  return path.join(DESPS_TEMPLATE_DIR, fileName);
}

function inferCellType(value: unknown): "s" | "n" | "b" | "d" | "z" {
  if (value === null || value === undefined || value === "") return "z";
  if (typeof value === "number") return "n";
  if (typeof value === "boolean") return "b";
  if (value instanceof Date) return "d";
  return "s";
}

function setWorksheetCell(XLSX: any, ws: any, rowIndex0: number, colIndex0: number, value: unknown) {
  const ref = XLSX.utils.encode_cell({ r: rowIndex0, c: colIndex0 });
  const previous = ws[ref] || {};
  const cellValue = isExcelCellValue(value) ? value.value : value;
  const forcedNumFmt = isExcelCellValue(value) ? value.numFmt : undefined;

  if (cellValue === null || cellValue === undefined || cellValue === "") {
    if (previous && Object.keys(previous).length) {
      delete previous.f;
      delete previous.v;
      delete previous.w;
      previous.t = "z";
      ws[ref] = previous;
    }
    return;
  }

  ws[ref] = {
    ...previous,
    t: inferCellType(cellValue),
    v: cellValue,
  };

  // Les modèles DESPS contiennent des formules et parfois un format % sur des cellules d'effectifs.
  // Ici, Mon Cahier écrit les résultats calculés directement pour éviter les anciens caches Excel.
  delete ws[ref].f;
  delete ws[ref].w;

  if (forcedNumFmt) {
    ws[ref].z = forcedNumFmt;
  } else if (typeof cellValue === "number" && String(previous?.z || "").includes("%")) {
    ws[ref].z = "0";
  }
}

function clearWorksheetRange(XLSX: any, ws: any, rangeRef: string) {
  const range = XLSX.utils.decode_range(rangeRef);
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const previous = ws[ref];
      if (!previous) continue;
      delete previous.f;
      delete previous.v;
      delete previous.w;
      previous.t = "z";
      ws[ref] = previous;
    }
  }
}

function applyAoaToTemplateSheet(XLSX: any, ws: any, sheet: PreparedSheet) {
  for (const rangeRef of sheet.clearRanges || []) {
    clearWorksheetRange(XLSX, ws, rangeRef);
  }

  for (let r = 0; r < sheet.aoa.length; r += 1) {
    const row = sheet.aoa[r] || [];
    for (let c = 0; c < row.length; c += 1) {
      const value = row[c];
      if (value === undefined) continue;
      setWorksheetCell(XLSX, ws, r, c, value);
    }
  }
}

async function sendTemplateWorkbook(prepared: PreparedWorkbook) {
  try {
    const XLSX = await import("xlsx");
    const templateBuffer = await fs.readFile(despsTemplatePath(prepared.templateFileName!));
    const workbook = XLSX.read(templateBuffer, {
      type: "buffer",
      cellStyles: true,
      cellNF: true,
      cellDates: true,
      bookVBA: prepared.outputExtension === "xlsm",
    });

    for (const sheet of prepared.sheets || []) {
      let ws = workbook.Sheets[sheet.sheetName];
      if (!ws) {
        ws = XLSX.utils.aoa_to_sheet([]);
        workbook.Sheets[sheet.sheetName] = ws;
        workbook.SheetNames.push(sheet.sheetName);
      }
      applyAoaToTemplateSheet(XLSX, ws, sheet);
    }

    workbook.Workbook = workbook.Workbook || {};
    (workbook.Workbook as any).CalcPr = { fullCalcOnLoad: true, forceFullCalc: true, calcMode: "auto" };

    const extension = prepared.outputExtension || "xlsx";
    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: extension,
      bookVBA: extension === "xlsm",
      cellStyles: true,
    }) as Buffer;

    const fileBytes = Uint8Array.from(buffer);
    const fileArrayBuffer = new ArrayBuffer(fileBytes.byteLength);
    new Uint8Array(fileArrayBuffer).set(fileBytes);

    return new Response(fileArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          extension === "xlsm"
            ? "application/vnd.ms-excel.sheet.macroEnabled.12"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${prepared.filenameBase}.${extension}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "DESPS_TEMPLATE_EXPORT_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de charger ou de remplir le modèle officiel DESPS.",
      },
      { status: 500 }
    );
  }
}


function columnWidthForHeader(header: string): number {
  if (header === "N°") return 6;
  if (header.toLowerCase().includes("matricule")) return 18;
  if (header === "Nom") return 28;
  if (header === "Prénoms") return 24;
  if (header === "Décision du conseil") return 24;
  if (header === "Série") return 10;
  if (header === "Niveau") return 14;
  if (header.length <= 5) return 10;
  if (header.length <= 10) return 12;
  return Math.min(Math.max(header.length + 2, 14), 28);
}

async function sendPreparedWorkbook(prepared: PreparedWorkbook, format: ExportFormat) {
  const extension = prepared.outputExtension || format;
  const filename = `${prepared.filenameBase}.${extension}`;

  if (format === "csv") {
    const csv = prepared.sheets?.length
      ? buildCsvFromAoa(prepared.sheets[0].aoa)
      : buildCsv(prepared.rows);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (prepared.templateFileName) {
    return sendTemplateWorkbook(prepared);
  }

  try {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();

    const appendSheet = (sheetName: string, rows: Record<string, unknown>[]) => {
      const headers = rows.length ? Object.keys(rows[0]) : [];
      const aoa = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = headers.map((header) => ({ wch: columnWidthForHeader(header) }));

      const baseName = safeSheetName(sheetName);
      let finalName = baseName;
      let suffix = 2;
      while (workbook.SheetNames.includes(finalName)) {
        const tail = ` (${suffix})`;
        finalName = `${baseName.slice(0, 31 - tail.length)}${tail}`;
        suffix += 1;
      }

      XLSX.utils.book_append_sheet(workbook, ws, finalName);
    };

    const appendAoaSheet = (sheet: PreparedSheet) => {
      const ws = XLSX.utils.aoa_to_sheet(sheet.aoa);
      if (sheet.cols?.length) ws["!cols"] = sheet.cols;
      if (sheet.merges?.length) ws["!merges"] = sheet.merges;

      const baseName = safeSheetName(sheet.sheetName);
      let finalName = baseName;
      let suffix = 2;
      while (workbook.SheetNames.includes(finalName)) {
        const tail = ` (${suffix})`;
        finalName = `${baseName.slice(0, 31 - tail.length)}${tail}`;
        suffix += 1;
      }

      XLSX.utils.book_append_sheet(workbook, ws, finalName);
    };

    if (prepared.sheets?.length) {
      for (const sheet of prepared.sheets) appendAoaSheet(sheet);
    } else {
      appendSheet(prepared.mainSheetName, prepared.rows);

      for (const sheet of prepared.classSheets || []) {
        if (!sheet.rows.length) continue;
        appendSheet(sheet.sheetName, sheet.rows);
      }
    }

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer;

    const fileBytes = Uint8Array.from(buffer);
    const fileArrayBuffer = new ArrayBuffer(fileBytes.byteLength);
    new Uint8Array(fileArrayBuffer).set(fileBytes);

    return new Response(fileArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "XLSX_LIBRARY_MISSING",
        message: "Installe le package xlsx pour activer l’export Excel : npm i xlsx",
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const ctx = await getAdminAndInstitution();

  if ("error" in ctx) {
    const status =
      ctx.error === "UNAUTHENTICATED" ? 401 : ctx.error === "FORBIDDEN" ? 403 : 400;

    return NextResponse.json({ ok: false, error: ctx.error }, { status });
  }

  const { supabase, institutionId } = ctx;
  const { searchParams } = new URL(req.url);

  const academicYear = String(searchParams.get("academic_year") || "").trim();
  const periodRef = String(searchParams.get("period_ref") || "").trim();
  const classId = String(searchParams.get("class_id") || "").trim();

  const includeSubjects = ["1", "true", "yes", "on"].includes(
    String(searchParams.get("include_subjects") || "").toLowerCase()
  );

  const format = String(searchParams.get("format") || "xlsx")
    .trim()
    .toLowerCase() as ExportFormat;

  const exportKind = String(searchParams.get("export_kind") || searchParams.get("mode") || "legacy")
    .trim()
    .toLowerCase() as ExportKind;

  if (!academicYear) {
    return NextResponse.json({ ok: false, error: "MISSING_ACADEMIC_YEAR" }, { status: 400 });
  }

  if (!periodRef && !["dsps_annual", "desps_dfa_summary", "desps_official_annual", "rapport_f_official"].includes(exportKind)) {
    return NextResponse.json({ ok: false, error: "MISSING_PERIOD_REF" }, { status: 400 });
  }

  if (!["xlsx", "csv"].includes(format)) {
    return NextResponse.json({ ok: false, error: "INVALID_FORMAT" }, { status: 400 });
  }

  if (
    ![
      "legacy",
      "dsps_notes",
      "dsps_annual",
      "desps_term_summary",
      "desps_subject_summary",
      "desps_dfa_summary",
      "desps_official_term",
      "desps_official_annual",
      "rapport_f_official",
    ].includes(exportKind)
  ) {
    return NextResponse.json({ ok: false, error: "INVALID_EXPORT_KIND" }, { status: 400 });
  }

  const { data: institution } = await supabase
    .from("institutions")
    .select("name")
    .eq("id", institutionId)
    .maybeSingle();

  const institutionName = String((institution as any)?.name || "Établissement");

  let prepared: PreparedWorkbook | { error: string; status: number };

  if (exportKind === "dsps_notes") {
    prepared = await prepareDspsNotesExport({
      req,
      supabase,
      institutionId,
      institutionName,
      academicYear,
      periodRef,
      classId,
    });
  } else if (exportKind === "dsps_annual") {
    prepared = await prepareDspsAnnualExport({
      req,
      supabase,
      institutionId,
      institutionName,
      academicYear,
      classId,
    });
  } else if (exportKind === "desps_term_summary") {
    prepared = await prepareDespsTermSummaryExport({
      req,
      supabase,
      institutionId,
      institutionName,
      academicYear,
      periodRef,
      classId,
    });
  } else if (exportKind === "desps_subject_summary") {
    prepared = await prepareDespsSubjectSummaryExport({
      req,
      supabase,
      institutionId,
      institutionName,
      academicYear,
      periodRef,
      classId,
    });
  } else if (exportKind === "desps_dfa_summary") {
    prepared = await prepareDespsDfaSummaryExport({
      req,
      supabase,
      institutionId,
      institutionName,
      academicYear,
      classId,
    });
  } else if (exportKind === "desps_official_term") {
    const rawTerm = Number(searchParams.get("term") || "1");
    const term = rawTerm === 2 ? 2 : rawTerm === 3 ? 3 : 1;
    prepared = await prepareDespsOfficialTermExport({
      req,
      supabase,
      institutionId,
      institutionName,
      academicYear,
      periodRef,
      classId,
      term,
    });
  } else if (exportKind === "desps_official_annual") {
    prepared = await prepareDespsOfficialAnnualExport({
      req,
      supabase,
      institutionId,
      institutionName,
      academicYear,
      classId,
    });
  } else if (exportKind === "rapport_f_official") {
    prepared = await prepareRapportFOfficialExport({
      req,
      supabase,
      institutionId,
      institutionName,
      academicYear,
      classId,
    });
  } else {
    prepared = await prepareLegacyExport({
      req,
      supabase,
      institutionId,
      institutionName,
      academicYear,
      periodRef,
      classId,
      includeSubjects,
    });
  }

  if ("error" in prepared) {
    return NextResponse.json({ ok: false, error: prepared.error }, { status: prepared.status });
  }

  return sendPreparedWorkbook(prepared, format);
}
