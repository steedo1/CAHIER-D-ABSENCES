// src/app/api/public/bulletins/verify/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { verifyBulletinQR } from "@/lib/bulletin-qr";
import { resolveBulletinByCode } from "@/lib/bulletin-qr-store";
import {
  resolveBulletinEducationContext,
  resolveScopedInstitutionSettings,
} from "@/lib/education-bulletins";
import { listApplicableGradePeriods } from "@/lib/education-grading-periods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────── Helpers numériques ───────── */

function cleanNumber(x: any, precision: number = 2): number | null {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(precision));
}

function cleanCoeff(c: any): number {
  const n = Number(c);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Number(n.toFixed(2));
}

function clampAverage20(value: any): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(20, n));
}

function isUuid(v: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    v,
  );
}

function normalizeBulletinLevel(level?: string | null): string | null {
  if (!level) return null;
  const x = String(level).trim().toLowerCase();

  if (
    ["6e", "5e", "4e", "3e", "seconde", "première", "terminale"].includes(x)
  ) {
    return x;
  }
  if (x === "premiere") return "première";

  if (x.startsWith("2de") || x.startsWith("2nde") || x.startsWith("2"))
    return "seconde";
  if (x.startsWith("1re") || x.startsWith("1ere") || x.startsWith("1"))
    return "première";
  if (x.startsWith("t")) return "terminale";

  return null;
}
function normalizeAsciiToken(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

type InstitutionMeta = {
  id: string;
  name?: string | null;
  code?: string | null;
  code_unique?: string | null;
  acronym?: string | null;
  logo_url?: string | null;
  settings_json?: any;
};

const CSCA_INSTITUTION_IDS = new Set(["ee34ab2a-8033-4e0b-acf0-05979cce1697"]);

function isCSCAInstitution(meta: InstitutionMeta | null | undefined): boolean {
  if (!meta) return false;
  const id = String(meta.id || "").trim();
  if (CSCA_INSTITUTION_IDS.has(id)) return true;

  const name = normalizeAsciiToken(meta.name);
  const code = normalizeAsciiToken(meta.code_unique || meta.code);
  const acronym = normalizeAsciiToken(meta.acronym);
  const all = `${name} ${code} ${acronym}`;

  return (
    acronym === "csca" ||
    code === "csca" ||
    all.includes("csca") ||
    (name.includes("courssecondairecatholique") && name.includes("aboisso"))
  );
}

function isCSCALatinOrReligionLabel(value?: string | null): boolean {
  const key = normalizeAsciiToken(value);
  if (!key) return false;
  return (
    key.includes("latin") ||
    key.includes("religion") ||
    key.includes("religieux") ||
    key === "reg" ||
    key === "rel"
  );
}

function isCSCALatinOrReligionSubjectMeta(
  subject: SubjectRow | null | undefined,
): boolean {
  return isCSCALatinOrReligionLabel(
    `${subject?.code ?? ""} ${subject?.name ?? ""}`,
  );
}

function isCSCAConductLabel(value?: string | null): boolean {
  const key = normalizeAsciiToken(value);
  return (
    key.includes("discipline") ||
    key.includes("conduite") ||
    key.includes("conduct")
  );
}

function safePublicLogoUrl(value?: string | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  // La vérification publique QR doit rester légère : ne jamais renvoyer
  // de logo encodé en base64 (data:image...) ni une valeur énorme.
  // Le logo reste intact en base et continue d'être utilisé ailleurs.
  const lower = raw.toLowerCase();
  if (lower.startsWith("data:image/")) return null;
  if (raw.length > 5000) return null;

  // Par sécurité, l’API publique n’expose que des URLs réelles.
  if (!/^https?:\/\//i.test(raw)) return null;

  return raw;
}

function normalizeCoeffLevelKey(level?: string | null): string | null {
  const x = normalizeAsciiToken(level);
  if (!x) return null;

  if (/^(6|6e|6eme|sixieme)$/.test(x)) return "6eme";
  if (/^(5|5e|5eme|cinquieme)$/.test(x)) return "5eme";
  if (/^(4|4e|4eme|quatrieme)$/.test(x)) return "4eme";
  if (/^(3|3e|3eme|troisieme)$/.test(x)) return "3eme";

  if (/^(2ndea|2dea|secondea|2a|2a[0-9]+)$/.test(x)) return "2ndeA";
  if (/^(2ndec|2dec|secondec|2c|2c[0-9]+)$/.test(x)) return "2ndeC";
  if (/^(2nde|2de|seconde)$/.test(x)) return "seconde";

  if (/^(1erea1|premierea1|1rea1|1a1)$/.test(x)) return "1ereA1";
  if (/^(1erea2|premierea2|1rea2|1a2|1a|1a[0-9]+)$/.test(x)) return "1ereA2";
  if (/^(1erec|premierec|1rec|1c|1c[0-9]+)$/.test(x)) return "1ereC";
  if (/^(1ered|premiered|1red|1d|1d[0-9]+)$/.test(x)) return "1ereD";
  if (/^(1ere|1re|premiere)$/.test(x)) return "première";

  if (/^(tlea1|terminalea1|ta1)$/.test(x)) return "tleA1";
  if (/^(tlea2|terminalea2|ta2|tlea|terminalea|ta|ta[0-9]+)$/.test(x))
    return "tleA2";
  if (/^(tlec|terminalec|tc|tc[0-9]+)$/.test(x)) return "tleC";
  if (/^(tled|terminaled|td|td[0-9]+)$/.test(x)) return "tleD";
  if (/^(tle|terminal|terminale)$/.test(x)) return "terminale";

  return x;
}

function normalizeStoredLevel(level?: string | null): string | null {
  const specific = normalizeCoeffLevelKey(level);
  if (specific) return specific;

  const n = normalizeBulletinLevel(level);
  if (n) return n;

  const raw = String(level ?? "")
    .trim()
    .toLowerCase();
  return raw || null;
}

function pushUniqueLevelCandidate(list: string[], value?: string | null) {
  const key = normalizeCoeffLevelKey(value);
  if (key && !list.includes(key)) list.push(key);
}

const STRICT_OFFICIAL_COEFF_LEVELS = new Set([
  "1ereA1",
  "1ereA2",
  "tleA1",
  "tleA2",
]);

function buildCoeffLevelCandidates(
  classRow: ClassRow,
  bulletinLevel: string | null,
): string[] {
  const out: string[] = [];
  const official = normalizeCoeffLevelKey(classRow.official_track_code);

  if (official) {
    out.push(official);
    if (STRICT_OFFICIAL_COEFF_LEVELS.has(official)) return out;

    pushUniqueLevelCandidate(out, classRow.level);
    pushUniqueLevelCandidate(out, classRow.code);
    pushUniqueLevelCandidate(out, classRow.label);
    pushUniqueLevelCandidate(out, bulletinLevel);
    if (bulletinLevel && !out.includes(bulletinLevel)) out.push(bulletinLevel);
    return out;
  }

  pushUniqueLevelCandidate(out, classRow.formation_level_code);
  pushUniqueLevelCandidate(out, classRow.level);
  pushUniqueLevelCandidate(out, classRow.code);
  pushUniqueLevelCandidate(out, classRow.label);
  pushUniqueLevelCandidate(out, bulletinLevel);
  if (bulletinLevel && !out.includes(bulletinLevel)) out.push(bulletinLevel);
  return out;
}

function allowSubjectComponentsForBulletinLevel(
  level?: string | null,
): boolean {
  const n = normalizeBulletinLevel(level);
  return n === "6e" || n === "5e" || n === "4e" || n === "3e";
}

function pickBestCoeffRow(
  rows: SubjectCoeffRow[],
  wantedLevels: Array<string | null | undefined>,
): SubjectCoeffRow | null {
  if (!rows.length) return null;

  const wanted = wantedLevels
    .map((level) => normalizeStoredLevel(level))
    .filter((level): level is string => Boolean(level));

  for (const key of wanted) {
    const exact = rows.find((r) => normalizeStoredLevel(r.level) === key);
    if (exact) return exact;
  }

  const globalRow = rows.find((r) => !normalizeStoredLevel(r.level));
  if (globalRow) return globalRow;

  if (wanted.length) return null;
  return rows[0] ?? null;
}

function pickBestComponentRows<T extends { level?: string | null }>(
  rows: T[],
  wantedLevels: Array<string | null | undefined>,
): T[] {
  if (!rows.length) return [];

  const wanted = wantedLevels
    .map((level) => normalizeStoredLevel(level))
    .filter((level): level is string => Boolean(level));

  for (const key of wanted) {
    const exact = rows.filter((r) => normalizeStoredLevel(r.level) === key);
    if (exact.length) return exact;
  }

  const globalRows = rows.filter((r) => !normalizeStoredLevel(r.level));
  if (globalRows.length) return globalRows;

  if (wanted.length) return [];
  return rows;
}

function normText(s?: string | null) {
  return (s ?? "").toString().trim().toLowerCase();
}

/* ───────── Conduite (route publique, sans session admin) ───────── */

const clampConduct = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

type LatenessMode = "ignore" | "as_hours" | "direct_points";

type ConductSettings = {
  rubric_max: {
    assiduite: number;
    tenue: number;
    moralite: number;
    discipline: number;
  };
  rules: {
    assiduite: {
      penalty_per_hour: number;
      max_hours_before_zero: number;
      note_after_threshold: number;
      lateness_mode: LatenessMode;
      lateness_minutes_per_absent_hour: number;
      lateness_points_per_late: number;
    };
    tenue: {
      warning_penalty: number;
    };
    moralite: {
      event_penalty: number;
    };
    discipline: {
      offense_penalty: number;
      council_cap: number;
    };
  };
};

const DEFAULT_CONDUCT_SETTINGS: ConductSettings = {
  rubric_max: { assiduite: 6, tenue: 3, moralite: 4, discipline: 7 },
  rules: {
    assiduite: {
      penalty_per_hour: 0.5,
      max_hours_before_zero: 10,
      note_after_threshold: 0,
      lateness_mode: "as_hours",
      lateness_minutes_per_absent_hour: 60,
      lateness_points_per_late: 0.25,
    },
    tenue: { warning_penalty: 0.5 },
    moralite: { event_penalty: 1 },
    discipline: { offense_penalty: 1, council_cap: 5 },
  },
};

const numSetting = (v: any, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

type InstitutionConductPolicy = {
  mode: "standard" | "conduct_plus_subjects";
  classic_conduct_weight: number;
  missing_subject_strategy: "ignore_missing" | "count_as_zero";
  is_active: boolean;
  display_label: "Conduite" | "Discipline";
  is_csca: boolean;
};

type ConductSubjectPolicy = {
  subject_id: string;
  subject_name: string;
  conduct_weight: number;
};

type ConductPolicyComponent = {
  kind: "classic_conduct" | "subject";
  label: string;
  subject_id: string | null;
  avg20: number | null;
  weight: number;
  included: boolean;
  missing: boolean;
};

type ConductPolicyResult = {
  total: number;
  avg20: number;
  policy_applied: boolean;
  mode: InstitutionConductPolicy["mode"];
  classic_total: number;
  classic_avg20: number;
  components: ConductPolicyComponent[];
};

type ConductRubricKey = "assiduite" | "tenue" | "moralite" | "discipline";

type ConductOverride = {
  student_id: string;
  override_total: number;
  calculated_total: number | null;
  reason: string | null;
  updated_at: string | null;
  edited_by: string | null;
};

type ConductRubricOverride = {
  student_id: string;
  rubric_key: ConductRubricKey;
  override_value: number;
  calculated_value: number | null;
  updated_at: string | null;
  edited_by: string | null;
};

const CONDUCT_RUBRIC_KEYS: ConductRubricKey[] = [
  "assiduite",
  "tenue",
  "moralite",
  "discipline",
];

function isConductRubricKey(value: unknown): value is ConductRubricKey {
  return CONDUCT_RUBRIC_KEYS.includes(String(value) as ConductRubricKey);
}

function clean2(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(2));
}

function normalizeScoreTo20(score: number, totalMax: number): number {
  const max = Number(totalMax);
  if (!Number.isFinite(max) || max <= 0 || max === 20) {
    return clampConduct(score, 0, 20);
  }
  return clampConduct((score * 20) / max, 0, 20);
}

function normalizeScoreFrom20(avg20: number, totalMax: number): number {
  const max = Number(totalMax);
  if (!Number.isFinite(max) || max <= 0 || max === 20) {
    return clampConduct(avg20, 0, 20);
  }
  return clampConduct((avg20 * max) / 20, 0, max);
}

async function loadInstitutionConductPolicy(
  srv: SupabaseClient,
  institutionId: string,
): Promise<InstitutionConductPolicy> {
  const fallback: InstitutionConductPolicy = {
    mode: "standard",
    classic_conduct_weight: 1,
    missing_subject_strategy: "ignore_missing",
    is_active: false,
    display_label: "Conduite",
    is_csca: false,
  };

  try {
    const { data, error } = await srv
      .from("institution_conduct_policies")
      .select(
        "mode, classic_conduct_weight, missing_subject_strategy, is_active",
      )
      .eq("institution_id", institutionId)
      .maybeSingle();

    if (error || !data || (data as any).is_active === false) return fallback;

    const modeRaw = String((data as any).mode || "standard");
    const mode: InstitutionConductPolicy["mode"] =
      modeRaw === "conduct_plus_subjects"
        ? "conduct_plus_subjects"
        : "standard";

    const strategyRaw = String(
      (data as any).missing_subject_strategy || "ignore_missing",
    );
    const missing_subject_strategy: InstitutionConductPolicy["missing_subject_strategy"] =
      strategyRaw === "count_as_zero" ? "count_as_zero" : "ignore_missing";

    const weight = Number((data as any).classic_conduct_weight ?? 1);

    return {
      mode,
      classic_conduct_weight:
        Number.isFinite(weight) && weight >= 0 ? weight : 1,
      missing_subject_strategy,
      is_active: true,
      display_label: "Conduite",
      is_csca: false,
    };
  } catch {
    return fallback;
  }
}

async function loadConductSubjectPolicies(
  srv: SupabaseClient,
  institutionId: string,
): Promise<ConductSubjectPolicy[]> {
  try {
    const { data, error } = await srv
      .from("institution_subject_grade_policies")
      .select(
        "subject_id, conduct_weight, include_in_conduct_average, is_active",
      )
      .eq("institution_id", institutionId)
      .eq("include_in_conduct_average", true)
      .eq("is_active", true);

    if (error || !Array.isArray(data) || data.length === 0) return [];

    const rows = (data as any[])
      .map((row) => ({
        subject_id: String(row.subject_id || ""),
        conduct_weight: Number(row.conduct_weight ?? 1),
      }))
      .filter((row) => !!row.subject_id);

    const subjectIds = Array.from(new Set(rows.map((row) => row.subject_id)));
    const nameBySubject = new Map<string, string>();

    if (subjectIds.length > 0) {
      const { data: subjectRows } = await srv
        .from("subjects")
        .select("id, name, code")
        .in("id", subjectIds);

      for (const s of (subjectRows || []) as any[]) {
        const id = String(s.id || "");
        const label = String(s.name || s.code || "Matière").trim();
        if (id) nameBySubject.set(id, label || "Matière");
      }
    }

    return rows.map((row) => ({
      subject_id: row.subject_id,
      subject_name: nameBySubject.get(row.subject_id) || "Matière",
      conduct_weight:
        Number.isFinite(row.conduct_weight) && row.conduct_weight >= 0
          ? row.conduct_weight
          : 1,
    }));
  } catch {
    return [];
  }
}

async function loadCSCABuiltinConductSubjectPolicies(
  srv: SupabaseClient,
  institutionId: string,
): Promise<ConductSubjectPolicy[]> {
  try {
    const { data: instSubjects, error: instErr } = await srv
      .from("institution_subjects")
      .select("subject_id")
      .eq("institution_id", institutionId);

    if (instErr || !Array.isArray(instSubjects) || instSubjects.length === 0)
      return [];

    const subjectIds = Array.from(
      new Set(
        (instSubjects as any[])
          .map((row) => String(row.subject_id || ""))
          .filter(Boolean),
      ),
    );

    if (subjectIds.length === 0) return [];

    const { data: subjectRows, error: subErr } = await srv
      .from("subjects")
      .select("id, name, code")
      .in("id", subjectIds);

    if (subErr || !Array.isArray(subjectRows) || subjectRows.length === 0)
      return [];

    return (subjectRows as any[])
      .map((subject) => {
        const subject_id = String(subject.id || "");
        const label = String(subject.name || subject.code || "Matière").trim();
        const key = `${subject.name || ""} ${subject.code || ""}`;
        if (!subject_id || !isCSCALatinOrReligionLabel(key)) return null;
        return {
          subject_id,
          subject_name: label || "Matière",
          conduct_weight: 1,
        };
      })
      .filter((row): row is ConductSubjectPolicy => !!row);
  } catch {
    return [];
  }
}

function mergeConductSubjectPolicies(
  configured: ConductSubjectPolicy[],
  builtin: ConductSubjectPolicy[],
): ConductSubjectPolicy[] {
  const byId = new Map<string, ConductSubjectPolicy>();
  for (const row of [...configured, ...builtin]) {
    const subjectId = String(row.subject_id || "");
    if (!subjectId || byId.has(subjectId)) continue;
    byId.set(subjectId, row);
  }
  return Array.from(byId.values()).sort((a, b) =>
    a.subject_name.localeCompare(b.subject_name, "fr", {
      sensitivity: "base",
      numeric: true,
    }),
  );
}

async function loadSubjectAveragesForConductPolicy(
  srv: SupabaseClient,
  opts: {
    classId: string;
    subjectIds: string[];
    studentIds: string[];
    from: string;
    to: string;
  },
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const subjectIds = Array.from(new Set(opts.subjectIds.filter(Boolean)));
  const studentIds = Array.from(new Set(opts.studentIds.filter(Boolean)));

  if (!opts.classId || subjectIds.length === 0 || studentIds.length === 0)
    return out;

  try {
    let evalQuery = srv
      .from("grade_evaluations")
      .select("id, subject_id, scale, coeff, eval_date, is_published")
      .eq("class_id", opts.classId)
      .eq("is_published", true)
      .in("subject_id", subjectIds);

    if (opts.from) evalQuery = evalQuery.gte("eval_date", opts.from);
    if (opts.to) evalQuery = evalQuery.lte("eval_date", opts.to);

    const { data: evalRows, error: evalErr } = await evalQuery;
    if (evalErr || !Array.isArray(evalRows) || evalRows.length === 0)
      return out;

    const evalById = new Map<
      string,
      { subject_id: string; scale: number; coeff: number }
    >();
    for (const ev of evalRows as any[]) {
      const id = String(ev.id || "");
      const subject_id = String(ev.subject_id || "");
      if (!id || !subject_id) continue;
      const scaleRaw = Number(ev.scale ?? 20);
      const coeffRaw = Number(ev.coeff ?? 1);
      evalById.set(id, {
        subject_id,
        scale: Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 20,
        coeff: Number.isFinite(coeffRaw) && coeffRaw > 0 ? coeffRaw : 1,
      });
    }

    const evalIds = Array.from(evalById.keys());
    if (evalIds.length === 0) return out;

    const { data: scoreRows, error: scoreErr } = await srv
      .from("v_grade_scores_official_for_reports")
      .select("evaluation_id, student_id, score")
      .in("evaluation_id", evalIds)
      .in("student_id", studentIds);

    if (scoreErr || !Array.isArray(scoreRows) || scoreRows.length === 0)
      return out;

    const acc = new Map<string, { sum: number; coeff: number }>();

    for (const grade of scoreRows as any[]) {
      const evaluationId = String(grade.evaluation_id || "");
      const studentId = String(grade.student_id || "");
      const ev = evalById.get(evaluationId);
      if (!ev || !studentId) continue;

      const score = Number(grade.score);
      if (!Number.isFinite(score)) continue;

      const mark20 = clampConduct((score * 20) / ev.scale, 0, 20);
      const key = `${ev.subject_id}|${studentId}`;
      const cur = acc.get(key) || { sum: 0, coeff: 0 };
      cur.sum += mark20 * ev.coeff;
      cur.coeff += ev.coeff;
      acc.set(key, cur);
    }

    for (const [key, value] of acc.entries()) {
      if (!value.coeff) continue;
      const [subjectId, studentId] = key.split("|");
      if (!subjectId || !studentId) continue;
      const avg = clean2(value.sum / value.coeff);
      if (avg === null) continue;
      const byStudent = out.get(subjectId) || new Map<string, number>();
      byStudent.set(studentId, avg);
      out.set(subjectId, byStudent);
    }
  } catch {
    return out;
  }

  return out;
}

function applyInstitutionConductPolicyToStudent(opts: {
  studentId: string;
  classicTotal: number;
  totalMax: number;
  conductPolicy: InstitutionConductPolicy;
  subjectPolicies: ConductSubjectPolicy[];
  subjectAverages: Map<string, Map<string, number>>;
}): ConductPolicyResult {
  const classicTotal = clean2(opts.classicTotal) ?? 0;
  const classicAvg20 =
    clean2(normalizeScoreTo20(classicTotal, opts.totalMax)) ?? 0;
  const classicWeight = Math.max(
    0,
    Number(opts.conductPolicy.classic_conduct_weight ?? 1),
  );

  const components: ConductPolicyComponent[] = [
    {
      kind: "classic_conduct",
      label: opts.conductPolicy.display_label || "Conduite",
      subject_id: null,
      avg20: classicAvg20,
      weight: classicWeight,
      included: classicWeight > 0,
      missing: false,
    },
  ];

  if (
    opts.conductPolicy.mode !== "conduct_plus_subjects" ||
    opts.subjectPolicies.length === 0
  ) {
    return {
      total: classicTotal,
      avg20: classicAvg20,
      policy_applied: false,
      mode: opts.conductPolicy.mode,
      classic_total: classicTotal,
      classic_avg20: classicAvg20,
      components,
    };
  }

  let weightedSum = classicWeight > 0 ? classicAvg20 * classicWeight : 0;
  let totalWeight = classicWeight > 0 ? classicWeight : 0;

  for (const subjectPolicy of opts.subjectPolicies) {
    const weight = Math.max(0, Number(subjectPolicy.conduct_weight ?? 1));
    const rawAvg = opts.subjectAverages
      .get(subjectPolicy.subject_id)
      ?.get(opts.studentId);

    const hasAvg = typeof rawAvg === "number" && Number.isFinite(rawAvg);
    const shouldCountMissing =
      opts.conductPolicy.missing_subject_strategy === "count_as_zero";
    const included = weight > 0 && (hasAvg || shouldCountMissing);
    const avg20 = hasAvg
      ? clampConduct(rawAvg, 0, 20)
      : shouldCountMissing
        ? 0
        : null;

    components.push({
      kind: "subject",
      label: subjectPolicy.subject_name,
      subject_id: subjectPolicy.subject_id,
      avg20: avg20 === null ? null : clean2(avg20),
      weight,
      included,
      missing: !hasAvg,
    });

    if (included && avg20 !== null) {
      weightedSum += avg20 * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight <= 0) {
    return {
      total: classicTotal,
      avg20: classicAvg20,
      policy_applied: false,
      mode: opts.conductPolicy.mode,
      classic_total: classicTotal,
      classic_avg20: classicAvg20,
      components,
    };
  }

  const finalAvg20 = clean2(weightedSum / totalWeight) ?? classicAvg20;
  const finalTotal =
    clean2(normalizeScoreFrom20(finalAvg20, opts.totalMax)) ?? classicTotal;

  return {
    total: finalTotal,
    avg20: finalAvg20,
    policy_applied: true,
    mode: opts.conductPolicy.mode,
    classic_total: classicTotal,
    classic_avg20: classicAvg20,
    components,
  };
}

async function loadConductSettings(
  srv: SupabaseClient,
  institutionId: string,
): Promise<ConductSettings> {
  try {
    const { data, error } = await srv
      .from("conduct_settings")
      .select(
        `
        assiduite_max,
        tenue_max,
        moralite_max,
        discipline_max,
        points_per_absent_hour,
        absent_hours_zero_threshold,
        absent_hours_note_after_threshold,
        lateness_mode,
        lateness_minutes_per_absent_hour,
        lateness_points_per_late
      `,
      )
      .eq("institution_id", institutionId)
      .maybeSingle();

    if (error || !data) return DEFAULT_CONDUCT_SETTINGS;

    const raw = data as any;
    const modeRaw = String(
      raw.lateness_mode ??
        DEFAULT_CONDUCT_SETTINGS.rules.assiduite.lateness_mode,
    )
      .normalize("NFKC")
      .trim()
      .toLowerCase();

    const allowedModes: LatenessMode[] = [
      "ignore",
      "as_hours",
      "direct_points",
    ];
    const lateness_mode: LatenessMode = allowedModes.includes(
      modeRaw as LatenessMode,
    )
      ? (modeRaw as LatenessMode)
      : DEFAULT_CONDUCT_SETTINGS.rules.assiduite.lateness_mode;

    return {
      rubric_max: {
        assiduite: numSetting(
          raw.assiduite_max,
          DEFAULT_CONDUCT_SETTINGS.rubric_max.assiduite,
        ),
        tenue: numSetting(
          raw.tenue_max,
          DEFAULT_CONDUCT_SETTINGS.rubric_max.tenue,
        ),
        moralite: numSetting(
          raw.moralite_max,
          DEFAULT_CONDUCT_SETTINGS.rubric_max.moralite,
        ),
        discipline: numSetting(
          raw.discipline_max,
          DEFAULT_CONDUCT_SETTINGS.rubric_max.discipline,
        ),
      },
      rules: {
        assiduite: {
          penalty_per_hour: numSetting(
            raw.points_per_absent_hour,
            DEFAULT_CONDUCT_SETTINGS.rules.assiduite.penalty_per_hour,
          ),
          max_hours_before_zero: numSetting(
            raw.absent_hours_zero_threshold,
            DEFAULT_CONDUCT_SETTINGS.rules.assiduite.max_hours_before_zero,
          ),
          note_after_threshold: numSetting(
            raw.absent_hours_note_after_threshold,
            DEFAULT_CONDUCT_SETTINGS.rules.assiduite.note_after_threshold,
          ),
          lateness_mode,
          lateness_minutes_per_absent_hour: numSetting(
            raw.lateness_minutes_per_absent_hour,
            DEFAULT_CONDUCT_SETTINGS.rules.assiduite
              .lateness_minutes_per_absent_hour,
          ),
          lateness_points_per_late: numSetting(
            raw.lateness_points_per_late,
            DEFAULT_CONDUCT_SETTINGS.rules.assiduite.lateness_points_per_late,
          ),
        },
        tenue: {
          warning_penalty: DEFAULT_CONDUCT_SETTINGS.rules.tenue.warning_penalty,
        },
        moralite: {
          event_penalty: DEFAULT_CONDUCT_SETTINGS.rules.moralite.event_penalty,
        },
        discipline: {
          offense_penalty:
            DEFAULT_CONDUCT_SETTINGS.rules.discipline.offense_penalty,
          council_cap: DEFAULT_CONDUCT_SETTINGS.rules.discipline.council_cap,
        },
      },
    };
  } catch {
    return DEFAULT_CONDUCT_SETTINGS;
  }
}

async function loadDefaultSessionMinutes(
  srv: SupabaseClient,
  institutionId: string,
): Promise<number> {
  try {
    const { data, error } = await srv
      .from("institutions")
      .select("default_session_minutes")
      .eq("id", institutionId)
      .maybeSingle();

    if (error || !data) return 60;

    const n = Number((data as any).default_session_minutes);
    if (!Number.isFinite(n) || n <= 0) return 60;
    return n;
  } catch {
    return 60;
  }
}

function startISO(d?: string) {
  return d
    ? new Date(`${d}T00:00:00.000Z`).toISOString()
    : "0001-01-01T00:00:00.000Z";
}

function endISO(d?: string) {
  return d
    ? new Date(`${d}T23:59:59.999Z`).toISOString()
    : "9999-12-31T23:59:59.999Z";
}

/* ───────── Détection type de matière ───────── */

function isOtherSubject(name?: string | null, code?: string | null): boolean {
  const n = normText(name);
  const c = normText(code);

  return (
    /(^|\b)(eps|e\.p\.s|sport)(\b|$)/.test(c) ||
    /(^|\b)(eps|e\.p\.s|sport)(\b|$)/.test(n) ||
    /(education\s*physique|éducation\s*physique|sportive|eps)/.test(n) ||
    /(edhc|civique|citoyenn|vie\s*scolaire|conduite|discipline)/.test(n) ||
    /(musique|musical|musicale|chant|arts?\s*plastiques|dessin|th[eé]atre)/.test(n) ||
    /(tic|tice|informatique\s*(de\s*base)?)/.test(n) ||
    /(entrepreneuriat|travail\s*manuel|tm|bonus)/.test(n)
  );
}

function isPhiloSubject(name?: string | null, code?: string | null): boolean {
  const n = normText(name);
  const c = normText(code);
  return /(philo|philosoph)/.test(n) || /(philo|philosoph)/.test(c);
}

function isLettersSubject(name?: string | null, code?: string | null): boolean {
  if (isOtherSubject(name, code)) return false;

  const n = normText(name);
  const c = normText(code);

  if (isPhiloSubject(name, code)) return true;

  if (
    /(^|\b)(fr|francais|français|ang|anglais|esp|espagnol|all|allemand|ar|arabe|hg|hist|histoire|geo|geographie|géographie|lit|litt|eco|economie|économie)(\b|$)/.test(
      c,
    )
  ) {
    return true;
  }

  return (
    /(fran[cç]ais|french|anglais|english|espagnol|spanish|allemand|german|arabe|arabic)/.test(
      n,
    ) ||
    /(histoire|hist\.|g[eé]ographie|histoire\s*-?\s*g[eé]o|hg)/.test(n) ||
    /(litt[eé]r|lettres|grammaire|orthograph|conjug|lecture|r[eé]daction|expression|compr[eé]hension)/.test(
      n,
    ) ||
    /(economie|gestion|comptabilit|droit)/.test(n)
  );
}

function isScienceSubject(name?: string | null, code?: string | null): boolean {
  const n = normText(name);
  const c = normText(code);

  if (isOtherSubject(name, code)) return false;

  return (
    /(math|math[ée]m|phys|chim|svt|bio|science|info|algo|stat|techno)/.test(
      c,
    ) ||
    /(math|math[ée]m|phys|chim|svt|bio|science|informat|algo|stat|technolog)/.test(
      n,
    )
  );
}

function isConductSubject(name?: string | null, code?: string | null): boolean {
  const n = normText(name);
  const c = normText(code);

  return (
    /(conduite|conduct|vie\s*scolaire)/.test(n) ||
    /(conduite|conduct|vie\s*scolaire)/.test(c)
  );
}

function groupKey(s?: string | null) {
  return (s ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function computeGroupAnnualCoeff(
  group: BulletinSubjectGroup,
  coeffBySubject: Map<string, { coeff: number; include: boolean }>,
): number {
  let sumCoeff = 0;

  for (const item of group.items ?? []) {
    const base = coeffBySubject.get(String(item.subject_id));
    if (base?.include === false) continue;

    // Le coefficient officiel de la matière est prioritaire.
    // subject_coeff_override ne doit être utilisé qu'en secours si le coefficient officiel manque.
    const officialCoeff = Number(base?.coeff ?? 0);
    if (Number.isFinite(officialCoeff) && officialCoeff > 0) {
      sumCoeff += officialCoeff;
      continue;
    }

    const override = Number(item.subject_coeff_override ?? NaN);
    if (Number.isFinite(override) && override > 0) sumCoeff += override;
  }

  return cleanCoeff(sumCoeff);
}

/* ───────── Types ───────── */

type BulletinSubjectGroupItem = {
  id: string;
  group_id: string;
  subject_id: string;
  subject_name: string;
  order_index: number;
  subject_coeff_override: number | null;
  is_optional: boolean;
};

type BulletinSubjectGroup = {
  id: string;
  code: string;
  label: string;
  short_label: string | null;
  order_index: number;
  is_active: boolean;
  annual_coeff: number;
  items: BulletinSubjectGroupItem[];
};

type ClassRow = {
  id: string;
  label?: string | null;
  code?: string | null;
  institution_id?: string | null;
  academic_year?: string | null;
  head_teacher_id?: string | null;
  level?: string | null;
  official_track_code?: string | null;
  education_type?: string | null;
  formation_code?: string | null;
  formation_level_code?: string | null;
};

type HeadTeacherRow = {
  id: string;
  display_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

type SubjectRow = {
  id: string;
  name?: string | null;
  code?: string | null;
};

type SubjectCoeffRow = {
  subject_id: string;
  coeff: number;
  include_in_average?: boolean | null;
  level?: string | null;
};

type SubjectGradePolicyRow = {
  subject_id: string;
  include_in_general_average?: boolean | null;
  include_in_conduct_average?: boolean | null;
  conduct_weight?: number | null;
  is_active?: boolean | null;
};

type BulletinSubjectComponent = {
  id: string;
  subject_id: string;
  label: string;
  short_label: string | null;
  coeff_in_subject: number;
  order_index: number;
};

type EvalRow = {
  id: string;
  class_id: string;
  subject_id: string | null;
  teacher_id: string | null;
  eval_date: string;
  scale: number;
  coeff: number;
  is_published: boolean;
  subject_component_id?: string | null;
};

type ScoreRow = {
  evaluation_id: string;
  student_id: string;
  score: number | null;
};

type GradeAdjustmentBonusRow = {
  student_id: string;
  subject_id: string | null;
  grading_period_id?: string | null;
  bonus: number | string | null;
};

type AdjustmentBonusMaps = {
  subjectBonusByStudent: Map<string, Map<string, number>>;
  generalBonusByStudent: Map<string, number>;
};

type ClassStudentRow = {
  student_id: string;
  students?: {
    full_name?: string | null;
    last_name?: string | null;
    first_name?: string | null;
    matricule?: string | null;
    photo_url?: string | null;
    gender?: string | null;
    birthdate?: string | null;
    birth_place?: string | null;
    nationality?: string | null;
    regime?: string | null;
    is_repeater?: boolean | null;
    is_boarder?: boolean | null;
    is_affecte?: boolean | null;
  } | null;
};

/* ───────── Rangs front ───────── */

function applySubjectRanks(items: any[]) {
  if (!items || !items.length) return;

  type Entry = { index: number; avg: number; subject_id: string };
  const bySubject = new Map<string, Entry[]>();

  items.forEach((item, idx) => {
    const perSubject = item.per_subject as any[] | undefined;
    if (!Array.isArray(perSubject)) return;

    perSubject.forEach((ps) => {
      const avg =
        typeof ps.avg20 === "number" && Number.isFinite(ps.avg20)
          ? ps.avg20
          : null;
      const sid = ps.subject_id as string | undefined;
      if (!sid || avg === null) return;

      const arr = bySubject.get(sid) || [];
      arr.push({ index: idx, avg, subject_id: sid });
      bySubject.set(sid, arr);
    });
  });

  bySubject.forEach((entries) => {
    entries.sort((a, b) => b.avg - a.avg);

    let lastAvg: number | null = null;
    let currentRank = 0;
    let position = 0;

    for (const { index, avg, subject_id } of entries) {
      position += 1;
      if (lastAvg === null || avg !== lastAvg) {
        currentRank = position;
        lastAvg = avg;
      }

      const perSubject = items[index].per_subject as any[];
      if (!Array.isArray(perSubject)) continue;

      const cell = perSubject.find((ps: any) => ps.subject_id === subject_id);
      if (cell) (cell as any).subject_rank = currentRank;
    }
  });
}

function applySubjectComponentRanks(items: any[]) {
  if (!items || !items.length) return;

  type Entry = { index: number; avg: number; component_id: string };
  const byComponent = new Map<string, Entry[]>();

  items.forEach((item, idx) => {
    const perComp = item.per_subject_components as any[] | undefined;
    if (!Array.isArray(perComp)) return;

    perComp.forEach((psc) => {
      const avg =
        typeof psc.avg20 === "number" && Number.isFinite(psc.avg20)
          ? psc.avg20
          : null;
      const cid = psc.component_id as string | undefined;
      if (!cid || avg === null) return;

      const arr = byComponent.get(cid) || [];
      arr.push({ index: idx, avg, component_id: cid });
      byComponent.set(cid, arr);
    });
  });

  byComponent.forEach((entries, componentId) => {
    entries.sort((a, b) => b.avg - a.avg);

    let lastAvg: number | null = null;
    let currentRank = 0;
    let position = 0;

    for (const { index, avg } of entries) {
      position += 1;
      if (lastAvg === null || avg !== lastAvg) {
        currentRank = position;
        lastAvg = avg;
      }

      const perComp = items[index].per_subject_components as any[] | undefined;
      if (!Array.isArray(perComp)) continue;

      const cell = perComp.find((psc: any) => psc.component_id === componentId);
      if (cell) (cell as any).component_rank = currentRank;
    }
  });
}

/* ───────── Groupes fallback (LETTRES / SCIENCES / AUTRES) ───────── */

function findGroupByMeaning(
  groups: BulletinSubjectGroup[],
  meaning: "LETTRES" | "SCIENCES" | "AUTRES",
): BulletinSubjectGroup | null {
  const keys =
    meaning === "LETTRES"
      ? ["BILANLETTRES", "LETTRES", "LITTERAIRE", "LITTERATURE", "LANGUES"]
      : meaning === "SCIENCES"
        ? ["BILANSCIENCES", "SCIENCES", "SCIENTIFIQUE"]
        : ["BILANAUTRES", "AUTRES", "DIVERS", "VIESCOLAIRE", "CONDUITE"];

  for (const g of groups) {
    const k1 = groupKey(g.code);
    const k2 = groupKey(g.label);
    if (keys.includes(k1) || keys.includes(k2)) return g;
  }
  return null;
}

function buildFallbackGroups(opts: {
  subjectIds: string[];
  subjectInfoById: Map<string, { name: string; code: string }>;
  coeffBySubject: Map<string, { coeff: number; include: boolean }>;
  educationType?: string | null;
}): BulletinSubjectGroup[] {
  const { subjectIds, subjectInfoById, coeffBySubject } = opts;

  // Même règle que le bulletin imprimé : les regroupements automatiques
  // LETTRES / SCIENCES / AUTRES restent un héritage du secondaire général.
  // Sans groupes explicites en technique, professionnel ou BTS, le QR affiche
  // directement les matières, dans leur ordre officiel.
  if (opts.educationType && opts.educationType !== "general_secondary") {
    return [];
  }

  const letters: string[] = [];
  const sciences: string[] = [];
  const autres: string[] = [];

  for (const sid of subjectIds) {
    const meta = subjectInfoById.get(sid) || { name: "", code: "" };
    const name = meta.name;
    const code = meta.code;

    // Même règle que le bulletin admin :
    // Sciences si reconnu, Lettres si reconnu, sinon AUTRES.
    // Cela évite qu'une matière comme « Éducation musicale »
    // retombe par défaut dans BILAN LETTRES sur la page QR.
    if (isScienceSubject(name, code)) sciences.push(sid);
    else if (isLettersSubject(name, code)) letters.push(sid);
    else autres.push(sid);
  }

  const mkGroup = (p: {
    id: string;
    code: string;
    label: string;
    order_index: number;
    sids: string[];
  }): BulletinSubjectGroup => {
    const items: BulletinSubjectGroupItem[] = p.sids.map((sid, idx) => {
      const meta = subjectInfoById.get(sid) || { name: "", code: "" };
      const subjectName = meta.name || meta.code || "Matière";
      return {
        id: `virt-${p.code}-${sid}`,
        group_id: p.id,
        subject_id: sid,
        subject_name: subjectName,
        order_index: idx + 1,
        subject_coeff_override: null,
        is_optional: false,
      };
    });

    let sumCoeff = 0;
    for (const sid of p.sids) {
      const info = coeffBySubject.get(sid);
      const c = info ? Number(info.coeff ?? 1) : 1;
      if (Number.isFinite(c) && c > 0) sumCoeff += c;
    }

    return {
      id: p.id,
      code: p.code,
      label: p.label,
      short_label: null,
      order_index: p.order_index,
      is_active: true,
      annual_coeff: cleanCoeff(sumCoeff || 1),
      items,
    };
  };

  const groups: BulletinSubjectGroup[] = [
    mkGroup({
      id: "fallback-letters",
      code: "BILAN_LETTRES",
      label: "BILAN LETTRES",
      order_index: 1,
      sids: letters,
    }),
    mkGroup({
      id: "fallback-sciences",
      code: "BILAN_SCIENCES",
      label: "BILAN SCIENCES",
      order_index: 2,
      sids: sciences,
    }),
    mkGroup({
      id: "fallback-autres",
      code: "BILAN_AUTRES",
      label: "BILAN AUTRES",
      order_index: 3,
      sids: autres,
    }),
  ];

  return groups.filter((g) => g.items.length > 0);
}

/* ───────── Helper : moyenne générale d’un élève sur UNE période [from, to] ───────── */

async function computeStudentGeneralAvgForRange(opts: {
  srv: SupabaseClient;
  classId: string;
  studentId: string;
  from: string;
  to: string;
  conductAvg20?: number | null;
  subjectsForReport: {
    subject_id: string;
    coeff_bulletin: number;
    include_in_average: boolean;
  }[];
  conductSubjectIds: Set<string>;
  subjectComponentsBySubject: Map<string, BulletinSubjectComponent[]>;
  subjectComponentById: Map<string, BulletinSubjectComponent>;
  bonusMaps?: AdjustmentBonusMaps | null;
}): Promise<number | null> {
  const {
    srv,
    classId,
    studentId,
    from,
    to,
    conductAvg20,
    subjectsForReport,
    conductSubjectIds,
    subjectComponentsBySubject,
    subjectComponentById,
    bonusMaps,
  } = opts;

  let evalQuery = srv
    .from("grade_evaluations")
    .select(
      "id, class_id, subject_id, teacher_id, eval_date, scale, coeff, is_published, subject_component_id",
    )
    .eq("class_id", classId)
    .eq("is_published", true)
    .gte("eval_date", from)
    .lte("eval_date", to);

  const { data: evalData, error: evalErr } = await evalQuery;
  if (evalErr || !evalData || !evalData.length) return null;

  const evals = evalData as EvalRow[];
  const evalById = new Map<string, EvalRow>();
  evals.forEach((e) => evalById.set(e.id, e));

  const evalIds = evals.map((e) => e.id);

  const { data: scoreData, error: scoreErr } = await srv
    .from("v_grade_scores_official_for_reports")
    .select("evaluation_id, student_id, score")
    .in("evaluation_id", evalIds)
    .eq("student_id", studentId);

  if (scoreErr || !scoreData || !scoreData.length) return null;
  const scores = scoreData as ScoreRow[];

  const perSubject = new Map<
    string,
    { sumWeighted: number; sumCoeff: number }
  >();
  const perComp = new Map<
    string,
    { subject_id: string; sumWeighted: number; sumCoeff: number }
  >();

  for (const sc of scores) {
    const ev = evalById.get(sc.evaluation_id);
    if (!ev) continue;
    if (!ev.subject_id) continue;
    if (!ev.scale || ev.scale <= 0) continue;
    if (sc.score === null || sc.score === undefined) continue;

    const score = Number(sc.score);
    if (!Number.isFinite(score)) continue;

    const norm20 = (score / ev.scale) * 20;
    const weight = ev.coeff ?? 1;
    const sid = String(ev.subject_id);

    const subjCell = perSubject.get(sid) || { sumWeighted: 0, sumCoeff: 0 };
    subjCell.sumWeighted += norm20 * weight;
    subjCell.sumCoeff += weight;
    perSubject.set(sid, subjCell);

    if (ev.subject_component_id) {
      const comp = subjectComponentById.get(String(ev.subject_component_id));
      if (comp) {
        const compCell = perComp.get(comp.id) || {
          subject_id: comp.subject_id,
          sumWeighted: 0,
          sumCoeff: 0,
        };
        compCell.sumWeighted += norm20 * weight;
        compCell.sumCoeff += weight;
        perComp.set(comp.id, compCell);
      }
    }
  }

  const per_subject = subjectsForReport.map((s) => {
    const comps = subjectComponentsBySubject.get(s.subject_id) || [];
    let avg20: number | null = null;

    if (comps.length) {
      let sum = 0;
      let sumW = 0;

      for (const comp of comps) {
        const cell = perComp.get(comp.id);
        if (!cell || cell.sumCoeff <= 0) continue;

        const compAvgRaw = cell.sumWeighted / cell.sumCoeff;
        if (!Number.isFinite(compAvgRaw)) continue;

        const w = comp.coeff_in_subject ?? 1;
        if (!w || w <= 0) continue;

        sum += compAvgRaw * w;
        sumW += w;
      }

      if (sumW > 0) {
        avg20 = cleanNumber(sum / sumW, 4);
      }
    }

    if (avg20 === null) {
      const cell = perSubject.get(s.subject_id);
      if (cell && cell.sumCoeff > 0) {
        avg20 = cleanNumber(cell.sumWeighted / cell.sumCoeff, 4);
      }
    }

    const rawAvg20 = avg20;
    const subjectBonus =
      bonusMaps?.subjectBonusByStudent
        .get(studentId)
        ?.get(String(s.subject_id)) ?? 0;

    if (
      avg20 !== null &&
      avg20 !== undefined &&
      Number.isFinite(Number(avg20))
    ) {
      const adjusted = clampAverage20(Number(avg20) + subjectBonus);
      avg20 = adjusted === null ? null : cleanNumber(adjusted, 4);
    }

    return {
      subject_id: s.subject_id,
      avg20,
      bonus: Number(subjectBonus.toFixed(2)),
      avg20_before_bonus: rawAvg20,
    };
  });

  let sumGen = 0;
  let sumCoeffGen = 0;
  let conductAlreadyCounted = false;
  let hasAcademicMatterAverage = false;

  for (const s of subjectsForReport) {
    if (s.include_in_average === false) continue;
    const coeffSub = Number(s.coeff_bulletin ?? 0);
    if (!coeffSub || coeffSub <= 0) continue;

    const ps = per_subject.find((x) => x.subject_id === s.subject_id);
    const subAvg = ps?.avg20 ?? null;
    if (subAvg === null || subAvg === undefined) continue;

    const isConductRow = conductSubjectIds.has(String(s.subject_id));
    if (isConductRow) {
      conductAlreadyCounted = true;
    } else {
      hasAcademicMatterAverage = true;
    }

    sumGen += Number(subAvg) * coeffSub;
    sumCoeffGen += coeffSub;
  }

  if (!hasAcademicMatterAverage) return null;

  if (
    !conductAlreadyCounted &&
    conductAvg20 !== null &&
    conductAvg20 !== undefined
  ) {
    const c = Number(conductAvg20);
    if (Number.isFinite(c)) {
      sumGen += c * 1;
      sumCoeffGen += 1;
    }
  }

  const generalBeforeBonus =
    sumCoeffGen > 0 ? cleanNumber(sumGen / sumCoeffGen, 4) : null;
  if (generalBeforeBonus === null) return null;

  const generalBonus = bonusMaps?.generalBonusByStudent.get(studentId) ?? 0;
  const adjusted = clampAverage20(generalBeforeBonus + generalBonus);
  return adjusted === null ? null : cleanNumber(adjusted, 4);
}

/* ───────── Route GET ───────── */

export async function GET(req: NextRequest) {
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  const url = new URL(req.url);
  const shortCode = url.searchParams.get("c") || url.searchParams.get("code");
  const token = url.searchParams.get("t");
  const liteMode = ["1", "true", "yes"].includes(
    String(url.searchParams.get("lite") || url.searchParams.get("mode") || "")
      .trim()
      .toLowerCase(),
  );

  let mode: "short" | "token" = "token";
  let payload: any = null;

  if (shortCode) {
    mode = "short";

    let rec: any = null;
    try {
      rec = await resolveBulletinByCode(srv, shortCode);
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          error: "qr_store_error",
          code: String(shortCode || "")
            .trim()
            .toUpperCase(),
          detail: e?.message
            ? String(e.message)
            : String(e || "Erreur inconnue"),
        },
        { status: 500 },
      );
    }

    if (!rec?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: rec?.error || "invalid_code",
          code: String(shortCode || "")
            .trim()
            .toUpperCase(),
        },
        { status: 400 },
      );
    }

    if (!rec.payload || typeof rec.payload !== "object") {
      return NextResponse.json(
        {
          ok: false,
          error: "invalid_payload",
          code: String(shortCode || "")
            .trim()
            .toUpperCase(),
        },
        { status: 400 },
      );
    }

    payload = rec.payload;
  } else if (token) {
    mode = "token";
    const dec: any = verifyBulletinQR(token);
    if (!dec) {
      return NextResponse.json(
        { ok: false, error: "invalid_qr" },
        { status: 400 },
      );
    }
    payload = dec;
  } else {
    return NextResponse.json(
      { ok: false, error: "missing_param" },
      { status: 400 },
    );
  }

  const instId: string | undefined = payload?.instId;
  const classId: string | undefined = payload?.classId;
  const studentId: string | undefined = payload?.studentId;

  if (!instId || !classId || !studentId) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload" },
      { status: 400 },
    );
  }

  const instIdStr: string = instId;
  const classIdStr: string = classId;
  const studentIdStr: string = studentId;

  let dateFrom: string | null =
    payload?.i ??
    payload?.periodFrom ??
    payload?.period_from ??
    payload?.from ??
    payload?.start_date ??
    payload?.startDate ??
    null;

  let dateTo: string | null =
    payload?.o ??
    payload?.periodTo ??
    payload?.period_to ??
    payload?.to ??
    payload?.end_date ??
    payload?.endDate ??
    null;

  const academicYearToken: string | null =
    payload?.academicYear ?? payload?.academic_year ?? payload?.year ?? null;

  const periodLabelToken: string | null =
    payload?.periodLabel ??
    payload?.period_label ??
    payload?.periodShortLabel ??
    payload?.period_short_label ??
    payload?.short_label ??
    payload?.p ??
    null;

  const periodCodeToken: string | null =
    payload?.periodCode ?? payload?.period_code ?? null;

  const [
    { data: inst, error: instErr },
    { data: cls, error: clsErr },
    { data: stu, error: stuErr },
  ] = await Promise.all([
    srv.from("institutions").select("*").eq("id", instIdStr).maybeSingle(),
    srv.from("classes").select("*").eq("id", classIdStr).maybeSingle(),
    srv.from("students").select("*").eq("id", studentIdStr).maybeSingle(),
  ]);

  if (instErr || !inst) {
    return NextResponse.json(
      {
        ok: false,
        error: instErr ? "INSTITUTION_QUERY_ERROR" : "INSTITUTION_NOT_FOUND",
        detail: instErr?.message ?? null,
        hint: instErr
          ? "Vérifie les colonnes de la table institutions ou les variables Supabase de cet environnement."
          : null,
      },
      { status: instErr ? 500 : 404 },
    );
  }

  if (clsErr || !cls) {
    return NextResponse.json(
      {
        ok: false,
        error: clsErr ? "CLASS_QUERY_ERROR" : "CLASS_NOT_FOUND",
        detail: clsErr?.message ?? null,
        hint: clsErr
          ? "Vérifie les colonnes de la table classes ou les variables Supabase de cet environnement."
          : null,
      },
      { status: clsErr ? 500 : 404 },
    );
  }

  const classRow = cls as ClassRow;

  if (!classRow.institution_id || classRow.institution_id !== instIdStr) {
    return NextResponse.json(
      {
        ok: false,
        error: "CLASS_FORBIDDEN",
        detail: `class.institution_id=${classRow.institution_id ?? "null"} payload.instId=${instIdStr}`,
      },
      { status: 403 },
    );
  }

  if (stuErr || !stu) {
    return NextResponse.json(
      {
        ok: false,
        error: stuErr ? "STUDENT_QUERY_ERROR" : "STUDENT_NOT_FOUND",
        detail: stuErr?.message ?? null,
        hint: stuErr
          ? "Vérifie les colonnes de la table students. La route publique utilise maintenant select('*') pour éviter les colonnes optionnelles absentes."
          : null,
      },
      { status: stuErr ? 500 : 404 },
    );
  }

  const bulletinLevel = normalizeBulletinLevel(classRow.level);
  const coeffLevelCandidates = buildCoeffLevelCandidates(
    classRow,
    bulletinLevel,
  );
  const educationContext = resolveBulletinEducationContext({
    educationType: classRow.education_type,
    formationCode: classRow.formation_code,
    formationLevelCode: classRow.formation_level_code,
    settingsJson: (inst as any).settings_json,
  });
  const scopedInstitutionSettings = resolveScopedInstitutionSettings({
    educationType: educationContext.educationType,
    settingsJson: (inst as any).settings_json,
  });
  const allowSubjectComponents =
    educationContext.educationType === "general_secondary"
      ? allowSubjectComponentsForBulletinLevel(bulletinLevel)
      : true;
  const institutionMeta: InstitutionMeta = {
    id: String((inst as any).id || instIdStr),
    name: (inst as any).name ?? null,
    code: (inst as any).code ?? null,
    code_unique: (inst as any).code_unique ?? null,
    acronym: (inst as any).acronym ?? null,
    logo_url:
      (inst as any).logo_url ??
      (inst as any).settings_json?.institution_logo_url ??
      null,
    settings_json: (inst as any).settings_json ?? null,
  };
  const institutionSettings = ((inst as any).settings_json || {}) as Record<string, any>;
  const officialValue = (key: string): string | null => {
    const candidates = [
      (scopedInstitutionSettings as any)?.[key],
      (inst as any)?.[key],
      institutionSettings?.[key],
    ];
    for (const candidate of candidates) {
      const value = String(candidate ?? "").trim();
      if (value) return value;
    }
    return null;
  };
  const officialInstitution = {
    country_name: officialValue("country_name"),
    country_motto: officialValue("country_motto"),
    ministry_name: officialValue("ministry_name"),
    institution_region: officialValue("institution_region"),
    institution_status: officialValue("institution_status"),
    institution_head_name: officialValue("institution_head_name"),
    institution_head_title: officialValue("institution_head_title"),
    institution_code:
      officialValue("institution_code") ||
      institutionMeta.code_unique ||
      institutionMeta.code ||
      null,
  };
  const isCSCA = isCSCAInstitution(institutionMeta);

  let applicablePeriodsForYear: any[] = [];
  let periodMeta: {
    id?: string | null;
    from: string | null;
    to: string | null;
    code?: string | null;
    label?: string | null;
    short_label?: string | null;
    academic_year?: string | null;
    coeff?: number | null;
  } = { from: dateFrom, to: dateTo };

  const yearGuess = academicYearToken ?? classRow.academic_year ?? null;
  const labelGuess =
    periodCodeToken ?? periodLabelToken ?? payload?.period ?? null;

  if (yearGuess) {
    try {
      const resolved = await listApplicableGradePeriods(
        srv,
        instIdStr,
        yearGuess,
        classRow.id,
      );
      applicablePeriodsForYear = (resolved.items || []) as any[];
    } catch {
      applicablePeriodsForYear = [];
    }
  }

  const findApplicablePeriodByToken = (value: unknown): any | null => {
    const tok = normText(String(value ?? ""));
    if (!tok) return null;

    const exact =
      applicablePeriodsForYear.find(
        (p) =>
          normText(p?.code) === tok ||
          normText(p?.display_code) === tok ||
          normText(p?.label) === tok ||
          normText(p?.short_label) === tok,
      ) ?? null;

    return (
      exact ||
      applicablePeriodsForYear.find((p) => {
        const values = [
          normText(p?.code),
          normText(p?.display_code),
          normText(p?.label),
          normText(p?.short_label),
        ].filter(Boolean);
        return values.some((candidate) =>
          candidate.includes(tok) || tok.includes(candidate),
        );
      }) ||
      null
    );
  };

  let matchedPeriod: any | null = null;

  if (dateFrom && dateTo) {
    matchedPeriod =
      applicablePeriodsForYear.find(
        (p) =>
          String(p?.start_date || "") === String(dateFrom) &&
          String(p?.end_date || "") === String(dateTo),
      ) ?? null;
  }

  if (!matchedPeriod && labelGuess) {
    matchedPeriod = findApplicablePeriodByToken(labelGuess);
  }

  if (matchedPeriod?.start_date && matchedPeriod?.end_date) {
    dateFrom = String(matchedPeriod.start_date);
    dateTo = String(matchedPeriod.end_date);
    periodMeta = {
      id: matchedPeriod.id ?? null,
      from: dateFrom,
      to: dateTo,
      code:
        matchedPeriod.display_code ??
        matchedPeriod.code ??
        periodCodeToken ??
        null,
      label: matchedPeriod.label ?? periodLabelToken ?? null,
      short_label: matchedPeriod.short_label ?? null,
      academic_year: matchedPeriod.academic_year ?? yearGuess ?? null,
      coeff:
        matchedPeriod.coeff === null || matchedPeriod.coeff === undefined
          ? null
          : cleanCoeff(matchedPeriod.coeff),
    };
  } else {
    // Compatibilité avec les anciens QR : si la période historique n'est plus
    // présente dans la configuration courante, on conserve les dates signées
    // du QR au lieu de rendre le document invalide.
    periodMeta = {
      from: dateFrom,
      to: dateTo,
      code: periodCodeToken ?? null,
      label: periodLabelToken ?? null,
      short_label: null,
      academic_year: yearGuess,
      coeff: null,
    };
  }

  let headTeacher: HeadTeacherRow | null = null;
  if (classRow.head_teacher_id) {
    const { data: ht, error: htErr } = await srv
      .from("profiles")
      .select("id, display_name, phone, email")
      .eq("id", classRow.head_teacher_id)
      .maybeSingle();
    if (!htErr && ht) headTeacher = ht as HeadTeacherRow;
  }

  const institutionResponseMeta = {
    id: institutionMeta.id,
    name: institutionMeta.name ?? null,
    code: institutionMeta.code ?? null,
    code_unique: institutionMeta.code_unique ?? null,
    acronym: institutionMeta.acronym ?? null,
    logo_url: safePublicLogoUrl(institutionMeta.logo_url),
    institution_logo_url: safePublicLogoUrl(institutionMeta.logo_url),
    ...officialInstitution,
  };

  const classResponseMeta = {
    id: classRow.id,
    label: classRow.label || classRow.code || "Classe",
    code: classRow.code || null,
    academic_year: classRow.academic_year || null,
    level: classRow.level || null,
    official_track_code: classRow.official_track_code || null,
    education_type: educationContext.educationType,
    education_label: educationContext.educationLabel,
    formation_code: educationContext.formationCode,
    formation_label: educationContext.formationLabel,
    formation_level_code: educationContext.formationLevelCode,
    formation_level_label: educationContext.formationLevelLabel,
    coefficient_level: coeffLevelCandidates[0] || bulletinLevel || null,
    bulletin_level: bulletinLevel,
    head_teacher: headTeacher
      ? {
          id: headTeacher.id,
          display_name: headTeacher.display_name || null,
          phone: headTeacher.phone || null,
          email: headTeacher.email || null,
        }
      : null,
  };

  if (mode === "short" && liteMode) {
    const snap = (payload as any)?.s ?? null;
    const snapGeneral =
      snap && typeof snap.g === "number" ? cleanNumber(snap.g, 4) : null;
    const snapAnnual =
      snap && typeof snap.a === "number" ? cleanNumber(snap.a, 4) : null;

    const safePeriod = {
      ...periodMeta,
      label: periodMeta.label ?? periodLabelToken ?? null,
      short_label: periodMeta.short_label ?? periodLabelToken ?? null,
      academic_year:
        periodMeta.academic_year ??
        academicYearToken ??
        classRow.academic_year ??
        null,
    };

    return NextResponse.json({
      ok: true,
      mode: "short_lite",
      source: "bulletin_qr_codes_snapshot",
      calculation_profile: isCSCA ? "csca" : "standard",
      is_csca: isCSCA,
      institution: institutionResponseMeta,
      class: classResponseMeta,
      student: {
        id: (stu as any).id,
        full_name:
          [(stu as any).last_name, (stu as any).first_name]
            .filter(Boolean)
            .join(" ") ||
          (stu as any).full_name ||
          null,
        last_name: (stu as any).last_name || null,
        first_name: (stu as any).first_name || null,
        matricule: (stu as any).matricule || null,
        gender: (stu as any).gender || null,
        birth_date: (stu as any).birthdate || null,
        birth_place: (stu as any).birth_place || null,
        nationality: (stu as any).nationality || null,
        regime: (stu as any).regime || null,
        is_repeater: (stu as any).is_repeater ?? null,
        is_boarder: (stu as any).is_boarder ?? null,
        is_affecte: (stu as any).is_affecte ?? null,
        photo_url: null,
      },
      period: safePeriod,
      subjects: [],
      subject_groups: [],
      subject_components: [],
      conduct: null,
      bulletin: {
        student_id: studentIdStr,
        general_avg: snapGeneral,
        annual_avg: snapAnnual,
        qr_snapshot_general_avg: snapGeneral,
        qr_snapshot_annual_avg: snapAnnual,
        general_avg_source: "qr_snapshot",
        annual_avg_source: "qr_snapshot",
        per_subject: [],
        per_group: [],
        per_subject_components: [],
      },
    });
  }

  let periodLooksAnnual = false;
  let yearForAnnual: string | null =
    periodMeta.academic_year ??
    academicYearToken ??
    classRow.academic_year ??
    null;
  let yearPeriods: any[] = [];
  let shouldComputeAnnual = false;

  {
    const txt =
      normText(periodMeta.code) +
      " " +
      normText(periodMeta.label) +
      " " +
      normText(periodMeta.short_label);
    periodLooksAnnual = /(annuel|annuelle|annual|année|annee)/.test(txt);
  }

  if (yearForAnnual) {
    if (
      !applicablePeriodsForYear.length ||
      String(applicablePeriodsForYear[0]?.academic_year || "") !==
        String(yearForAnnual)
    ) {
      try {
        const resolved = await listApplicableGradePeriods(
          srv,
          instIdStr,
          yearForAnnual,
          classRow.id,
        );
        applicablePeriodsForYear = (resolved.items || []) as any[];
      } catch {
        applicablePeriodsForYear = [];
      }
    }

    yearPeriods = applicablePeriodsForYear;

    if (yearPeriods.length && dateTo) {
      const ends = yearPeriods
        .map((p) => (p?.end_date ? String(p.end_date) : ""))
        .filter(Boolean)
        .sort();
      const maxEnd = ends.length ? ends[ends.length - 1] : null;

      if (periodLooksAnnual) {
        shouldComputeAnnual = true;
      } else if (maxEnd && dateTo === maxEnd) {
        shouldComputeAnnual = true;
      }
    }
  }

  const hasDateFilter = !!dateFrom || !!dateTo;

  let enrollQuery = srv
    .from("class_enrollments")
    .select(
      `
      student_id,
      students(
        matricule,
        first_name,
        last_name,
        full_name,
        gender,
        birthdate,
        birth_place,
        nationality,
        regime,
        is_repeater,
        is_boarder,
        is_affecte
      )
    `,
    )
    .eq("class_id", classIdStr);

  if (!hasDateFilter) {
    enrollQuery = enrollQuery.is("end_date", null);
  } else if (dateFrom) {
    enrollQuery = enrollQuery.or(`end_date.gte.${dateFrom},end_date.is.null`);
  }

  enrollQuery = enrollQuery.order("student_id", { ascending: true });

  const { data: csData, error: csErr } = await enrollQuery;

  if (csErr) {
    return NextResponse.json(
      { ok: false, error: "CLASS_STUDENTS_ERROR" },
      { status: 500 },
    );
  }

  const classStudents = (csData || []) as ClassStudentRow[];

  if (!classStudents.length) {
    return NextResponse.json({
      ok: true,
      mode,
      institution: institutionResponseMeta,
      class: classResponseMeta,
      student: {
        id: stu.id,
        full_name:
          [stu.last_name, stu.first_name].filter(Boolean).join(" ") ||
          stu.full_name ||
          null,
        matricule: stu.matricule || null,
        gender: stu.gender || null,
        birth_date: stu.birthdate || null,
        birth_place: stu.birth_place || null,
        nationality: stu.nationality || null,
        regime: stu.regime || null,
        is_repeater: stu.is_repeater ?? null,
        is_boarder: stu.is_boarder ?? null,
        is_affecte: stu.is_affecte ?? null,
        photo_url: null,
      },
      period: periodMeta,
      subjects: [],
      subject_groups: [],
      subject_components: [],
      bulletin: null,
    });
  }

  const studentIds = classStudents.map((cs) => cs.student_id).filter(Boolean);

  /* ───────── Bonus pédagogiques officiels pour la vérification publique ─────────
   *
   * Même règle que le bulletin admin :
   * - bonus matière appliqué à la moyenne matière ;
   * - bonus général appliqué à la moyenne générale ;
   * - si grading_period_id existe, la ligne de la période demandée est prioritaire ;
   * - les anciennes lignes sans période restent compatibles.
   */
  async function loadAdjustmentBonusMaps(params: {
    academicYear: string | null | undefined;
    periodId?: string | null;
  }): Promise<AdjustmentBonusMaps> {
    const empty: AdjustmentBonusMaps = {
      subjectBonusByStudent: new Map(),
      generalBonusByStudent: new Map(),
    };

    const academicYear = String(params.academicYear || "").trim();
    if (!academicYear || !studentIds.length) return empty;

    const selectedByKey = new Map<
      string,
      {
        student_id: string;
        subject_id: string | null;
        bonus: number;
        priority: number;
      }
    >();

    const ingest = (
      rows: GradeAdjustmentBonusRow[],
      hasPeriodColumn: boolean,
    ) => {
      for (const row of rows || []) {
        const sid = String(row.student_id || "").trim();
        if (!sid) continue;

        const rawBonus = Number(row.bonus ?? 0);
        if (!Number.isFinite(rawBonus)) continue;

        const subjectId = row.subject_id ? String(row.subject_id) : null;
        const rowPeriodId = hasPeriodColumn
          ? row.grading_period_id
            ? String(row.grading_period_id)
            : null
          : null;

        let priority = 1;
        if (params.periodId) {
          if (rowPeriodId === params.periodId) priority = 2;
          else if (!rowPeriodId) priority = 1;
          else continue;
        }

        const key = `${sid}__${subjectId ?? "__GENERAL__"}`;
        const existing = selectedByKey.get(key);
        if (!existing || priority >= existing.priority) {
          selectedByKey.set(key, {
            student_id: sid,
            subject_id: subjectId,
            bonus: Number(rawBonus.toFixed(2)),
            priority,
          });
        }
      }
    };

    try {
      const { data, error } = await srv
        .from("grade_adjustments")
        .select("student_id, subject_id, grading_period_id, bonus")
        .eq("class_id", classIdStr)
        .eq("academic_year", academicYear)
        .in("student_id", studentIds);

      if (error) throw error;
      ingest((data || []) as GradeAdjustmentBonusRow[], true);
    } catch (error: any) {
      try {
        const { data, error: fallbackError } = await srv
          .from("grade_adjustments")
          .select("student_id, subject_id, bonus")
          .eq("class_id", classIdStr)
          .eq("academic_year", academicYear)
          .in("student_id", studentIds);

        if (fallbackError) throw fallbackError;
        ingest((data || []) as GradeAdjustmentBonusRow[], false);
      } catch (fallbackError) {
        console.warn("[public/bulletins/verify] bonus indisponibles", {
          academicYear,
          periodId: params.periodId ?? null,
          error: fallbackError,
        });
      }
    }

    const out: AdjustmentBonusMaps = {
      subjectBonusByStudent: new Map(),
      generalBonusByStudent: new Map(),
    };

    for (const row of selectedByKey.values()) {
      if (row.subject_id) {
        let bySubject = out.subjectBonusByStudent.get(row.student_id);
        if (!bySubject) {
          bySubject = new Map();
          out.subjectBonusByStudent.set(row.student_id, bySubject);
        }
        bySubject.set(row.subject_id, row.bonus);
      } else {
        out.generalBonusByStudent.set(row.student_id, row.bonus);
      }
    }

    return out;
  }

  async function fetchConductAverageMap(
    from: string,
    to: string,
  ): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    studentIds.forEach((sid) => out.set(sid, null));

    if (!from || !to) return out;

    try {
      const conductSettings = await loadConductSettings(srv, instIdStr);
      const rubricMax = conductSettings.rubric_max;
      const defaultSessionMinutes = await loadDefaultSessionMinutes(
        srv,
        instIdStr,
      );
      const totalMax =
        rubricMax.assiduite +
        rubricMax.tenue +
        rubricMax.moralite +
        rubricMax.discipline;

      let conductPeriodId: string | null = null;
      let conductAcademicYear = String(
        periodMeta.academic_year ||
          academicYearToken ||
          classRow.academic_year ||
          "",
      ).trim();
      let conductPeriodCode = String(
        periodMeta.code || periodCodeToken || "",
      ).trim();

      try {
        const { data: gp } = await srv
          .from("grade_periods")
          .select("id, academic_year, code, short_label, label")
          .eq("institution_id", instIdStr)
          .eq("start_date", from)
          .eq("end_date", to)
          .limit(1)
          .maybeSingle();

        if (gp) {
          conductPeriodId = (gp as any).id ? String((gp as any).id) : null;
          conductAcademicYear = String(
            (gp as any).academic_year || conductAcademicYear || "",
          ).trim();
          conductPeriodCode = String(
            (gp as any).code ||
              (gp as any).short_label ||
              (gp as any).label ||
              conductPeriodCode ||
              "",
          ).trim();
        }
      } catch {
        // non bloquant
      }

      let conductPolicy = await loadInstitutionConductPolicy(srv, instIdStr);
      if (isCSCA) {
        conductPolicy = {
          ...conductPolicy,
          mode: "conduct_plus_subjects",
          classic_conduct_weight: 1,
          missing_subject_strategy: "ignore_missing",
          is_active: true,
          display_label: "Discipline",
          is_csca: true,
        };
      }

      let conductSubjectPolicies: ConductSubjectPolicy[] = [];
      if (conductPolicy.mode === "conduct_plus_subjects") {
        const configuredPolicies = await loadConductSubjectPolicies(
          srv,
          instIdStr,
        );
        const cscaBuiltinPolicies = isCSCA
          ? await loadCSCABuiltinConductSubjectPolicies(srv, instIdStr)
          : [];

        conductSubjectPolicies = isCSCA
          ? mergeConductSubjectPolicies(
              configuredPolicies.filter((policy) =>
                isCSCALatinOrReligionLabel(
                  `${policy.subject_name || ""} ${policy.subject_id || ""}`,
                ),
              ),
              cscaBuiltinPolicies,
            )
          : configuredPolicies;
      }

      const conductSubjectAverageBySubject =
        conductPolicy.mode === "conduct_plus_subjects" &&
        conductSubjectPolicies.length > 0
          ? await loadSubjectAveragesForConductPolicy(srv, {
              classId: classIdStr,
              subjectIds: conductSubjectPolicies.map(
                (policy) => policy.subject_id,
              ),
              studentIds,
              from,
              to,
            })
          : new Map<string, Map<string, number>>();

      const officialTotalMax =
        conductPolicy.mode === "conduct_plus_subjects" ? 20 : totalMax;

      const overridesByStudent = new Map<string, ConductOverride>();
      if (conductAcademicYear && conductPeriodCode && studentIds.length > 0) {
        try {
          const { data: overrideRows } = await srv
            .from("conduct_average_overrides")
            .select(
              "student_id, override_total, calculated_total, reason, updated_at, edited_by",
            )
            .eq("institution_id", instIdStr)
            .eq("class_id", classIdStr)
            .eq("academic_year", conductAcademicYear)
            .eq("period_code", conductPeriodCode)
            .in("student_id", studentIds);

          for (const row of (overrideRows || []) as any[]) {
            const sid = String(row.student_id || "");
            const overrideTotal = Number(row.override_total);
            if (!sid || !Number.isFinite(overrideTotal)) continue;
            overridesByStudent.set(sid, {
              student_id: sid,
              override_total: Number(overrideTotal.toFixed(2)),
              calculated_total:
                row.calculated_total === null ||
                row.calculated_total === undefined
                  ? null
                  : Number(row.calculated_total),
              reason: row.reason ?? null,
              updated_at: row.updated_at ?? null,
              edited_by: row.edited_by ?? null,
            });
          }
        } catch {
          // non bloquant
        }
      }

      const rubricOverridesByStudent = new Map<
        string,
        Partial<Record<ConductRubricKey, ConductRubricOverride>>
      >();
      if (conductAcademicYear && conductPeriodCode && studentIds.length > 0) {
        try {
          const { data: rubricRows } = await srv
            .from("conduct_rubric_overrides")
            .select(
              "student_id, rubric_key, override_value, calculated_value, updated_at, edited_by",
            )
            .eq("institution_id", instIdStr)
            .eq("class_id", classIdStr)
            .eq("academic_year", conductAcademicYear)
            .eq("period_code", conductPeriodCode)
            .in("student_id", studentIds);

          for (const row of (rubricRows || []) as any[]) {
            const sid = String(row.student_id || "");
            const keyRaw = row.rubric_key;
            const overrideValue = Number(row.override_value);
            if (
              !sid ||
              !isConductRubricKey(keyRaw) ||
              !Number.isFinite(overrideValue)
            )
              continue;
            const current = rubricOverridesByStudent.get(sid) || {};
            current[keyRaw] = {
              student_id: sid,
              rubric_key: keyRaw,
              override_value: Number(overrideValue.toFixed(2)),
              calculated_value:
                row.calculated_value === null ||
                row.calculated_value === undefined
                  ? null
                  : Number(row.calculated_value),
              updated_at: row.updated_at ?? null,
              edited_by: row.edited_by ?? null,
            };
            rubricOverridesByStudent.set(sid, current);
          }
        } catch {
          // non bloquant
        }
      }

      const { data: absMarks } = await srv
        .from("v_mark_minutes")
        .select("id, student_id, minutes, started_at")
        .eq("institution_id", instIdStr)
        .eq("class_id", classIdStr)
        .eq("status", "absent")
        .gte("started_at", startISO(from))
        .lte("started_at", endISO(to));

      const absMarkIds = Array.from(
        new Set(
          (absMarks || []).map((m: any) => String(m.id || "")).filter(Boolean),
        ),
      );

      let absReasonById = new Map<string, string | null>();
      if (absMarkIds.length) {
        const { data: marksInfo } = await srv
          .from("attendance_marks")
          .select("id, reason")
          .in("id", absMarkIds);

        absReasonById = new Map(
          (marksInfo || []).map((m: any) => [
            String(m.id),
            (m.reason ?? null) as string | null,
          ]),
        );
      }

      const absAgg = new Map<string, number>();
      const absCountAgg = new Map<string, number>();
      for (const m of absMarks || []) {
        const markId = String((m as any).id || "");
        const reason = String(absReasonById.get(markId) ?? "").trim();
        if (reason) continue;

        const sid = String((m as any).student_id || "");
        const v = Number((m as any).minutes || 0);
        if (!sid || !Number.isFinite(v) || v <= 0) continue;
        absAgg.set(sid, (absAgg.get(sid) || 0) + v);
        absCountAgg.set(sid, (absCountAgg.get(sid) || 0) + 1);
      }

      const tarAgg = new Map<string, number>();
      const tarCountAgg = new Map<string, number>();
      try {
        const { data: tardy } = await srv
          .from("v_tardy_minutes")
          .select("id, student_id, minutes, started_at")
          .eq("institution_id", instIdStr)
          .eq("class_id", classIdStr)
          .gte("started_at", startISO(from))
          .lte("started_at", endISO(to));

        const tarMarkIds = Array.from(
          new Set(
            (tardy || []).map((t: any) => String(t.id || "")).filter(Boolean),
          ),
        );

        let tarReasonById = new Map<string, string | null>();
        if (tarMarkIds.length) {
          const { data: tMarksInfo } = await srv
            .from("attendance_marks")
            .select("id, reason")
            .in("id", tarMarkIds);

          tarReasonById = new Map(
            (tMarksInfo || []).map((m: any) => [
              String(m.id),
              (m.reason ?? null) as string | null,
            ]),
          );
        }

        for (const t of tardy || []) {
          const markId = String((t as any).id || "");
          const reason = String(tarReasonById.get(markId) ?? "").trim();
          if (reason) continue;

          const sid = String((t as any).student_id || "");
          const v = Number((t as any).minutes || 0);
          if (!sid || !Number.isFinite(v) || v <= 0) continue;
          tarAgg.set(sid, (tarAgg.get(sid) || 0) + v);
          tarCountAgg.set(sid, (tarCountAgg.get(sid) || 0) + 1);
        }
      } catch {
        // vue absente -> retards à 0
      }

      type ConductEvent = {
        student_id: string;
        rubric: "assiduite" | "tenue" | "moralite" | "discipline";
        event_type:
          | "uniform_warning"
          | "cheating"
          | "alcohol_or_drug"
          | "discipline_warning"
          | "discipline_offense"
          | "discipline_council";
        occurred_at: string;
      };

      let events: ConductEvent[] = [];
      try {
        let q = srv
          .from("conduct_events")
          .select("student_id,rubric,event_type,occurred_at")
          .eq("institution_id", instIdStr)
          .eq("class_id", classIdStr);
        if (from) q = q.gte("occurred_at", startISO(from));
        if (to) q = q.lte("occurred_at", endISO(to));
        const { data } = await q;
        events = (data || []) as ConductEvent[];
      } catch {
        events = [];
      }

      const byStudent = new Map<string, ConductEvent[]>();
      for (const ev of events) {
        const arr = byStudent.get(ev.student_id) ?? [];
        arr.push(ev);
        byStudent.set(ev.student_id, arr);
      }
      for (const [, arr] of byStudent) {
        arr.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
      }

      type Penalty = {
        student_id: string;
        rubric: "tenue" | "moralite" | "discipline";
        points: number;
        occurred_at: string;
      };

      let penalties: Penalty[] = [];
      try {
        let qpen = srv
          .from("conduct_penalties")
          .select("student_id,rubric,points,occurred_at")
          .eq("institution_id", instIdStr)
          .eq("class_id", classIdStr);
        if (from) qpen = qpen.gte("occurred_at", startISO(from));
        if (to) qpen = qpen.lte("occurred_at", endISO(to));
        const { data } = await qpen;
        const raw = (data || []) as Array<{
          student_id: string;
          rubric: string;
          points: number;
          occurred_at: string;
        }>;
        penalties = raw
          .filter(
            (p) =>
              p.rubric === "tenue" ||
              p.rubric === "moralite" ||
              p.rubric === "discipline",
          )
          .map((p) => ({
            student_id: p.student_id,
            rubric: p.rubric as Penalty["rubric"],
            points: Number(p.points || 0),
            occurred_at: p.occurred_at,
          }));
      } catch {
        penalties = [];
      }

      const penByStudent = new Map<
        string,
        { tenue: number; moralite: number; discipline: number }
      >();
      for (const p of penalties) {
        const cur = penByStudent.get(p.student_id) || {
          tenue: 0,
          moralite: 0,
          discipline: 0,
        };
        (cur as any)[p.rubric] =
          Number((cur as any)[p.rubric] || 0) + Number(p.points || 0);
        penByStudent.set(p.student_id, cur);
      }

      const assRules = conductSettings.rules.assiduite;
      for (const sid of studentIds) {
        const evs = byStudent.get(sid) ?? [];
        const absenceCount = Number(absCountAgg.get(sid) || 0);
        const tardyMinutes = Number(tarAgg.get(sid) || 0);
        const tardyCount = Number(tarCountAgg.get(sid) || 0);

        const absenceUnits = Math.max(0, absenceCount);
        const latenessDivisor = Math.max(
          1,
          assRules.lateness_minutes_per_absent_hour ||
            defaultSessionMinutes ||
            60,
        );

        let effectiveHours = 0;
        if (assRules.lateness_mode === "ignore") {
          effectiveHours = absenceUnits;
        } else if (assRules.lateness_mode === "as_hours") {
          const tardyUnits = Math.floor(tardyMinutes / latenessDivisor);
          effectiveHours = absenceUnits + tardyUnits;
        } else {
          effectiveHours = absenceUnits;
        }

        let assiduite: number;
        if (effectiveHours >= assRules.max_hours_before_zero) {
          assiduite = clampConduct(
            assRules.note_after_threshold,
            0,
            rubricMax.assiduite,
          );
        } else {
          assiduite = clampConduct(
            rubricMax.assiduite - assRules.penalty_per_hour * effectiveHours,
            0,
            rubricMax.assiduite,
          );

          if (
            assRules.lateness_mode === "direct_points" &&
            tardyCount > 0 &&
            assRules.lateness_points_per_late > 0
          ) {
            assiduite = clampConduct(
              assiduite - assRules.lateness_points_per_late * tardyCount,
              0,
              rubricMax.assiduite,
            );
          }
        }

        const tenueWarn = evs.filter(
          (e) => e.event_type === "uniform_warning",
        ).length;
        let tenue = clampConduct(
          rubricMax.tenue -
            conductSettings.rules.tenue.warning_penalty * tenueWarn,
          0,
          rubricMax.tenue,
        );

        const moralN = evs.filter(
          (e) =>
            e.event_type === "cheating" || e.event_type === "alcohol_or_drug",
        ).length;
        let moralite = clampConduct(
          rubricMax.moralite -
            conductSettings.rules.moralite.event_penalty * moralN,
          0,
          rubricMax.moralite,
        );

        const firstWarn = evs.find(
          (e) => e.event_type === "discipline_warning",
        );
        let discN = 0;
        if (firstWarn) {
          discN = evs.filter(
            (e) =>
              e.event_type === "discipline_offense" &&
              e.occurred_at >= firstWarn.occurred_at,
          ).length;
        }
        let discipline = clampConduct(
          rubricMax.discipline -
            conductSettings.rules.discipline.offense_penalty * discN,
          0,
          rubricMax.discipline,
        );

        const p = penByStudent.get(sid) || {
          tenue: 0,
          moralite: 0,
          discipline: 0,
        };
        tenue = clampConduct(tenue - p.tenue, 0, rubricMax.tenue);
        moralite = clampConduct(moralite - p.moralite, 0, rubricMax.moralite);
        discipline = clampConduct(
          discipline - p.discipline,
          0,
          rubricMax.discipline,
        );

        const rubricOverrides = rubricOverridesByStudent.get(sid) || {};
        assiduite = rubricOverrides.assiduite
          ? clampConduct(
              rubricOverrides.assiduite.override_value,
              0,
              rubricMax.assiduite,
            )
          : assiduite;
        tenue = rubricOverrides.tenue
          ? clampConduct(
              rubricOverrides.tenue.override_value,
              0,
              rubricMax.tenue,
            )
          : tenue;
        moralite = rubricOverrides.moralite
          ? clampConduct(
              rubricOverrides.moralite.override_value,
              0,
              rubricMax.moralite,
            )
          : moralite;
        discipline = rubricOverrides.discipline
          ? clampConduct(
              rubricOverrides.discipline.override_value,
              0,
              rubricMax.discipline,
            )
          : discipline;

        let classicTotal = assiduite + tenue + moralite + discipline;
        const hasCouncil = evs.some(
          (e) => e.event_type === "discipline_council",
        );
        if (hasCouncil) {
          classicTotal = Math.min(
            classicTotal,
            conductSettings.rules.discipline.council_cap,
          );
        }

        const automaticConduct = applyInstitutionConductPolicyToStudent({
          studentId: sid,
          classicTotal,
          totalMax,
          conductPolicy,
          subjectPolicies: conductSubjectPolicies,
          subjectAverages: conductSubjectAverageBySubject,
        });

        const calculatedTotal = Number(
          (conductPolicy.mode === "conduct_plus_subjects"
            ? automaticConduct.avg20
            : automaticConduct.total
          ).toFixed(2),
        );

        const override = overridesByStudent.get(sid);
        const rawOverrideTotal = Number(override?.override_total);
        const isOverridden = !!override && Number.isFinite(rawOverrideTotal);
        const finalTotal = isOverridden
          ? Number(
              clampConduct(rawOverrideTotal, 0, officialTotalMax).toFixed(2),
            )
          : calculatedTotal;

        const finalAvg20 =
          officialTotalMax === 20
            ? finalTotal
            : normalizeScoreTo20(finalTotal, officialTotalMax);

        out.set(sid, cleanNumber(finalAvg20, 4));
      }
    } catch {
      // silencieux
    }

    return out;
  }

  const conductAvgMapCurrent =
    dateFrom && dateTo
      ? await fetchConductAverageMap(dateFrom, dateTo)
      : new Map<string, number | null>();

  const conductByPeriodKey = new Map<string, Map<string, number | null>>();
  if (shouldComputeAnnual && Array.isArray(yearPeriods) && yearPeriods.length) {
    for (const p of yearPeriods) {
      const ps = p?.start_date ? String(p.start_date) : null;
      const pe = p?.end_date ? String(p.end_date) : null;
      if (!ps || !pe) continue;
      const key = `${ps}|${pe}`;
      if (conductByPeriodKey.has(key)) continue;
      conductByPeriodKey.set(key, await fetchConductAverageMap(ps, pe));
    }
  }

  const currentBonusMaps = await loadAdjustmentBonusMaps({
    academicYear:
      periodMeta.academic_year ??
      academicYearToken ??
      classRow.academic_year ??
      null,
    periodId: periodMeta.id ?? null,
  });

  const { data: coeffAllData } = await srv
    .from("institution_subject_coeffs")
    .select("subject_id, coeff, include_in_average, level")
    .eq("institution_id", instIdStr);

  const coeffBySubject = new Map<string, { coeff: number; include: boolean }>();
  const subjectIdsFromConfig = new Set<string>();
  const coeffRowsBySubject = new Map<string, SubjectCoeffRow[]>();

  for (const row of (coeffAllData || []) as SubjectCoeffRow[]) {
    const sid = String(row.subject_id || "");
    if (!sid || !isUuid(sid)) continue;

    subjectIdsFromConfig.add(sid);

    const arr = coeffRowsBySubject.get(sid) || [];
    arr.push(row);
    coeffRowsBySubject.set(sid, arr);
  }

  for (const [sid, rows] of coeffRowsBySubject.entries()) {
    const best = pickBestCoeffRow(rows, coeffLevelCandidates);
    if (!best) continue;

    coeffBySubject.set(sid, {
      coeff: cleanCoeff(best.coeff),
      include: best.include_in_average !== false,
    });
  }

  const subjectGradePolicyBySubject = new Map<
    string,
    {
      includeInGeneralAverage: boolean | null;
      includeInConductAverage: boolean;
      conductWeight: number;
    }
  >();

  try {
    const { data: policyData, error: policyErr } = await srv
      .from("institution_subject_grade_policies")
      .select(
        "subject_id, include_in_general_average, include_in_conduct_average, conduct_weight, is_active",
      )
      .eq("institution_id", instIdStr)
      .eq("is_active", true);

    if (!policyErr && policyData?.length) {
      for (const row of policyData as SubjectGradePolicyRow[]) {
        const sid = String(row.subject_id || "");
        if (!sid || !isUuid(sid)) continue;

        const includeInGeneralAverage =
          typeof row.include_in_general_average === "boolean"
            ? row.include_in_general_average
            : null;

        const conductWeightRaw = Number(row.conduct_weight ?? 1);
        const conductWeight =
          Number.isFinite(conductWeightRaw) && conductWeightRaw > 0
            ? conductWeightRaw
            : 1;

        subjectGradePolicyBySubject.set(sid, {
          includeInGeneralAverage,
          includeInConductAverage: row.include_in_conduct_average === true,
          conductWeight,
        });

        if (includeInGeneralAverage !== null) {
          const existing = coeffBySubject.get(sid);
          coeffBySubject.set(sid, {
            coeff: existing ? existing.coeff : 1,
            include: includeInGeneralAverage,
          });
        }
      }
    }
  } catch {
    // non bloquant : l'ancien comportement reste disponible
  }

  const shouldIncludeSubjectInGeneralAverage = (
    subjectId: string,
    fallback: boolean,
  ): boolean => {
    const policy = subjectGradePolicyBySubject.get(String(subjectId));
    if (policy && typeof policy.includeInGeneralAverage === "boolean") {
      return policy.includeInGeneralAverage;
    }
    return fallback;
  };

  let evals: EvalRow[] = [];
  {
    let evalQuery = srv
      .from("grade_evaluations")
      .select(
        "id, class_id, subject_id, teacher_id, eval_date, scale, coeff, is_published, subject_component_id",
      )
      .eq("class_id", classIdStr)
      .eq("is_published", true);

    if (dateFrom) evalQuery = evalQuery.gte("eval_date", dateFrom);
    if (dateTo) evalQuery = evalQuery.lte("eval_date", dateTo);

    const { data: evalData, error: evalErr } = await evalQuery;

    if (evalErr) {
      return NextResponse.json(
        { ok: false, error: "EVALUATIONS_ERROR" },
        { status: 500 },
      );
    }

    evals = (evalData || []) as EvalRow[];
  }

  const subjectIdSet = new Set<string>();
  for (const e of evals)
    if (e.subject_id) subjectIdSet.add(String(e.subject_id));

  const assignedSubjectIds = new Set<string>();
  {
    let ctQuery = srv
      .from("class_teachers")
      .select("subject_id, start_date, end_date")
      .eq("institution_id", instIdStr)
      .eq("class_id", classIdStr);

    const pivot = dateTo || dateFrom || null;
    if (pivot) {
      ctQuery = ctQuery
        .or(`end_date.is.null,end_date.gte.${pivot}`)
        .or(`start_date.is.null,start_date.lte.${pivot}`);
    } else {
      ctQuery = ctQuery.is("end_date", null);
    }

    const { data: ctData, error: ctErr } = await ctQuery;

    if (!ctErr && ctData?.length) {
      const instSubjectIds = Array.from(
        new Set(
          (ctData as any[])
            .map((row) => String(row.subject_id || ""))
            .filter((id) => !!id && isUuid(id)),
        ),
      );

      if (instSubjectIds.length) {
        const { data: instSubData, error: instSubErr } = await srv
          .from("institution_subjects")
          .select("id, subject_id")
          .eq("institution_id", instIdStr)
          .in("id", instSubjectIds);

        if (!instSubErr && instSubData?.length) {
          (instSubData as any[]).forEach((row) => {
            const sid = String(row.subject_id || "");
            if (sid && isUuid(sid)) assignedSubjectIds.add(sid);
          });
        }
      }
    }
  }

  const hasAssignedSubjectsForClass = assignedSubjectIds.size > 0;

  const subjectIdsUnionRaw = Array.from(
    new Set([
      ...Array.from(subjectIdsFromConfig),
      ...Array.from(subjectIdSet),
      ...Array.from(assignedSubjectIds),
    ]),
  );
  const subjectIds = subjectIdsUnionRaw.filter((sid) => isUuid(sid));

  if (!subjectIds.length) {
    return NextResponse.json({
      ok: true,
      mode,
      institution: institutionResponseMeta,
      class: classResponseMeta,
      student: {
        id: stu.id,
        full_name:
          [stu.last_name, stu.first_name].filter(Boolean).join(" ") ||
          stu.full_name ||
          null,
        matricule: stu.matricule || null,
        photo_url: null,
        gender: stu.gender || null,
        birth_date: stu.birthdate || null,
        birth_place: stu.birth_place || null,
        nationality: stu.nationality || null,
        regime: stu.regime || null,
        is_repeater: stu.is_repeater ?? null,
        is_boarder: stu.is_boarder ?? null,
        is_affecte: stu.is_affecte ?? null,
        per_subject: [],
        per_group: [],
        general_avg: null,
        per_subject_components: [],
      },
    });
  }

  const { data: subjData, error: subjErr } = await srv
    .from("subjects")
    .select("id, name, code")
    .in("id", subjectIds)
    .order("name", { ascending: true });

  if (subjErr) {
    return NextResponse.json(
      { ok: false, error: "SUBJECTS_ERROR" },
      { status: 500 },
    );
  }

  const subjects = (subjData || []) as SubjectRow[];
  const subjectById = new Map<string, SubjectRow>();
  for (const s of subjects) subjectById.set(s.id, s);

  const isCSCADisciplineComponentSubjectId = (subjectId: string): boolean => {
    if (!isCSCA) return false;
    const meta = subjectById.get(String(subjectId));
    const key = normalizeAsciiToken(`${meta?.code ?? ""} ${meta?.name ?? ""}`);
    return key.includes("discipline");
  };

  const orderedSubjectIds = subjects
    .map((s) => s.id)
    .filter((sid) => {
      if (!isUuid(sid)) return false;
      if (isCSCADisciplineComponentSubjectId(sid)) return false;
      if (!hasAssignedSubjectsForClass) return true;
      if (assignedSubjectIds.has(sid)) return true;

      const meta = subjectById.get(String(sid));
      if (isConductSubject(meta?.name, meta?.code)) return true;
      return false;
    });

  const subjectsForReport = orderedSubjectIds.map((sid) => {
    const s = subjectById.get(sid);
    const name = s?.name || s?.code || "Matière";
    const info = coeffBySubject.get(sid);
    const coeffBulletin = info ? info.coeff : 1;

    const isCSCAConductComponentOnly =
      isCSCA && isCSCALatinOrReligionSubjectMeta(s);
    const includeInAverage = isCSCAConductComponentOnly
      ? false
      : shouldIncludeSubjectInGeneralAverage(sid, info ? info.include : true);

    return {
      subject_id: sid,
      subject_name: name,
      coeff_bulletin: coeffBulletin,
      include_in_average: includeInAverage,
      is_conduct_component_only: isCSCAConductComponentOnly,
    };
  });

  for (const s of subjectsForReport as any[]) {
    const meta = subjectById.get(String(s.subject_id));
    const key = normalizeAsciiToken(`${meta?.code ?? ""} ${meta?.name ?? ""}`);
    if (key.includes("conduite") || key.includes("conduct")) {
      s.include_in_average = true;
      const c = Number(s.coeff_bulletin ?? 0);
      if (!c || c <= 0) s.coeff_bulletin = 1;
    }
  }

  const conductSubjectIds = new Set<string>();
  for (const s of subjectsForReport) {
    const meta = subjectById.get(String(s.subject_id));
    const subjectName = s.subject_name ?? meta?.name ?? null;
    const subjectCode = meta?.code ?? null;

    if (isConductSubject(subjectName, subjectCode)) {
      conductSubjectIds.add(String(s.subject_id));
    }
  }

  let subjectComponentsForReport: BulletinSubjectComponent[] = [];
  const subjectComponentById = new Map<string, BulletinSubjectComponent>();
  const compsBySubject = new Map<string, BulletinSubjectComponent[]>();

  const { data: compData } = allowSubjectComponents
    ? await srv
        .from("grade_subject_components")
        .select(
          "id, subject_id, label, short_label, coeff_in_subject, order_index, is_active, level",
        )
        .eq("institution_id", instIdStr)
        .in("subject_id", orderedSubjectIds)
    : ({ data: null } as any);

  if (allowSubjectComponents && compData) {
    const rawRows = ((compData || []) as any[])
      .filter((r) => r.is_active !== false)
      .map((r: any) => ({
        id: String(r.id),
        subject_id: String(r.subject_id),
        label: (r.label as string) || "Sous-matière",
        short_label: r.short_label ? String(r.short_label) : null,
        coeff_in_subject: cleanCoeff(
          r.coeff_in_subject !== null && r.coeff_in_subject !== undefined
            ? Number(r.coeff_in_subject)
            : 1,
        ),
        order_index:
          r.order_index !== null && r.order_index !== undefined
            ? Number(r.order_index)
            : 1,
        level: r.level ? String(r.level) : null,
      }));

    const rawBySubject = new Map<string, any[]>();
    for (const row of rawRows) {
      const arr = rawBySubject.get(row.subject_id) || [];
      arr.push(row);
      rawBySubject.set(row.subject_id, arr);
    }

    const finalRows: BulletinSubjectComponent[] = [];

    for (const sid of orderedSubjectIds) {
      const chosen = pickBestComponentRows(
        rawBySubject.get(sid) || [],
        coeffLevelCandidates,
      );

      chosen.sort((a, b) => {
        return (a.order_index ?? 1) - (b.order_index ?? 1);
      });

      for (const row of chosen) {
        finalRows.push({
          id: row.id,
          subject_id: row.subject_id,
          label: row.label,
          short_label: row.short_label,
          coeff_in_subject: row.coeff_in_subject,
          order_index: row.order_index,
        });
      }
    }

    subjectComponentsForReport = finalRows;
    finalRows.forEach((c) => {
      subjectComponentById.set(c.id, c);
      const arr = compsBySubject.get(c.subject_id) || [];
      arr.push(c);
      compsBySubject.set(c.subject_id, arr);
    });
  }

  let subjectGroups: BulletinSubjectGroup[] = [];
  const subjectInfoById = new Map<string, { name: string; code: string }>();
  subjects.forEach((s) =>
    subjectInfoById.set(s.id, { name: s.name ?? "", code: s.code ?? "" }),
  );

  if (coeffLevelCandidates.length) {
    const { data: groupsData } = await srv
      .from("bulletin_subject_groups")
      .select(
        "id, level, label, order_index, is_active, code, short_label, annual_coeff",
      )
      .eq("institution_id", instIdStr)
      .order("order_index", { ascending: true });

    if (groupsData && groupsData.length) {
      const allActiveGroups = (groupsData as any[]).filter(
        (g) => g.is_active !== false,
      );
      let activeGroups: any[] = [];

      for (const wantedLevel of coeffLevelCandidates) {
        const wanted = normalizeStoredLevel(wantedLevel);
        const matching = allActiveGroups.filter(
          (g) => normalizeStoredLevel(g.level) === wanted,
        );
        if (matching.length) {
          activeGroups = matching;
          break;
        }
      }

      if (activeGroups.length) {
        const groupIds = activeGroups.map((g) => String(g.id));

        const { data: itemsData } = await srv
          .from("bulletin_subject_group_items")
          .select("id, group_id, subject_id, created_at")
          .in("group_id", groupIds);

        const rawItems = (itemsData || []) as any[];

        rawItems.sort((a, b) => {
          const ag = String(a.group_id || "");
          const bg = String(b.group_id || "");
          if (ag !== bg) return ag.localeCompare(bg);
          const ac = String(a.created_at || "");
          const bc = String(b.created_at || "");
          return ac.localeCompare(bc);
        });

        const itemsByGroup = new Map<string, any[]>();
        rawItems.forEach((row) => {
          const gId = String(row.group_id);
          const arr = itemsByGroup.get(gId) || [];
          arr.push(row);
          itemsByGroup.set(gId, arr);
        });

        const builtGroups: BulletinSubjectGroup[] = activeGroups.map(
          (g: any) => {
            const rows = itemsByGroup.get(String(g.id)) || [];
            const items: BulletinSubjectGroupItem[] = rows.flatMap(
              (row: any, idx: number) => {
                const sid = row.subject_id ? String(row.subject_id) : "";
                if (!sid || !isUuid(sid)) return [];
                if (!orderedSubjectIds.includes(sid)) return [];

                const meta = subjectInfoById.get(sid) || { name: "", code: "" };
                const subjectName = meta.name || meta.code || "Matière";

                return [
                  {
                    id: String(row.id),
                    group_id: String(row.group_id),
                    subject_id: sid,
                    subject_name: subjectName,
                    order_index: idx + 1,
                    subject_coeff_override: null,
                    is_optional: false,
                  },
                ];
              },
            );

            const annualCoeffRaw =
              g.annual_coeff !== null && g.annual_coeff !== undefined
                ? Number(g.annual_coeff)
                : 1;

            const groupCode =
              g.code && String(g.code).trim() !== ""
                ? String(g.code)
                : String(g.label);

            const shortLabel =
              g.short_label && String(g.short_label).trim() !== ""
                ? String(g.short_label)
                : null;

            return {
              id: String(g.id),
              code: groupCode,
              label: String(g.label),
              short_label: shortLabel,
              order_index: Number(g.order_index ?? 1),
              is_active: g.is_active !== false,
              annual_coeff: cleanCoeff(annualCoeffRaw),
              items,
            };
          },
        );

        const gLetters = findGroupByMeaning(builtGroups, "LETTRES");
        const gSciences = findGroupByMeaning(builtGroups, "SCIENCES");
        const gAutres = findGroupByMeaning(builtGroups, "AUTRES");

        const chosenGroupIdBySubject = new Map<string, string>();
        const firstSeenOrder = new Map<string, number>();

        const groupOrder = builtGroups
          .slice()
          .sort((a, b) => a.order_index - b.order_index)
          .map((g) => g.id);

        const groupById = new Map<string, BulletinSubjectGroup>();
        builtGroups.forEach((g) => groupById.set(g.id, g));

        function desiredGroupIdForSubject(sid: string): string | null {
          const meta = subjectInfoById.get(sid) || { name: "", code: "" };
          const name = meta.name;
          const code = meta.code;

          if (isScienceSubject(name, code) && gSciences?.id)
            return gSciences.id;
          if (isLettersSubject(name, code) && gLetters?.id) return gLetters.id;

          if (gAutres?.id) return gAutres.id;

          return gLetters?.id ?? gSciences?.id ?? null;
        }

        for (const gid of groupOrder) {
          const g = groupById.get(gid);
          if (!g) continue;
          for (const it of g.items) {
            const sid = it.subject_id;
            if (!isUuid(sid)) continue;
            if (!firstSeenOrder.has(sid))
              firstSeenOrder.set(sid, it.order_index);
            if (!chosenGroupIdBySubject.has(sid))
              chosenGroupIdBySubject.set(sid, g.id);
          }
        }

        for (const sid of chosenGroupIdBySubject.keys()) {
          const desired = desiredGroupIdForSubject(sid);
          if (desired) chosenGroupIdBySubject.set(sid, desired);
        }

        const rebuilt = builtGroups.map((g) => ({
          ...g,
          items: [] as BulletinSubjectGroupItem[],
        }));
        const rebuiltById = new Map<string, BulletinSubjectGroup>();
        rebuilt.forEach((g) => rebuiltById.set(g.id, g));

        for (const [sid, gid] of chosenGroupIdBySubject.entries()) {
          const target = rebuiltById.get(gid);
          if (!target) continue;

          const meta = subjectInfoById.get(sid) || { name: "", code: "" };
          const subjectName = meta.name || meta.code || "Matière";

          target.items.push({
            id: `virt-${sid}`,
            group_id: gid,
            subject_id: sid,
            subject_name: subjectName,
            order_index: firstSeenOrder.get(sid) ?? 9999,
            subject_coeff_override: null,
            is_optional: false,
          });
        }

        rebuilt.forEach((g) => {
          g.items.sort((a, b) => a.order_index - b.order_index);
          g.items = g.items.map((it, idx) => ({ ...it, order_index: idx + 1 }));
          g.annual_coeff = computeGroupAnnualCoeff(g, coeffBySubject);
        });

        subjectGroups = rebuilt;
      }
    }
  }

  if (!subjectGroups.length) {
    subjectGroups = buildFallbackGroups({
      subjectIds: orderedSubjectIds,
      subjectInfoById,
      coeffBySubject,
      educationType: educationContext.educationType,
    });
  }

  const hasGroupConfig = subjectGroups.length > 0;

  const evalById = new Map<string, EvalRow>();
  for (const e of evals) evalById.set(e.id, e);

  const studentIdsInClass = classStudents
    .map((cs) => cs.student_id)
    .filter(Boolean);

  async function loadOfficialScoreRowsForEvalIds(
    evalIds: string[],
  ): Promise<ScoreRow[]> {
    if (!evalIds.length || !studentIdsInClass.length) return [];

    const PAGE_SIZE = 1000;
    const byKey = new Map<string, ScoreRow>();

    const ingest = (rows: any[] | null | undefined, prefer: boolean) => {
      for (const row of rows || []) {
        const evaluationId = String(row?.evaluation_id || "");
        const sid = String(row?.student_id || "");
        if (!evaluationId || !sid) continue;

        const key = `${evaluationId}__${sid}`;
        if (!prefer && byKey.has(key)) continue;

        byKey.set(key, {
          evaluation_id: evaluationId,
          student_id: sid,
          score:
            row?.score === null || row?.score === undefined
              ? null
              : Number(row.score),
        });
      }
    };

    async function fetchDirectPublishedScores(): Promise<{
      rows: any[];
      error: any | null;
    }> {
      const rows: any[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await srv
          .from("grade_published_scores")
          .select("evaluation_id, student_id, score")
          .eq("institution_id", instIdStr)
          .eq("class_id", classIdStr)
          .eq("is_current", true)
          .in("evaluation_id", evalIds)
          .in("student_id", studentIdsInClass)
          .order("evaluation_id", { ascending: true })
          .order("student_id", { ascending: true })
          .range(from, to);

        if (error) return { rows, error };
        const chunk = (data || []) as any[];
        rows.push(...chunk);
        if (chunk.length < PAGE_SIZE) break;
      }
      return { rows, error: null };
    }

    async function fetchViewOfficialScores(): Promise<{
      rows: any[];
      error: any | null;
    }> {
      const rows: any[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const to = from + PAGE_SIZE - 1;
        const { data, error } = await srv
          .from("v_grade_scores_official_for_reports")
          .select("evaluation_id, student_id, score")
          .in("evaluation_id", evalIds)
          .in("student_id", studentIdsInClass)
          .order("evaluation_id", { ascending: true })
          .order("student_id", { ascending: true })
          .range(from, to);

        if (error) return { rows, error };
        const chunk = (data || []) as any[];
        rows.push(...chunk);
        if (chunk.length < PAGE_SIZE) break;
      }
      return { rows, error: null };
    }

    const direct = await fetchDirectPublishedScores();
    if (!direct.error) ingest(direct.rows, true);

    const fromView = await fetchViewOfficialScores();
    if (!fromView.error) ingest(fromView.rows, false);

    if (!byKey.size && direct.error && fromView.error) {
      throw fromView.error || direct.error;
    }

    return Array.from(byKey.values());
  }

  let scores: ScoreRow[] = [];
  if (evals.length) {
    const evalIds = evals.map((e) => e.id);

    try {
      scores = await loadOfficialScoreRowsForEvalIds(evalIds);
    } catch {
      return NextResponse.json(
        { ok: false, error: "SCORES_ERROR" },
        { status: 500 },
      );
    }
  }

  const perStudentSubject = new Map<
    string,
    Map<string, { sumWeighted: number; sumCoeff: number }>
  >();
  const perStudentSubjectComponent = new Map<
    string,
    Map<string, { subject_id: string; sumWeighted: number; sumCoeff: number }>
  >();

  for (const sc of scores) {
    const ev = evalById.get(sc.evaluation_id);
    if (!ev) continue;
    if (!ev.subject_id) continue;
    if (!ev.scale || ev.scale <= 0) continue;
    if (sc.score === null || sc.score === undefined) continue;

    const score = Number(sc.score);
    if (!Number.isFinite(score)) continue;

    const norm20 = (score / ev.scale) * 20;
    const weight = ev.coeff ?? 1;

    let stuMap = perStudentSubject.get(sc.student_id);
    if (!stuMap) {
      stuMap = new Map();
      perStudentSubject.set(sc.student_id, stuMap);
    }
    const key = ev.subject_id;
    const cell = stuMap.get(key) || { sumWeighted: 0, sumCoeff: 0 };
    cell.sumWeighted += norm20 * weight;
    cell.sumCoeff += weight;
    stuMap.set(key, cell);

    if (ev.subject_component_id) {
      const comp = subjectComponentById.get(String(ev.subject_component_id));
      if (comp) {
        let stuCompMap = perStudentSubjectComponent.get(sc.student_id);
        if (!stuCompMap) {
          stuCompMap = new Map();
          perStudentSubjectComponent.set(sc.student_id, stuCompMap);
        }
        const compCell = stuCompMap.get(comp.id) || {
          subject_id: comp.subject_id,
          sumWeighted: 0,
          sumCoeff: 0,
        };
        compCell.sumWeighted += norm20 * weight;
        compCell.sumCoeff += weight;
        stuCompMap.set(comp.id, compCell);
      }
    }
  }

  const items = classStudents.map((cs) => {
    const stuLocal = cs.students || {};
    const fullName =
      [stuLocal.last_name, stuLocal.first_name].filter(Boolean).join(" ") ||
      stuLocal.full_name ||
      "Élève";

    const stuMap =
      perStudentSubject.get(cs.student_id) ||
      new Map<string, { sumWeighted: number; sumCoeff: number }>();

    const stuCompMap =
      perStudentSubjectComponent.get(cs.student_id) ||
      new Map<
        string,
        { subject_id: string; sumWeighted: number; sumCoeff: number }
      >();

    const per_subject_components =
      subjectComponentsForReport.length === 0
        ? []
        : subjectComponentsForReport.map((comp) => {
            const cell = stuCompMap.get(comp.id);
            let avg20: number | null = null;
            if (cell && cell.sumCoeff > 0) {
              avg20 = cleanNumber(cell.sumWeighted / cell.sumCoeff, 4);
            }
            return {
              subject_id: comp.subject_id,
              component_id: comp.id,
              avg20,
            };
          });

    const per_subject = subjectsForReport.map((s) => {
      const comps = compsBySubject.get(s.subject_id) || [];

      let avg20: number | null = null;

      if (comps.length) {
        let sum = 0;
        let sumW = 0;

        for (const comp of comps) {
          const cell = stuCompMap.get(comp.id);
          if (!cell || cell.sumCoeff <= 0) continue;

          const compAvgRaw = cell.sumWeighted / cell.sumCoeff;
          if (!Number.isFinite(compAvgRaw)) continue;

          const w = comp.coeff_in_subject ?? 1;
          if (!w || w <= 0) continue;

          sum += compAvgRaw * w;
          sumW += w;
        }

        if (sumW > 0) {
          avg20 = cleanNumber(sum / sumW, 4);
        }
      }

      if (avg20 === null) {
        const cell = stuMap.get(s.subject_id);
        if (cell && cell.sumCoeff > 0) {
          avg20 = cleanNumber(cell.sumWeighted / cell.sumCoeff, 4);
        }
      }

      const rawAvg20 = avg20;
      const subjectBonus =
        currentBonusMaps.subjectBonusByStudent
          .get(cs.student_id)
          ?.get(String(s.subject_id)) ?? 0;

      if (
        avg20 !== null &&
        avg20 !== undefined &&
        Number.isFinite(Number(avg20))
      ) {
        const adjusted = clampAverage20(Number(avg20) + subjectBonus);
        avg20 = adjusted === null ? null : cleanNumber(adjusted, 4);
      }

      return {
        subject_id: s.subject_id,
        avg20,
        bonus: Number(subjectBonus.toFixed(2)),
        avg20_before_bonus: rawAvg20,
      };
    });

    let per_group: {
      group_id: string;
      group_avg: number | null;
    }[] = [];

    if (hasGroupConfig) {
      const coeffBulletinBySubject = new Map<string, number>();
      subjectsForReport.forEach((s) =>
        coeffBulletinBySubject.set(s.subject_id, Number(s.coeff_bulletin ?? 1)),
      );

      per_group = subjectGroups.map((g) => {
        let sum = 0;
        let sumCoeffLocal = 0;

        for (const it of g.items) {
          const sid = it.subject_id;

          const ps = per_subject.find((x) => x.subject_id === sid);
          const subAvg = ps?.avg20 ?? null;
          if (subAvg === null || subAvg === undefined) continue;

          const officialCoeff = Number(coeffBulletinBySubject.get(sid) ?? 0);
          const overrideCoeff = Number(it.subject_coeff_override ?? NaN);
          const w =
            Number.isFinite(officialCoeff) && officialCoeff > 0
              ? officialCoeff
              : Number.isFinite(overrideCoeff) && overrideCoeff > 0
                ? overrideCoeff
                : 1;

          if (!w || w <= 0) continue;

          sum += Number(subAvg) * w;
          sumCoeffLocal += w;
        }

        const groupAvg =
          sumCoeffLocal > 0 ? cleanNumber(sum / sumCoeffLocal, 4) : null;

        return {
          group_id: g.id,
          group_avg: groupAvg,
        };
      });
    }

    let general_avg: number | null = null;
    let generalAvgBeforeBonus: number | null = null;
    const generalBonus =
      currentBonusMaps.generalBonusByStudent.get(cs.student_id) ?? 0;

    {
      let sumGen = 0;
      let sumCoeffGen = 0;
      let conductAlreadyCounted = false;
      let hasAcademicMatterAverage = false;

      for (const s of subjectsForReport) {
        if (s.include_in_average === false) continue;
        const coeffSub = Number(s.coeff_bulletin ?? 0);
        if (!coeffSub || coeffSub <= 0) continue;

        const ps = per_subject.find((x) => x.subject_id === s.subject_id);
        const subAvg = ps?.avg20 ?? null;
        if (subAvg === null || subAvg === undefined) continue;

        const isConductRow = conductSubjectIds.has(String(s.subject_id));
        if (isConductRow) {
          conductAlreadyCounted = true;
        } else {
          hasAcademicMatterAverage = true;
        }

        sumGen += Number(subAvg) * coeffSub;
        sumCoeffGen += coeffSub;
      }

      if (hasAcademicMatterAverage) {
        const conductNote = conductAvgMapCurrent.get(cs.student_id) ?? null;
        if (
          !conductAlreadyCounted &&
          conductNote !== null &&
          conductNote !== undefined
        ) {
          const c = Number(conductNote);
          if (Number.isFinite(c)) {
            sumGen += c * 1;
            sumCoeffGen += 1;
          }
        }

        generalAvgBeforeBonus =
          sumCoeffGen > 0 ? cleanNumber(sumGen / sumCoeffGen, 4) : null;

        if (generalAvgBeforeBonus !== null) {
          const adjusted = clampAverage20(generalAvgBeforeBonus + generalBonus);
          general_avg = adjusted === null ? null : cleanNumber(adjusted, 4);
        } else {
          general_avg = null;
        }
      } else {
        general_avg = null;
      }
    }

    return {
      student_id: cs.student_id,
      full_name: fullName,
      matricule: stuLocal.matricule || null,
      photo_url: null,
      gender: stuLocal.gender || null,
      birth_date: stuLocal.birthdate || null,
      birth_place: stuLocal.birth_place || null,
      nationality: stuLocal.nationality || null,
      regime: stuLocal.regime || null,
      is_repeater: stuLocal.is_repeater ?? null,
      is_boarder: stuLocal.is_boarder ?? null,
      is_affecte: stuLocal.is_affecte ?? null,
      per_subject,
      per_group,
      general_avg,
      general_bonus: Number(generalBonus.toFixed(2)),
      general_avg_before_bonus: generalAvgBeforeBonus,
      per_subject_components,
    };
  });

  applySubjectRanks(items);
  applySubjectComponentRanks(items);

  const bulletinForStudent = items.find((it) => it.student_id === studentIdStr);

  if (!bulletinForStudent) {
    return NextResponse.json(
      { ok: false, error: "STUDENT_NOT_IN_CLASS_FOR_PERIOD" },
      { status: 404 },
    );
  }

  const snap = (payload as any)?.s ?? null;
  const snapGeneral =
    snap && typeof snap.g === "number" ? cleanNumber(snap.g, 4) : null;
  const snapAnnual =
    snap && typeof snap.a === "number" ? cleanNumber(snap.a, 4) : null;
  const snapConduct =
    snap && typeof snap.c === "number" ? cleanNumber(snap.c, 4) : null;
  const snapRank =
    snap && snap.r !== null && snap.r !== undefined && Number.isFinite(Number(snap.r))
      ? Number(snap.r)
      : null;
  const snapAnnualRank =
    snap && snap.ar !== null && snap.ar !== undefined && Number.isFinite(Number(snap.ar))
      ? Number(snap.ar)
      : null;
  const snapSubjects = snap && Array.isArray(snap.subjects) ? snap.subjects : null;
  const snapSubjectGroups =
    snap && Array.isArray(snap.subject_groups) ? snap.subject_groups : null;
  const snapSubjectComponents =
    snap && Array.isArray(snap.subject_components) ? snap.subject_components : null;
  const snapPerSubject =
    snap && Array.isArray(snap.per_subject) ? snap.per_subject : null;
  const snapPerGroup =
    snap && Array.isArray(snap.per_group) ? snap.per_group : null;
  const snapPerSubjectComponents =
    snap && Array.isArray(snap.per_subject_components)
      ? snap.per_subject_components
      : null;
  const snapPreviousPeriodAvgs =
    snap && Array.isArray(snap.previous_period_avgs)
      ? snap.previous_period_avgs
      : null;

  const recomputedGeneralAvg = cleanNumber(
    (bulletinForStudent as any).general_avg,
    4,
  );
  if (snapGeneral !== null) {
    (bulletinForStudent as any).qr_snapshot_general_avg = snapGeneral;
  }

  // Source de vérité publique : la moyenne officielle figée au moment
  // de la génération du bulletin.
  // Le recalcul public reste utile pour le détail, mais il ne doit pas
  // remplacer la moyenne imprimée/QR, sinon une divergence peut apparaître
  // dès qu'une règle métier spécifique (ex. CSCA conduite) diffère.
  if (snapGeneral !== null) {
    (bulletinForStudent as any).recomputed_general_avg = recomputedGeneralAvg;
    (bulletinForStudent as any).general_avg = snapGeneral;
    (bulletinForStudent as any).general_avg_source = "qr_snapshot_official";
  } else if (recomputedGeneralAvg !== null) {
    (bulletinForStudent as any).general_avg = recomputedGeneralAvg;
    (bulletinForStudent as any).general_avg_source = "recomputed_official";
  }

  if (snapRank !== null) {
    (bulletinForStudent as any).rank = snapRank;
  }
  if (snapPerSubject) {
    (bulletinForStudent as any).per_subject = snapPerSubject;
  }
  if (snapPerGroup) {
    (bulletinForStudent as any).per_group = snapPerGroup;
  }
  if (snapPerSubjectComponents) {
    (bulletinForStudent as any).per_subject_components = snapPerSubjectComponents;
  }
  if (snapPreviousPeriodAvgs) {
    (bulletinForStudent as any).previous_period_avgs = snapPreviousPeriodAvgs;
  }

  let annual_avg_for_student: number | null = null;

  if (shouldComputeAnnual && yearPeriods.length && dateFrom && dateTo) {
    let sumWeightedPeriods = 0;
    let sumCoeffPeriods = 0;

    for (const p of yearPeriods) {
      const pStart = p?.start_date ? String(p.start_date) : null;
      const pEnd = p?.end_date ? String(p.end_date) : null;
      if (!pStart || !pEnd) continue;

      const coeffPeriod =
        p?.coeff === null || p?.coeff === undefined ? 1 : Number(p.coeff);
      if (!Number.isFinite(coeffPeriod) || coeffPeriod <= 0) continue;

      let periodAvg: number | null = null;

      if (pStart === dateFrom && pEnd === dateTo) {
        periodAvg = bulletinForStudent.general_avg ?? null;
      } else {
        const key = `${pStart}|${pEnd}`;
        const conductNote =
          conductByPeriodKey.get(key)?.get(studentIdStr) ?? null;

        const periodBonusMaps = await loadAdjustmentBonusMaps({
          academicYear:
            yearForAnnual ??
            periodMeta.academic_year ??
            academicYearToken ??
            classRow.academic_year ??
            null,
          periodId: p?.id ? String(p.id) : null,
        });

        periodAvg = await computeStudentGeneralAvgForRange({
          srv,
          classId: classIdStr,
          studentId: studentIdStr,
          from: pStart,
          to: pEnd,
          conductAvg20: conductNote,
          subjectsForReport,
          conductSubjectIds,
          subjectComponentsBySubject: compsBySubject,
          subjectComponentById,
          bonusMaps: periodBonusMaps,
        });
      }

      if (periodAvg === null) continue;

      sumWeightedPeriods += periodAvg * coeffPeriod;
      sumCoeffPeriods += coeffPeriod;
    }

    if (sumCoeffPeriods > 0) {
      annual_avg_for_student = cleanNumber(
        sumWeightedPeriods / sumCoeffPeriods,
        4,
      );
    }
  }

  const recomputedAnnualAvg = cleanNumber(annual_avg_for_student, 4);
  if (snapAnnual !== null) {
    (bulletinForStudent as any).qr_snapshot_annual_avg = snapAnnual;
  }

  if (snapAnnual !== null) {
    (bulletinForStudent as any).recomputed_annual_avg = recomputedAnnualAvg;
    (bulletinForStudent as any).annual_avg = snapAnnual;
    (bulletinForStudent as any).annual_avg_source = "qr_snapshot_official";
  } else if (recomputedAnnualAvg !== null) {
    (bulletinForStudent as any).annual_avg = recomputedAnnualAvg;
    (bulletinForStudent as any).annual_avg_source = "recomputed_official";
  }

  if (snapAnnualRank !== null) {
    (bulletinForStudent as any).annual_rank = snapAnnualRank;
  }

  function deriveConductAvgFromOfficialGeneral(): number | null {
    const officialGeneral = cleanNumber((bulletinForStudent as any)?.general_avg, 4);
    if (officialGeneral === null) return null;

    const generalBonusRaw = Number((bulletinForStudent as any)?.general_bonus ?? 0);
    const generalBonus = Number.isFinite(generalBonusRaw) ? generalBonusRaw : 0;
    const officialBeforeBonus = officialGeneral - generalBonus;
    if (!Number.isFinite(officialBeforeBonus)) return null;

    const perSubjectRows = Array.isArray((bulletinForStudent as any)?.per_subject)
      ? ((bulletinForStudent as any).per_subject as any[])
      : [];

    let academicSum = 0;
    let academicCoeff = 0;

    for (const s of subjectsForReport as any[]) {
      if (s?.include_in_average === false) continue;
      if (conductSubjectIds.has(String(s?.subject_id ?? ""))) continue;

      const coeff = Number(s?.coeff_bulletin ?? 0);
      if (!Number.isFinite(coeff) || coeff <= 0) continue;

      const ps = perSubjectRows.find((row: any) => String(row?.subject_id ?? "") === String(s.subject_id));
      const avg = Number(ps?.avg20);
      if (!Number.isFinite(avg)) continue;

      academicSum += avg * coeff;
      academicCoeff += coeff;
    }

    if (academicCoeff <= 0) return null;

    // La conduite est ajoutée au bulletin avec le coefficient 1.
    const derived = officialBeforeBonus * (academicCoeff + 1) - academicSum;
    if (!Number.isFinite(derived) || derived < -0.01 || derived > 20.01) return null;

    return cleanNumber(Math.max(0, Math.min(20, derived)), 4);
  }

  let conductForStudent = conductAvgMapCurrent.get(studentIdStr) ?? null;
  const derivedConductFromOfficialGeneral = isCSCA
    ? deriveConductAvgFromOfficialGeneral()
    : null;

  if (snapConduct !== null) {
    conductForStudent = snapConduct;
  } else if (derivedConductFromOfficialGeneral !== null) {
    conductForStudent = derivedConductFromOfficialGeneral;
  }

  const responseSubjects = snapSubjects || subjectsForReport;
  const responseSubjectGroups = snapSubjectGroups || subjectGroups;
  const responseSubjectComponents = snapSubjectComponents || subjectComponentsForReport;

  return NextResponse.json({
    ok: true,
    mode,
    calculation_profile: isCSCA ? "csca" : "standard",
    is_csca: isCSCA,
    institution: institutionResponseMeta,
    class: classResponseMeta,
    student: {
      id: stu.id,
      full_name:
        stu.full_name ||
        [stu.last_name, stu.first_name].filter(Boolean).join(" ") ||
        null,
      last_name: stu.last_name || null,
      first_name: stu.first_name || null,
      matricule: stu.matricule || null,
      gender: stu.gender || null,
      birth_date: stu.birthdate || null,
      birth_place: stu.birth_place || null,
      nationality: stu.nationality || null,
      regime: stu.regime || null,
      is_repeater: stu.is_repeater ?? null,
      is_boarder: stu.is_boarder ?? null,
      is_affecte: stu.is_affecte ?? null,
      photo_url: null,
    },
    period: periodMeta,
    subjects: responseSubjects,
    subject_groups: responseSubjectGroups,
    subject_components: responseSubjectComponents,
    conduct:
      conductForStudent === null
        ? null
        : {
            total: conductForStudent,
            avg20: conductForStudent,
            label: isCSCA ? "Discipline / Conduite" : "Conduite",
            source:
              snapConduct !== null
                ? "qr_snapshot_official"
                : derivedConductFromOfficialGeneral !== null
                  ? "derived_from_official_bulletin_average"
                  : "public_verify",
          },
    bulletin: bulletinForStudent,
  });
}
