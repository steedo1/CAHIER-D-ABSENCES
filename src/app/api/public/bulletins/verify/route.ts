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

// Normalisation du niveau pour les configs bulletin
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

function normText(s?: string | null) {
  return (s ?? "").toString().trim().toLowerCase();
}

// EPS / EDHC / Musique / Vie scolaire => AUTRES
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

function isScienceSubject(name?: string | null, code?: string | null): boolean {
  const n = normText(name);
  const c = normText(code);

  if (isOtherSubject(name, code)) return false;

  return (
    /(math|math[ée]m|phys|chim|svt|bio|science|info|algo|stat|techno)/.test(c) ||
    /(math|math[ée]m|phys|chim|svt|bio|science|informat|algo|stat|technolog)/.test(n)
  );
}

function groupKey(s?: string | null) {
  return (s ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

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

/* ───────── Types locaux ───────── */

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

/* ───────── Rangs matières / sous-matières ───────── */

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

/* ───────── Fallback groupes (LETTRES / SCIENCES / AUTRES) ───────── */

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

/* ───────── Route GET publique ───────── */

export async function GET(req: NextRequest) {
  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  const url = new URL(req.url);
  const shortCode = url.searchParams.get("c") || url.searchParams.get("code");
  const token = url.searchParams.get("t");

  let mode: "short" | "token" = "token";
  let payload: any = null;

  // 1) Décodage du QR
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

  // ✅ Robustesse: accepter plusieurs noms possibles dans le payload
  let dateFrom: string | null =
    payload?.i
      ?? payload?.periodFrom
      ?? payload?.period_from
      ?? payload?.from
      ?? payload?.start_date
      ?? payload?.startDate
      ?? null;

  let dateTo: string | null =
    payload?.periodTo
      ?? payload?.period_to
      ?? payload?.to
      ?? payload?.end_date
      ?? payload?.endDate
      ?? null;

  const academicYearToken: string | null = payload?.academicYear ?? null;
  const periodLabelToken: string | null = payload?.periodLabel ?? null;
  const periodCodeToken: string | null = payload?.periodCode ?? payload?.period_code ?? null;

  // 2) Institution + Classe (avec head teacher) + Student
  const [
    { data: inst, error: instErr },
    { data: cls, error: clsErr },
    { data: stu, error: stuErr },
  ] = await Promise.all([
    srv.from("institutions").select("id, name, code").eq("id", instId).maybeSingle(),
    srv
      .from("classes")
      .select("id, label, code, institution_id, academic_year, head_teacher_id, level")
      .eq("id", classId)
      .maybeSingle(),
    srv
      .from("students")
      .select(
        "id, full_name, last_name, first_name, matricule, gender, birthdate, birth_place, nationality, regime, is_repeater, is_boarder, is_affecte, photo_url"
      )
      .eq("id", studentId)
      .maybeSingle(),
  ]);

  if (instErr || !inst) {
    return NextResponse.json({ ok: false, error: "INSTITUTION_NOT_FOUND" }, { status: 404 });
  }

  if (clsErr || !cls) {
    return NextResponse.json({ ok: false, error: "CLASS_NOT_FOUND" }, { status: 404 });
  }

  const classRow = cls as ClassRow;

  if (!classRow.institution_id || classRow.institution_id !== instId) {
    return NextResponse.json({ ok: false, error: "CLASS_FORBIDDEN" }, { status: 403 });
  }

  if (stuErr || !stu) {
    return NextResponse.json({ ok: false, error: "STUDENT_NOT_FOUND" }, { status: 404 });
  }

  const bulletinLevel = normalizeBulletinLevel(classRow.level);

  // ✅ Si dateFrom/dateTo manquent, on reconstruit à partir de grade_periods (year + label/code)
  if ((!dateFrom || !dateTo) && (academicYearToken || classRow.academic_year)) {
    const yearGuess = academicYearToken ?? classRow.academic_year ?? null;
    const labelGuess = periodLabelToken ?? periodCodeToken ?? payload?.period ?? null;

    if (yearGuess && labelGuess) {
      const { data: periodsData } = await srv
        .from("grade_periods")
        .select("id, academic_year, code, label, short_label, start_date, end_date, coeff")
        .eq("institution_id", instId)
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

  // head teacher
  let headTeacher: HeadTeacherRow | null = null;
  if (classRow.head_teacher_id) {
    const { data: ht, error: htErr } = await srv
      .from("profiles")
      .select("id, display_name, phone, email")
      .eq("id", classRow.head_teacher_id)
      .maybeSingle();
    if (!htErr && ht) headTeacher = ht as HeadTeacherRow;
  }

  // 3) Période de bulletin
  let periodMeta: {
    from: string | null;
    to: string | null;
    code?: string | null;
    label?: string | null;
    short_label?: string | null;
    academic_year?: string | null;
    coeff?: number | null;
  } = { from: dateFrom, to: dateTo };

  if (dateFrom && dateTo) {
    const { data: gp, error: gpErr } = await srv
      .from("grade_periods")
      .select("id, academic_year, code, label, short_label, start_date, end_date, coeff")
      .eq("institution_id", instId)
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

  // ✅ Déterminer si on doit calculer une moyenne annuelle (uniquement dernière période)
  let annualRange: { from: string | null; to: string | null } = { from: null, to: null };
  let shouldComputeAnnual = false;

  const periodLooksAnnual = (() => {
    const txt =
      normText(periodMeta.code) + " " + normText(periodMeta.label) + " " + normText(periodMeta.short_label);
    return /(annuel|annuelle|annual|année|annee)/.test(txt);
  })();

  const yearForAnnual = periodMeta.academic_year ?? academicYearToken ?? classRow.academic_year ?? null;

  if (!periodLooksAnnual && yearForAnnual) {
    const { data: yearPeriodsData } = await srv
      .from("grade_periods")
      .select("start_date, end_date")
      .eq("institution_id", instId)
      .eq("academic_year", yearForAnnual);

    const yearPeriods = (yearPeriodsData || []) as any[];

    const starts = yearPeriods
      .map((p) => (p?.start_date ? String(p.start_date) : ""))
      .filter(Boolean)
      .sort();

    const ends = yearPeriods
      .map((p) => (p?.end_date ? String(p.end_date) : ""))
      .filter(Boolean)
      .sort();

    const minStart = starts.length ? starts[0] : null;
    const maxEnd = ends.length ? ends[ends.length - 1] : null;

    annualRange = { from: minStart, to: maxEnd };

    if (dateTo && maxEnd && dateTo === maxEnd && minStart) {
      shouldComputeAnnual = true;
    }
  }

  // 4) Élèves de la classe
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
    .eq("class_id", classId);

  if (!hasDateFilter) enrollQuery = enrollQuery.is("end_date", null);
  else if (dateFrom) enrollQuery = enrollQuery.or(`end_date.gte.${dateFrom},end_date.is.null`);

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

  // 5) Coefficients bulletin par matière
  let coeffAllQuery = srv
    .from("institution_subject_coeffs")
    .select("subject_id, coeff, include_in_average, level")
    .eq("institution_id", instId);

  if (bulletinLevel) coeffAllQuery = coeffAllQuery.eq("level", bulletinLevel);

  const { data: coeffAllData } = await coeffAllQuery;

  const coeffBySubject = new Map<string, { coeff: number; include: boolean }>();
  const subjectIdsFromConfig = new Set<string>();

  for (const row of (coeffAllData || []) as SubjectCoeffRow[]) {
    const sid = String(row.subject_id || "");
    if (!sid || !isUuid(sid)) continue;
    subjectIdsFromConfig.add(sid);
    coeffBySubject.set(sid, {
      coeff: cleanCoeff(row.coeff),
      include: row.include_in_average !== false,
    });
  }

  // 6) Evaluations publiées (période)
  let evals: EvalRow[] = [];
  {
    let evalQuery = srv
      .from("grade_evaluations")
      .select(
        "id, class_id, subject_id, teacher_id, eval_date, scale, coeff, is_published, subject_component_id"
      )
      .eq("class_id", classId)
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
      bulletin: {
        student_id: stu.id,
        full_name:
          stu.full_name ||
          [stu.last_name, stu.first_name].filter(Boolean).join(" ") ||
          "Élève",
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

  // 7) Noms / codes matières
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

  // 8) Sous-matières
  let subjectComponentsForReport: BulletinSubjectComponent[] = [];
  const subjectComponentById = new Map<string, BulletinSubjectComponent>();
  const compsBySubject = new Map<string, BulletinSubjectComponent[]>();

  const { data: compData } = await srv
    .from("grade_subject_components")
    .select("id, subject_id, label, short_label, coeff_in_subject, order_index, is_active")
    .eq("institution_id", instId)
    .in("subject_id", orderedSubjectIds);

  if (compData) {
    const rows = (compData || [])
      .filter((r: any) => r.is_active !== false)
      .map((r: any) => {
        const coeff =
          r.coeff_in_subject !== null && r.coeff_in_subject !== undefined
            ? Number(r.coeff_in_subject)
            : 1;
        const ord =
          r.order_index !== null && r.order_index !== undefined ? Number(r.order_index) : 1;

        const obj: BulletinSubjectComponent = {
          id: String(r.id),
          subject_id: String(r.subject_id),
          label: (r.label as string) || "Sous-matière",
          short_label: r.short_label ? String(r.short_label) : null,
          coeff_in_subject: cleanCoeff(coeff),
          order_index: ord,
        };
        return obj;
      }) as BulletinSubjectComponent[];

    rows.sort((a, b) => {
      if (a.subject_id !== b.subject_id) return a.subject_id.localeCompare(b.subject_id);
      return a.order_index - b.order_index;
    });

    subjectComponentsForReport = rows;
    rows.forEach((c) => {
      subjectComponentById.set(c.id, c);
      const arr = compsBySubject.get(c.subject_id) || [];
      arr.push(c);
      compsBySubject.set(c.subject_id, arr);
    });
  }

  // 9) Groupes (BILAN LETTRES / SCIENCES / AUTRES)
  let subjectGroups: BulletinSubjectGroup[] = [];
  const subjectInfoById = new Map<string, { name: string; code: string }>();
  subjects.forEach((s) =>
    subjectInfoById.set(s.id, { name: s.name ?? "", code: s.code ?? "" })
  );

  if (bulletinLevel) {
    const { data: groupsData } = await srv
      .from("bulletin_subject_groups")
      .select("id, level, label, order_index, is_active, code, short_label, annual_coeff")
      .eq("institution_id", instId)
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
                subject_name: String(subjectName),
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
            g.short_label && String(g.short_label).trim() !== "" ? String(g.short_label) : null;

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

          if (isOtherSubject(name, code)) return gAutres?.id ?? null;
          if (isPhiloSubject(name, code)) return gLetters?.id ?? null;
          if (isScienceSubject(name, code)) return gSciences?.id ?? null;

          return gLetters?.id ?? null;
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

  // 10) Notes (student_grades) (période)
  const evalById = new Map<string, EvalRow>();
  for (const e of evals) evalById.set(e.id, e);

  const studentIds = classStudents.map((cs) => cs.student_id);

  let scores: ScoreRow[] = [];
  if (evals.length) {
    const evalIds = evals.map((e) => e.id);

    const { data: scoreData, error: scoreErr } = await srv
      .from("student_grades")
      .select("evaluation_id, student_id, score")
      .in("evaluation_id", evalIds)
      .in("student_id", studentIds);

    if (scoreErr) {
      return NextResponse.json({ ok: false, error: "SCORES_ERROR" }, { status: 500 });
    }

    scores = (scoreData || []) as ScoreRow[];
  }

  // ✅ Calcul annuel (uniquement pour l’élève demandé, et uniquement si dernière période)
  let annual_avg_for_student: number | null = null;

  if (shouldComputeAnnual && annualRange.from && annualRange.to) {
    const { data: evalAnnualData, error: evalAnnualErr } = await srv
      .from("grade_evaluations")
      .select(
        "id, class_id, subject_id, teacher_id, eval_date, scale, coeff, is_published, subject_component_id"
      )
      .eq("class_id", classId)
      .eq("is_published", true)
      .gte("eval_date", annualRange.from)
      .lte("eval_date", annualRange.to);

    if (!evalAnnualErr && evalAnnualData && evalAnnualData.length) {
      const evalAnnuals = (evalAnnualData || []) as EvalRow[];
      const evalAnnualById = new Map<string, EvalRow>();
      evalAnnuals.forEach((e) => evalAnnualById.set(e.id, e));

      const evalAnnualIds = evalAnnuals.map((e) => e.id);

      const { data: annualScoreData, error: annualScoreErr } = await srv
        .from("student_grades")
        .select("evaluation_id, student_id, score")
        .in("evaluation_id", evalAnnualIds)
        .eq("student_id", studentId);

      if (!annualScoreErr && annualScoreData && annualScoreData.length) {
        const annualScores = (annualScoreData || []) as ScoreRow[];

        const perSubjectAnnual = new Map<string, { sumWeighted: number; sumCoeff: number }>();
        const perCompAnnual = new Map<
          string,
          { subject_id: string; sumWeighted: number; sumCoeff: number }
        >();

        for (const sc of annualScores) {
          const ev = evalAnnualById.get(sc.evaluation_id);
          if (!ev) continue;
          if (!ev.subject_id) continue;
          if (!ev.scale || ev.scale <= 0) continue;
          if (sc.score === null || sc.score === undefined) continue;

          const score = Number(sc.score);
          if (!Number.isFinite(score)) continue;

          const norm20 = (score / ev.scale) * 20;
          const weight = ev.coeff ?? 1;

          const sid = String(ev.subject_id);

          const cellS = perSubjectAnnual.get(sid) || { sumWeighted: 0, sumCoeff: 0 };
          cellS.sumWeighted += norm20 * weight;
          cellS.sumCoeff += weight;
          perSubjectAnnual.set(sid, cellS);

          if (ev.subject_component_id) {
            const comp = subjectComponentById.get(String(ev.subject_component_id));
            if (comp) {
              const cellC =
                perCompAnnual.get(comp.id) || {
                  subject_id: comp.subject_id,
                  sumWeighted: 0,
                  sumCoeff: 0,
                };
              cellC.sumWeighted += norm20 * weight;
              cellC.sumCoeff += weight;
              perCompAnnual.set(comp.id, cellC);
            }
          }
        }

        // Reconstituer avg20 annual par matière (même logique que la période)
        const annual_per_subject = subjectsForReport.map((s) => {
          const comps = compsBySubject.get(s.subject_id) || [];
          let avg20: number | null = null;

          if (comps.length) {
            let sum = 0;
            let sumW = 0;

            for (const comp of comps) {
              const cell = perCompAnnual.get(comp.id);
              if (!cell || cell.sumCoeff <= 0) continue;

              const compAvgRaw = cell.sumWeighted / cell.sumCoeff;
              if (!Number.isFinite(compAvgRaw)) continue;

              const w = comp.coeff_in_subject ?? 1;
              if (!w || w <= 0) continue;

              sum += compAvgRaw * w;
              sumW += w;
            }

            if (sumW > 0) avg20 = cleanNumber(sum / sumW, 4);
          }

          if (avg20 === null) {
            const cell = perSubjectAnnual.get(s.subject_id);
            if (cell && cell.sumCoeff > 0) {
              avg20 = cleanNumber(cell.sumWeighted / cell.sumCoeff, 4);
            }
          }

          return { subject_id: s.subject_id, avg20 };
        });

        // moyenne générale annuelle
        let sumGen = 0;
        let sumCoeffGen = 0;

        for (const s of subjectsForReport) {
          if (s.include_in_average === false) continue;
          const coeffSub = Number(s.coeff_bulletin ?? 0);
          if (!coeffSub || coeffSub <= 0) continue;

          const ps = (annual_per_subject as any[]).find((x) => x.subject_id === s.subject_id);
          const subAvg = ps?.avg20 ?? null;
          if (subAvg === null || subAvg === undefined) continue;

          sumGen += Number(subAvg) * coeffSub;
          sumCoeffGen += coeffSub;
        }

        annual_avg_for_student = sumCoeffGen > 0 ? cleanNumber(sumGen / sumCoeffGen, 4) : null;
      }
    }
  }

  const perStudentSubject = new Map<string, Map<string, { sumWeighted: number; sumCoeff: number }>>();
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
          stuCompMap.get(comp.id) || { subject_id: comp.subject_id, sumWeighted: 0, sumCoeff: 0 };
        compCell.sumWeighted += norm20 * weight;
        compCell.sumCoeff += weight;
        stuCompMap.set(comp.id, compCell);
      }
    }
  }

  // 11) Construire items pour tous les élèves de la classe
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

          const ps = (per_subject as any[]).find((x) => x.subject_id === sid);
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

      for (const s of subjectsForReport) {
        if (s.include_in_average === false) continue;
        const coeffSub = Number(s.coeff_bulletin ?? 0);
        if (!coeffSub || coeffSub <= 0) continue;

        const ps = (per_subject as any[]).find((x) => x.subject_id === s.subject_id);
        const subAvg = ps?.avg20 ?? null;
        if (subAvg === null || subAvg === undefined) continue;

        sumGen += Number(subAvg) * coeffSub;
        sumCoeffGen += coeffSub;
      }

      general_avg = sumCoeffGen > 0 ? cleanNumber(sumGen / sumCoeffGen, 4) : null;
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

  // Rangs
  applySubjectRanks(items);
  applySubjectComponentRanks(items);

  // On garde seulement l'élève concerné
  const bulletinForStudent = items.find((it) => it.student_id === studentId);

  if (!bulletinForStudent) {
    return NextResponse.json(
      { ok: false, error: "STUDENT_NOT_IN_CLASS_FOR_PERIOD" },
      { status: 404 }
    );
  }

  // ✅ Injecter annual_avg uniquement si calculé
  if (annual_avg_for_student !== null) {
    (bulletinForStudent as any).annual_avg = annual_avg_for_student;
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
