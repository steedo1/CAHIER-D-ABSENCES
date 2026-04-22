// src/app/api/public/bulletins/verify/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { verifyBulletinQR } from "@/lib/bulletin-qr";
import { resolveBulletinByCode } from "@/lib/bulletin-qr-store";

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

function isUuid(v: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    v
  );
}

function normalizeBulletinLevel(level?: string | null): string | null {
  if (!level) return null;
  const x = String(level).trim().toLowerCase();

  if (["6e", "5e", "4e", "3e", "seconde", "première", "terminale"].includes(x)) {
    return x;
  }
  if (x === "premiere") return "première";

  if (x.startsWith("2de") || x.startsWith("2nde") || x.startsWith("2")) return "seconde";
  if (x.startsWith("1re") || x.startsWith("1ere") || x.startsWith("1")) return "première";
  if (x.startsWith("t")) return "terminale";

  return null;
}
function normalizeStoredLevel(level?: string | null): string | null {
  const n = normalizeBulletinLevel(level);
  if (n) return n;

  const raw = String(level ?? "").trim().toLowerCase();
  return raw || null;
}

function pickBestCoeffRow(
  rows: SubjectCoeffRow[],
  wantedLevel: string | null
): SubjectCoeffRow | null {
  if (!rows.length) return null;

  const wanted = normalizeStoredLevel(wantedLevel);

  const exact = rows.find((r) => normalizeStoredLevel(r.level) === wanted);
  if (exact) return exact;

  const globalRow = rows.find((r) => !normalizeStoredLevel(r.level));
  if (globalRow) return globalRow;

  return rows[0] ?? null;
}

