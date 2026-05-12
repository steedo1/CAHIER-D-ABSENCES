// src/app/api/admin/exports/averages/route.ts
import { NextRequest, NextResponse } from "next/server";
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
  academic_year?: string | null;
  institution_id?: string | null;
};

type StudentMetaRow = {
  student_id: string;
  class_id: string;
  class_label: string;
  class_level: string | null;
  academic_year: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  matricule: string | null;
  gender?: string | null;
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
  | "desps_dfa_summary";

type ResolvedPeriod = {
  academicYear: string;
  requestedKind: "period" | "annual";
  requestedLabel: string;
  requestedCode: string;
  bulletinFrom: string;
  bulletinTo: string;
  bulletinPeriod: GradePeriodRow;
};

type PreparedWorkbook = {
  filenameBase: string;
  mainSheetName: string;
  rows: Record<string, unknown>[];
  classSheets?: { sheetName: string; rows: Record<string, unknown>[] }[];
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

function classCycleLabel(cls: ClassRow): string {
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
    .select("id, label, code, level, academic_year, institution_id")
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
        gender
      )
    `
    )
    .in("class_id", targetClassIds)
    .or(`end_date.gte.${activeFrom},end_date.is.null`)
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
      academic_year: cls.academic_year ?? academicYear,
      first_name: student.first_name ?? null,
      last_name: student.last_name ?? null,
      full_name: student.full_name ?? null,
      matricule: student.matricule ?? null,
      gender: student.gender ?? null,
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

  const cookie = params.req.headers.get("cookie") ?? "";

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: cookie ? { cookie } : {},
      cache: "no-store",
    });

    if (!res.ok) return null;

    const data = (await res.json().catch(() => null)) as BulletinResponse | null;
    if (!data?.ok) return null;

    return data;
  } catch {
    return null;
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
  const filename = `${prepared.filenameBase}.${format}`;

  if (format === "csv") {
    const csv = buildCsv(prepared.rows);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
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

    appendSheet(prepared.mainSheetName, prepared.rows);

    for (const sheet of prepared.classSheets || []) {
      if (!sheet.rows.length) continue;
      appendSheet(sheet.sheetName, sheet.rows);
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

  if (!periodRef && !["dsps_annual", "desps_dfa_summary"].includes(exportKind)) {
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