function pickBestComponentRows<T extends { level?: string | null }>(
  rows: T[],
  wantedLevel: string | null
): T[] {
  if (!rows.length) return [];

  const wanted = normalizeStoredLevel(wantedLevel);
  const exact = rows.filter((r) => normalizeStoredLevel(r.level) === wanted);
  if (exact.length) return exact;

  const globalRows = rows.filter((r) => !normalizeStoredLevel(r.level));
  if (globalRows.length) return globalRows;

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

async function loadConductSettings(
  srv: SupabaseClient,
  institutionId: string
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
      `
      )
      .eq("institution_id", institutionId)
      .maybeSingle();

    if (error || !data) return DEFAULT_CONDUCT_SETTINGS;

    const raw = data as any;
    const modeRaw = String(
      raw.lateness_mode ?? DEFAULT_CONDUCT_SETTINGS.rules.assiduite.lateness_mode
    )
      .normalize("NFKC")
      .trim()
      .toLowerCase();

    const allowedModes: LatenessMode[] = ["ignore", "as_hours", "direct_points"];
    const lateness_mode: LatenessMode = allowedModes.includes(modeRaw as LatenessMode)
      ? (modeRaw as LatenessMode)
      : DEFAULT_CONDUCT_SETTINGS.rules.assiduite.lateness_mode;

    return {
      rubric_max: {
        assiduite: numSetting(raw.assiduite_max, DEFAULT_CONDUCT_SETTINGS.rubric_max.assiduite),
        tenue: numSetting(raw.tenue_max, DEFAULT_CONDUCT_SETTINGS.rubric_max.tenue),
        moralite: numSetting(raw.moralite_max, DEFAULT_CONDUCT_SETTINGS.rubric_max.moralite),
        discipline: numSetting(raw.discipline_max, DEFAULT_CONDUCT_SETTINGS.rubric_max.discipline),
      },
      rules: {
        assiduite: {
          penalty_per_hour: numSetting(
            raw.points_per_absent_hour,
            DEFAULT_CONDUCT_SETTINGS.rules.assiduite.penalty_per_hour
          ),
          max_hours_before_zero: numSetting(
            raw.absent_hours_zero_threshold,
            DEFAULT_CONDUCT_SETTINGS.rules.assiduite.max_hours_before_zero
          ),
          note_after_threshold: numSetting(
            raw.absent_hours_note_after_threshold,
            DEFAULT_CONDUCT_SETTINGS.rules.assiduite.note_after_threshold
          ),
          lateness_mode,
          lateness_minutes_per_absent_hour: numSetting(
            raw.lateness_minutes_per_absent_hour,
            DEFAULT_CONDUCT_SETTINGS.rules.assiduite.lateness_minutes_per_absent_hour
          ),
          lateness_points_per_late: numSetting(
            raw.lateness_points_per_late,
            DEFAULT_CONDUCT_SETTINGS.rules.assiduite.lateness_points_per_late
          ),
        },
        tenue: { warning_penalty: DEFAULT_CONDUCT_SETTINGS.rules.tenue.warning_penalty },
        moralite: { event_penalty: DEFAULT_CONDUCT_SETTINGS.rules.moralite.event_penalty },
        discipline: {
          offense_penalty: DEFAULT_CONDUCT_SETTINGS.rules.discipline.offense_penalty,
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
  institutionId: string
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
    /(edhc|civique|citoyenn|vie\s*scolaire|conduite)/.test(n) ||
    /(musique|chant|arts?\s*plastiques|dessin|th[eé]atre)/.test(n) ||
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
      c
    )
  ) {
    return true;
  }

  return (
    /(fran[cç]ais|french|anglais|english|espagnol|spanish|allemand|german|arabe|arabic)/.test(n) ||
    /(histoire|hist\.|g[eé]ographie|histoire\s*-?\s*g[eé]o|hg)/.test(n) ||
    /(litt[eé]r|lettres|grammaire|orthograph|conjug|lecture|r[eé]daction|expression|compr[eé]hension)/.test(
      n
    ) ||
    /(economie|gestion|comptabilit|droit)/.test(n)
  );
}

function isScienceSubject(name?: string | null, code?: string | null): boolean {
  const n = normText(name);
  const c = normText(code);

  if (isOtherSubject(name, code)) return false;

  return (
    /(math|math[ée]m|phys|chim|svt|bio|science|info|algo|stat|techno)/.test(c) ||
    /(math|math[ée]m|phys|chim|svt|bio|science|informat|algo|stat|technolog)/.test(n)
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
  coeffBySubject: Map<string, { coeff: number; include: boolean }>
): number {
  let sumCoeff = 0;

  for (const item of group.items ?? []) {
    const override = Number(item.subject_coeff_override ?? NaN);
    if (Number.isFinite(override) && override > 0) {
      sumCoeff += override;
      continue;
    }

    const base = coeffBySubject.get(String(item.subject_id));
    const c = Number(base?.coeff ?? 0);
    if (Number.isFinite(c) && c > 0) sumCoeff += c;
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

type ClassStudentRow = {
  student_id: string;
  students?:
    | {
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
      }
    | null;
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
        typeof ps.avg20 === "number" && Number.isFinite(ps.avg20) ? ps.avg20 : null;
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
        typeof psc.avg20 === "number" && Number.isFinite(psc.avg20) ? psc.avg20 : null;
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
  meaning: "LETTRES" | "SCIENCES" | "AUTRES"
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
}): BulletinSubjectGroup[] {
  const { subjectIds, subjectInfoById, coeffBySubject } = opts;

  const letters: string[] = [];
  const sciences: string[] = [];
  const autres: string[] = [];

  for (const sid of subjectIds) {
    const meta = subjectInfoById.get(sid) || { name: "", code: "" };
    const name = meta.name;
    const code = meta.code;

    if (isOtherSubject(name, code)) autres.push(sid);
    else if (isPhiloSubject(name, code)) letters.push(sid);
    else if (isScienceSubject(name, code)) sciences.push(sid);
    else letters.push(sid);
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
  } = opts;

  let evalQuery = srv
    .from("grade_evaluations")
    .select(
      "id, class_id, subject_id, teacher_id, eval_date, scale, coeff, is_published, subject_component_id"
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
    .from("student_grades")
    .select("evaluation_id, student_id, score")
    .in("evaluation_id", evalIds)
    .eq("student_id", studentId);

  if (scoreErr || !scoreData || !scoreData.length) return null;
  const scores = scoreData as ScoreRow[];

  const perSubject = new Map<string, { sumWeighted: number; sumCoeff: number }>();
  const perComp = new Map<string, { subject_id: string; sumWeighted: number; sumCoeff: number }>();

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
        const compCell =
          perComp.get(comp.id) || {
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

    return {
      subject_id: s.subject_id,
      avg20,
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

  if (!conductAlreadyCounted && conductAvg20 !== null && conductAvg20 !== undefined) {
    const c = Number(conductAvg20);
    if (Number.isFinite(c)) {
      sumGen += c * 1;
      sumCoeffGen += 1;
    }
  }

  return sumCoeffGen > 0 ? cleanNumber(sumGen / sumCoeffGen, 4) : null;
}

/* ───────── Route GET ───────── */

export async function GET(req: NextRequest) {
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  const url = new URL(req.url);
  const shortCode = url.searchParams.get("c") || url.searchParams.get("code");
  const token = url.searchParams.get("t");

  let mode: "short" | "token" = "token";
  let payload: any = null;

  if (shortCode) {
    mode = "short";
    const rec: any = await resolveBulletinByCode(srv, shortCode);
    if (!rec || !rec.payload) {
      return NextResponse.json({ ok: false, error: "invalid_code" }, { status: 400 });
    }
    payload = rec.payload;
  } else if (token) {
    mode = "token";
    const dec: any = verifyBulletinQR(token);
    if (!dec) {
      return NextResponse.json({ ok: false, error: "invalid_qr" }, { status: 400 });
    }
    payload = dec;
  } else {
    return NextResponse.json({ ok: false, error: "missing_param" }, { status: 400 });
  }

  const instId: string | undefined = payload?.instId;
  const classId: string | undefined = payload?.classId;
  const studentId: string | undefined = payload?.studentId;

  if (!instId || !classId || !studentId) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
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

  const periodCodeToken: string | null = payload?.periodCode ?? payload?.period_code ?? null;

  const [
    { data: inst, error: instErr },
    { data: cls, error: clsErr },
    { data: stu, error: stuErr },
  ] = await Promise.all([
    srv.from("institutions").select("id, name, code").eq("id", instIdStr).maybeSingle(),
    srv
      .from("classes")
      .select("id, label, code, institution_id, academic_year, head_teacher_id, level")
      .eq("id", classIdStr)
      .maybeSingle(),
    srv
      .from("students")
      .select(
        "id, full_name, last_name, first_name, matricule, gender, birthdate, birth_place, nationality, regime, is_repeater, is_boarder, is_affecte, photo_url"
      )
      .eq("id", studentIdStr)
      .maybeSingle(),
  ]);

  if (instErr || !inst) {
    return NextResponse.json({ ok: false, error: "INSTITUTION_NOT_FOUND" }, { status: 404 });
  }

  if (clsErr || !cls) {
    return NextResponse.json({ ok: false, error: "CLASS_NOT_FOUND" }, { status: 404 });
  }

  const classRow = cls as ClassRow;

  if (!classRow.institution_id || classRow.institution_id !== instIdStr) {
    return NextResponse.json({ ok: false, error: "CLASS_FORBIDDEN" }, { status: 403 });
  }

  if (stuErr || !stu) {
    return NextResponse.json({ ok: false, error: "STUDENT_NOT_FOUND" }, { status: 404 });
  }

  const bulletinLevel = normalizeBulletinLevel(classRow.level);

  let periodMeta: {
    from: string | null;
    to: string | null;
    code?: string | null;
    label?: string | null;
    short_label?: string | null;
    academic_year?: string | null;
    coeff?: number | null;
  } = { from: dateFrom, to: dateTo };

  if ((!dateFrom || !dateTo) && (academicYearToken || classRow.academic_year)) {
    const yearGuess = academicYearToken ?? classRow.academic_year ?? null;
    const labelGuess = periodCodeToken ?? periodLabelToken ?? payload?.period ?? null;

    if (yearGuess && labelGuess) {
      const { data: periodsData } = await srv
        .from("grade_periods")
        .select("id, academic_year, code, label, short_label, start_date, end_date, coeff")
        .eq("institution_id", instIdStr)
        .eq("academic_year", yearGuess)
        .order("start_date", { ascending: true });

      const periods = (periodsData || []) as any[];
      const tok = normText(String(labelGuess));

      const exact =
        periods.find(
          (p) =>
            normText(p?.code) === tok ||
            normText(p?.label) === tok ||
            normText(p?.short_label) === tok
        ) ?? null;

      const fuzzy =
        exact ||
        periods.find((p) => {
          const c = normText(p?.code);
          const l = normText(p?.label);
          const s = normText(p?.short_label);
          return (
            (tok && c && (c.includes(tok) || tok.includes(c))) ||
            (tok && l && (l.includes(tok) || tok.includes(l))) ||
            (tok && s && (s.includes(tok) || tok.includes(s)))
          );
        }) ||
        null;

      if (fuzzy?.start_date && fuzzy?.end_date) {
        dateFrom = String(fuzzy.start_date);
        dateTo = String(fuzzy.end_date);
      }
    }
  }

  if (dateFrom && dateTo) {
    const { data: gp, error: gpErr } = await srv
      .from("grade_periods")
      .select("id, academic_year, code, label, short_label, start_date, end_date, coeff")
      .eq("institution_id", instIdStr)
      .eq("start_date", dateFrom)
      .eq("end_date", dateTo)
      .maybeSingle();

    if (!gpErr && gp) {
      periodMeta = {
        from: dateFrom,
        to: dateTo,
        code: gp.code ?? null,
        label: gp.label ?? null,
        short_label: gp.short_label ?? null,
        academic_year: gp.academic_year ?? null,
        coeff:
          gp.coeff === null || gp.coeff === undefined ? null : cleanCoeff(gp.coeff),
      };
    } else {
      const yearGuess = academicYearToken ?? classRow.academic_year ?? null;
      const labelGuess = periodCodeToken ?? periodLabelToken ?? payload?.period ?? null;

      let fuzzy: any | null = null;

      if (yearGuess && labelGuess) {
        const { data: periodsData } = await srv
          .from("grade_periods")
          .select("id, academic_year, code, label, short_label, start_date, end_date, coeff")
          .eq("institution_id", instIdStr)
          .eq("academic_year", yearGuess)
          .order("start_date", { ascending: true });

        const periods = (periodsData || []) as any[];
        const tok = normText(String(labelGuess));

        fuzzy =
          periods.find(
            (p) =>
              normText(p?.code) === tok ||
              normText(p?.label) === tok ||
              normText(p?.short_label) === tok
          ) ??
          periods.find((p) => {
            const c = normText(p?.code);
            const l = normText(p?.label);
            const s = normText(p?.short_label);
            return (
              (tok && c && (c.includes(tok) || tok.includes(c))) ||
              (tok && l && (l.includes(tok) || tok.includes(l))) ||
              (tok && s && (s.includes(tok) || tok.includes(s)))
            );
          }) ??
          null;
      }

      if (fuzzy?.start_date && fuzzy?.end_date) {
        dateFrom = String(fuzzy.start_date);
        dateTo = String(fuzzy.end_date);

        periodMeta = {
          from: dateFrom,
          to: dateTo,
          code: fuzzy.code ?? periodCodeToken ?? null,
          label: fuzzy.label ?? periodLabelToken ?? null,
          short_label: fuzzy.short_label ?? null,
          academic_year: fuzzy.academic_year ?? yearGuess ?? null,
          coeff:
            fuzzy.coeff === null || fuzzy.coeff === undefined
              ? null
              : cleanCoeff(fuzzy.coeff),
        };
      } else {
        periodMeta = {
          from: dateFrom,
          to: dateTo,
          code: periodCodeToken ?? null,
          label: periodLabelToken ?? null,
          short_label: null,
          academic_year: academicYearToken ?? classRow.academic_year ?? null,
          coeff: null,
        };
      }
    }
  } else {
    periodMeta = {
      from: dateFrom,
      to: dateTo,
      code: periodCodeToken ?? null,
      label: periodLabelToken ?? null,
      short_label: null,
      academic_year: academicYearToken ?? classRow.academic_year ?? null,
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

  let periodLooksAnnual = false;
  let yearForAnnual: string | null =
    periodMeta.academic_year ?? academicYearToken ?? classRow.academic_year ?? null;
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
    const { data: yearPeriodsData } = await srv
      .from("grade_periods")
      .select("id, academic_year, code, label, short_label, start_date, end_date, coeff")
      .eq("institution_id", instIdStr)
      .eq("academic_year", yearForAnnual)
      .order("start_date", { ascending: true });

    yearPeriods = (yearPeriodsData || []) as any[];

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
        photo_url,
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
    .eq("class_id", classIdStr);

  if (!hasDateFilter) {
    enrollQuery = enrollQuery.is("end_date", null);
  } else if (dateFrom) {
    enrollQuery = enrollQuery.or(`end_date.gte.${dateFrom},end_date.is.null`);
  }

  enrollQuery = enrollQuery.order("student_id", { ascending: true });

  const { data: csData, error: csErr } = await enrollQuery;

  if (csErr) {
    return NextResponse.json({ ok: false, error: "CLASS_STUDENTS_ERROR" }, { status: 500 });
  }

  const classStudents = (csData || []) as ClassStudentRow[];

  if (!classStudents.length) {
    return NextResponse.json({
      ok: true,
      mode,
      institution: { id: inst.id, name: inst.name, code: inst.code ?? null },
      class: {
        id: classRow.id,
        label: classRow.label || classRow.code || "Classe",
        code: classRow.code || null,
        academic_year: classRow.academic_year || null,
        level: classRow.level || null,
        bulletin_level: bulletinLevel,
        head_teacher: headTeacher
          ? {
              id: headTeacher.id,
              display_name: headTeacher.display_name || null,
              phone: headTeacher.phone || null,
              email: headTeacher.email || null,
            }
          : null,
      },
      student: {
        id: stu.id,
        full_name:
          stu.full_name ||
          [stu.last_name, stu.first_name].filter(Boolean).join(" ") ||
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
        photo_url: stu.photo_url || null,
      },
      period: periodMeta,
      subjects: [],
      subject_groups: [],
      subject_components: [],
      bulletin: null,
    });
  }

  const studentIds = classStudents.map((cs) => cs.student_id).filter(Boolean);

  async function fetchConductAverageMap(
    from: string,
    to: string
  ): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    studentIds.forEach((sid) => out.set(sid, null));

    if (!from || !to) return out;

    try {
      const conductSettings = await loadConductSettings(srv, instIdStr);
      const rubricMax = conductSettings.rubric_max;
      const defaultSessionMinutes = await loadDefaultSessionMinutes(srv, instIdStr);

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
          (absMarks || [])
            .map((m: any) => String(m.id || ""))
            .filter(Boolean)
        )
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
          ])
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
            (tardy || [])
              .map((t: any) => String(t.id || ""))
              .filter(Boolean)
          )
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
            ])
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
              p.rubric === "discipline"
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
        (cur as any)[p.rubric] = Number((cur as any)[p.rubric] || 0) + Number(p.points || 0);
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
          assRules.lateness_minutes_per_absent_hour || defaultSessionMinutes || 60
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
            rubricMax.assiduite
          );
        } else {
          assiduite = clampConduct(
            rubricMax.assiduite - assRules.penalty_per_hour * effectiveHours,
            0,
            rubricMax.assiduite
          );

          if (
            assRules.lateness_mode === "direct_points" &&
            tardyCount > 0 &&
            assRules.lateness_points_per_late > 0
          ) {
            assiduite = clampConduct(
              assiduite - assRules.lateness_points_per_late * tardyCount,
              0,
              rubricMax.assiduite
            );
          }
        }

        const tenueWarn = evs.filter((e) => e.event_type === "uniform_warning").length;
        let tenue = clampConduct(
          rubricMax.tenue - conductSettings.rules.tenue.warning_penalty * tenueWarn,
          0,
          rubricMax.tenue
        );

        const moralN = evs.filter(
          (e) => e.event_type === "cheating" || e.event_type === "alcohol_or_drug"
        ).length;
        let moralite = clampConduct(
          rubricMax.moralite - conductSettings.rules.moralite.event_penalty * moralN,
          0,
          rubricMax.moralite
        );

        const firstWarn = evs.find((e) => e.event_type === "discipline_warning");
        let discN = 0;
        if (firstWarn) {
          discN = evs.filter(
            (e) =>
              e.event_type === "discipline_offense" &&
              e.occurred_at >= firstWarn.occurred_at
          ).length;
        }
        let discipline = clampConduct(
          rubricMax.discipline - conductSettings.rules.discipline.offense_penalty * discN,
          0,
          rubricMax.discipline
        );

        const p = penByStudent.get(sid) || { tenue: 0, moralite: 0, discipline: 0 };
        tenue = clampConduct(tenue - p.tenue, 0, rubricMax.tenue);
        moralite = clampConduct(moralite - p.moralite, 0, rubricMax.moralite);
        discipline = clampConduct(discipline - p.discipline, 0, rubricMax.discipline);

        let total = assiduite + tenue + moralite + discipline;
        const hasCouncil = evs.some((e) => e.event_type === "discipline_council");
        if (hasCouncil) {
          total = Math.min(total, conductSettings.rules.discipline.council_cap);
        }

        out.set(sid, cleanNumber(total, 4));
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
    const best = pickBestCoeffRow(rows, bulletinLevel);
    if (!best) continue;

    coeffBySubject.set(sid, {
      coeff: cleanCoeff(best.coeff),
      include: best.include_in_average !== false,
    });
  }

  let evals: EvalRow[] = [];
  {
    let evalQuery = srv
      .from("grade_evaluations")
      .select(
        "id, class_id, subject_id, teacher_id, eval_date, scale, coeff, is_published, subject_component_id"
      )
      .eq("class_id", classIdStr)
      .eq("is_published", true);

    if (dateFrom) evalQuery = evalQuery.gte("eval_date", dateFrom);
    if (dateTo) evalQuery = evalQuery.lte("eval_date", dateTo);

    const { data: evalData, error: evalErr } = await evalQuery;

    if (evalErr) {
      return NextResponse.json({ ok: false, error: "EVALUATIONS_ERROR" }, { status: 500 });
    }

    evals = (evalData || []) as EvalRow[];
  }

  const subjectIdSet = new Set<string>();
  for (const e of evals) if (e.subject_id) subjectIdSet.add(String(e.subject_id));

  const subjectIdsUnionRaw = Array.from(
    new Set([...Array.from(subjectIdsFromConfig), ...Array.from(subjectIdSet)])
  );
  const subjectIds = subjectIdsUnionRaw.filter((sid) => isUuid(sid));

  if (!subjectIds.length) {
    return NextResponse.json({
      ok: true,
      mode,
      institution: { id: inst.id, name: inst.name, code: inst.code ?? null },
      class: {
        id: classRow.id,
        label: classRow.label || classRow.code || "Classe",
        code: classRow.code || null,
        academic_year: classRow.academic_year || null,
        level: classRow.level || null,
        bulletin_level: bulletinLevel,
        head_teacher: headTeacher
          ? {
              id: headTeacher.id,
              display_name: headTeacher.display_name || null,
              phone: headTeacher.phone || null,
              email: headTeacher.email || null,
            }
          : null,
      },
      student: {
        id: stu.id,
        full_name:
          stu.full_name ||
          [stu.last_name, stu.first_name].filter(Boolean).join(" ") ||
          null,
        matricule: stu.matricule || null,
        photo_url: stu.photo_url || null,
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
    return NextResponse.json({ ok: false, error: "SUBJECTS_ERROR" }, { status: 500 });
  }

  const subjects = (subjData || []) as SubjectRow[];
  const subjectById = new Map<string, SubjectRow>();
  for (const s of subjects) subjectById.set(s.id, s);

  const orderedSubjectIds = subjects.map((s) => s.id).filter((sid) => isUuid(sid));

  const subjectsForReport = orderedSubjectIds.map((sid) => {
    const s = subjectById.get(sid);
    const name = s?.name || s?.code || "Matière";
    const info = coeffBySubject.get(sid);
    const coeffBulletin = info ? info.coeff : 1;
    const includeInAverage = info ? info.include : true;

    return {
      subject_id: sid,
      subject_name: name,
      coeff_bulletin: coeffBulletin,
      include_in_average: includeInAverage,
    };
  });

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

  const { data: compData } = await srv
    .from("grade_subject_components")
    .select("id, subject_id, label, short_label, coeff_in_subject, order_index, is_active, level")
    .eq("institution_id", instIdStr)
    .in("subject_id", orderedSubjectIds);

  if (compData) {
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
            : 1
        ),
        order_index:
          r.order_index !== null && r.order_index !== undefined ? Number(r.order_index) : 1,
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
      const chosen = pickBestComponentRows(rawBySubject.get(sid) || [], bulletinLevel);

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
    subjectInfoById.set(s.id, { name: s.name ?? "", code: s.code ?? "" })
  );

  if (bulletinLevel) {
    const { data: groupsData } = await srv
      .from("bulletin_subject_groups")
      .select("id, level, label, order_index, is_active, code, short_label, annual_coeff")
      .eq("institution_id", instIdStr)
      .eq("level", bulletinLevel)
      .order("order_index", { ascending: true });

    if (groupsData && groupsData.length) {
      const activeGroups = (groupsData as any[]).filter((g) => g.is_active !== false);
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

        const builtGroups: BulletinSubjectGroup[] = activeGroups.map((g: any) => {
          const rows = itemsByGroup.get(String(g.id)) || [];
          const items: BulletinSubjectGroupItem[] = rows.flatMap((row: any, idx: number) => {
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
          });

          const annualCoeffRaw =
            g.annual_coeff !== null && g.annual_coeff !== undefined ? Number(g.annual_coeff) : 1;

          const groupCode =
            g.code && String(g.code).trim() !== "" ? String(g.code) : String(g.label);

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
        });

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

          if (isScienceSubject(name, code) && gSciences?.id) return gSciences.id;
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
            if (!firstSeenOrder.has(sid)) firstSeenOrder.set(sid, it.order_index);
            if (!chosenGroupIdBySubject.has(sid)) chosenGroupIdBySubject.set(sid, g.id);
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
    });
  }

  const hasGroupConfig = subjectGroups.length > 0;

  const evalById = new Map<string, EvalRow>();
  for (const e of evals) evalById.set(e.id, e);

  const studentIdsInClass = classStudents.map((cs) => cs.student_id).filter(Boolean);

  let scores: ScoreRow[] = [];
  if (evals.length) {
    const evalIds = evals.map((e) => e.id);

    const { data: scoreData, error: scoreErr } = await srv
      .from("student_grades")
      .select("evaluation_id, student_id, score")
      .in("evaluation_id", evalIds)
      .in("student_id", studentIdsInClass);

    if (scoreErr) {
      return NextResponse.json({ ok: false, error: "SCORES_ERROR" }, { status: 500 });
    }

    scores = (scoreData || []) as ScoreRow[];
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
        const compCell =
          stuCompMap.get(comp.id) || {
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
      stuLocal.full_name ||
      [stuLocal.last_name, stuLocal.first_name].filter(Boolean).join(" ") ||
      "Élève";

    const stuMap =
      perStudentSubject.get(cs.student_id) ||
      new Map<string, { sumWeighted: number; sumCoeff: number }>();

    const stuCompMap =
      perStudentSubjectComponent.get(cs.student_id) ||
      new Map<string, { subject_id: string; sumWeighted: number; sumCoeff: number }>();

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

      return {
        subject_id: s.subject_id,
        avg20,
      };
    });

    let per_group:
      | {
          group_id: string;
          group_avg: number | null;
        }[] = [];

    if (hasGroupConfig) {
      const coeffBulletinBySubject = new Map<string, number>();
      subjectsForReport.forEach((s) =>
        coeffBulletinBySubject.set(s.subject_id, Number(s.coeff_bulletin ?? 1))
      );

      per_group = subjectGroups.map((g) => {
        let sum = 0;
        let sumCoeffLocal = 0;

        for (const it of g.items) {
          const sid = it.subject_id;

          const ps = per_subject.find((x) => x.subject_id === sid);
          const subAvg = ps?.avg20 ?? null;
          if (subAvg === null || subAvg === undefined) continue;

          const w =
            it.subject_coeff_override !== null && it.subject_coeff_override !== undefined
              ? Number(it.subject_coeff_override)
              : coeffBulletinBySubject.get(sid) ?? 1;

          if (!w || w <= 0) continue;

          sum += Number(subAvg) * w;
          sumCoeffLocal += w;
        }

        const groupAvg = sumCoeffLocal > 0 ? cleanNumber(sum / sumCoeffLocal, 4) : null;

        return {
          group_id: g.id,
          group_avg: groupAvg,
        };
      });
    }

    let general_avg: number | null = null;
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
        if (!conductAlreadyCounted && conductNote !== null && conductNote !== undefined) {
          const c = Number(conductNote);
          if (Number.isFinite(c)) {
            sumGen += c * 1;
            sumCoeffGen += 1;
          }
        }

        general_avg = sumCoeffGen > 0 ? cleanNumber(sumGen / sumCoeffGen, 4) : null;
      } else {
        general_avg = null;
      }
    }

    return {
      student_id: cs.student_id,
      full_name: fullName,
      matricule: stuLocal.matricule || null,
      photo_url: stuLocal.photo_url || null,
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
      per_subject_components,
    };
  });

  applySubjectRanks(items);
  applySubjectComponentRanks(items);

  const bulletinForStudent = items.find((it) => it.student_id === studentIdStr);

  if (!bulletinForStudent) {
    return NextResponse.json(
      { ok: false, error: "STUDENT_NOT_IN_CLASS_FOR_PERIOD" },
      { status: 404 }
    );
  }

  const snap = (payload as any)?.s ?? null;
  const snapGeneral =
    snap && typeof snap.g === "number" ? cleanNumber(snap.g, 4) : null;
  const snapAnnual =
    snap && typeof snap.a === "number" ? cleanNumber(snap.a, 4) : null;

  if (snapGeneral !== null && (bulletinForStudent as any).general_avg == null) {
    (bulletinForStudent as any).general_avg = snapGeneral;
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
        });
      }

      if (periodAvg === null) continue;

      sumWeightedPeriods += periodAvg * coeffPeriod;
      sumCoeffPeriods += coeffPeriod;
    }

    if (sumCoeffPeriods > 0) {
      annual_avg_for_student = cleanNumber(
        sumWeightedPeriods / sumCoeffPeriods,
        4
      );
    }
  }

  if (annual_avg_for_student !== null) {
    (bulletinForStudent as any).annual_avg = annual_avg_for_student;
  } else if (snapAnnual !== null) {
    (bulletinForStudent as any).annual_avg = snapAnnual;
  }

  return NextResponse.json({
    ok: true,
    mode,
    institution: {
      id: inst.id,
      name: inst.name,
      code: inst.code ?? null,
    },
    class: {
      id: classRow.id,
      label: classRow.label || classRow.code || "Classe",
      code: classRow.code || null,
      academic_year: classRow.academic_year || null,
      level: classRow.level || null,
      bulletin_level: bulletinLevel,
      head_teacher: headTeacher
        ? {
            id: headTeacher.id,
            display_name: headTeacher.display_name || null,
            phone: headTeacher.phone || null,
            email: headTeacher.email || null,
          }
        : null,
    },
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
      photo_url: stu.photo_url || null,
    },
    period: periodMeta,
    subjects: subjectsForReport,
    subject_groups: subjectGroups,
    subject_components: subjectComponentsForReport,
    bulletin: bulletinForStudent,
  });
}