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

/**
 * Helper pour lire une chaîne depuis plusieurs clés possibles (camelCase / snake_case / alias)
 */
function pickStr(obj: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// Même logique que dans l’API admin bulletin
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

/* ───────── Types locaux ───────── */

type ClassRow = {
  id: string;
  label?: string | null;
  name?: string | null;
  level?: string | null;
  academic_year?: string | null;
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

type EvalRow = {
  id: string;
  class_id: string;
  subject_id: string | null;
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

type SubjectComponentRow = {
  id: string;
  subject_id: string;
  label: string;
  short_label: string | null;
  coeff_in_subject: number;
  order_index: number;
};

type BulletinPeriod = {
  from: string | null;
  to: string | null;
  label?: string | null;
  short_label?: string | null;
  academic_year?: string | null;
};

type BulletinSubject = {
  subject_id: string;
  subject_name: string;
  coeff_bulletin: number;
  include_in_average: boolean;
};

type BulletinSubjectAvg = {
  subject_id: string;
  avg20: number | null;
};

type BulletinSubjectComponentAvg = {
  subject_id: string;
  component_id: string;
  avg20: number | null;
};

type BulletinSummary = {
  period: BulletinPeriod;
  general_avg: number | null;
  subjects: BulletinSubject[];
  per_subject: BulletinSubjectAvg[];
  per_subject_components: BulletinSubjectComponentAvg[];
};

/* ───────── Calcul du bulletin “officiel” pour 1 élève ───────── */

async function computeBulletinSummary(params: {
  srv: SupabaseClient;
  instId: string;
  classRow: ClassRow | null;
  studentId: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  periodLabel?: string | null;
  periodShortLabel?: string | null;
  periodAcademicYear?: string | null;
}): Promise<BulletinSummary | null> {
  const {
    srv,
    instId,
    classRow,
    studentId,
    periodFrom,
    periodTo,
    periodLabel,
    periodShortLabel,
    periodAcademicYear,
  } = params;

  // ⚠️ Sans classe OU sans élève → pas de bulletin exploitable
  if (!classRow || !studentId) return null;

  const bulletinLevel = normalizeBulletinLevel(classRow.level);

  const dateFrom = periodFrom || null;
  const dateTo = periodTo || null;

  const period: BulletinPeriod = {
    from: dateFrom,
    to: dateTo,
    label: periodLabel ?? null,
    short_label: periodShortLabel ?? null,
    academic_year: periodAcademicYear ?? classRow.academic_year ?? null,
  };

  /* 1) Coeffs bulletin par matière */

  let coeffAllQuery = srv
    .from("institution_subject_coeffs")
    .select("subject_id, coeff, include_in_average, level")
    .eq("institution_id", instId);

  if (bulletinLevel) coeffAllQuery = coeffAllQuery.eq("level", bulletinLevel);

  const { data: coeffAllData, error: coeffAllErr } = await coeffAllQuery;

  if (coeffAllErr) {
    // On renvoie quand même quelque chose (bulletin minimal)
    return {
      period,
      general_avg: null,
      subjects: [],
      per_subject: [],
      per_subject_components: [],
    };
  }

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

  /* 2) Evaluations publiées (filtrées éventuellement par période) */

  let evals: EvalRow[] = [];
  {
    let evalQuery = srv
      .from("grade_evaluations")
      .select(
        "id, class_id, subject_id, eval_date, scale, coeff, is_published, subject_component_id"
      )
      .eq("class_id", classRow.id)
      .eq("is_published", true);

    if (dateFrom) evalQuery = evalQuery.gte("eval_date", dateFrom);
    if (dateTo) evalQuery = evalQuery.lte("eval_date", dateTo);

    const { data: evalData, error: evalErr } = await evalQuery;
    if (evalErr) {
      return {
        period,
        general_avg: null,
        subjects: [],
        per_subject: [],
        per_subject_components: [],
      };
    }

    evals = (evalData || []) as EvalRow[];
  }

  if (!evals.length) {
    return {
      period,
      general_avg: null,
      subjects: [],
      per_subject: [],
      per_subject_components: [],
    };
  }

  // Matières vues dans les évaluations
  const subjectIdSet = new Set<string>();
  for (const e of evals) if (e.subject_id) subjectIdSet.add(String(e.subject_id));

  // Union: coeffs + sujets des évaluations
  const subjectIdsUnionRaw = Array.from(
    new Set([...Array.from(subjectIdsFromConfig), ...Array.from(subjectIdSet)])
  );
  const subjectIds = subjectIdsUnionRaw.filter((sid) => isUuid(sid));

  if (!subjectIds.length) {
    return {
      period,
      general_avg: null,
      subjects: [],
      per_subject: [],
      per_subject_components: [],
    };
  }

  /* 3) Noms/code matières */

  const { data: subjData, error: subjErr } = await srv
    .from("subjects")
    .select("id, name, code")
    .in("id", subjectIds)
    .order("name", { ascending: true });

  if (subjErr) {
    return {
      period,
      general_avg: null,
      subjects: [],
      per_subject: [],
      per_subject_components: [],
    };
  }

  const subjects = (subjData || []) as SubjectRow[];
  const subjectById = new Map<string, SubjectRow>();
  for (const s of subjects) subjectById.set(s.id, s);

  const orderedSubjectIds = subjects.map((s) => s.id).filter((sid) => isUuid(sid));

  const subjectsForReport: BulletinSubject[] = orderedSubjectIds.map((sid) => {
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

  /* 4) Sous-matières éventuelles */

  let subjectComponentsForReport: SubjectComponentRow[] = [];
  const subjectComponentById = new Map<string, SubjectComponentRow>();
  const compsBySubject = new Map<string, SubjectComponentRow[]>();

  const { data: compData, error: compErr } = await srv
    .from("grade_subject_components")
    .select("id, subject_id, label, short_label, coeff_in_subject, order_index, is_active")
    .eq("institution_id", instId)
    .in("subject_id", orderedSubjectIds);

  if (!compErr && compData) {
    const rows = (compData || [])
      .filter((r: any) => r.is_active !== false)
      .map((r: any) => {
        const coeff =
          r.coeff_in_subject !== null && r.coeff_in_subject !== undefined
            ? Number(r.coeff_in_subject)
            : 1;
        const ord =
          r.order_index !== null && r.order_index !== undefined
            ? Number(r.order_index)
            : 1;

        const obj: SubjectComponentRow = {
          id: String(r.id),
          subject_id: String(r.subject_id),
          label: (r.label as string) || "Sous-matière",
          short_label: r.short_label ? String(r.short_label) : null,
          coeff_in_subject: cleanCoeff(coeff),
          order_index: ord,
        };
        return obj;
      }) as SubjectComponentRow[];

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

  /* 5) Notes de l'élève */

  let scores: ScoreRow[] = [];
  {
    const evalIds = evals.map((e) => e.id);

    const { data: scoreData, error: scoreErr } = await srv
      .from("student_grades")
      .select("evaluation_id, student_id, score")
      .in("evaluation_id", evalIds)
      .eq("student_id", studentId);

    if (scoreErr) {
      return {
        period,
        general_avg: null,
        subjects: [],
        per_subject: [],
        per_subject_components: [],
      };
    }

    scores = (scoreData || []) as ScoreRow[];
  }

  if (!scores.length) {
    return {
      period,
      general_avg: null,
      subjects: subjectsForReport,
      per_subject: [],
      per_subject_components: [],
    };
  }

  const evalById = new Map<string, EvalRow>();
  for (const e of evals) evalById.set(e.id, e);

  const perSubject = new Map<string, { sumWeighted: number; sumCoeff: number }>();
  const perSubjectComponent = new Map<
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

    // Agrégat par matière
    const key = ev.subject_id;
    const cell = perSubject.get(key) || { sumWeighted: 0, sumCoeff: 0 };
    cell.sumWeighted += norm20 * weight;
    cell.sumCoeff += weight;
    perSubject.set(key, cell);

    // Agrégat par sous-matière
    if (ev.subject_component_id) {
      const comp = subjectComponentById.get(ev.subject_component_id);
      if (comp) {
        const compCell =
          perSubjectComponent.get(comp.id) || {
            subject_id: comp.subject_id,
            sumWeighted: 0,
            sumCoeff: 0,
          };
        compCell.sumWeighted += norm20 * weight;
        compCell.sumCoeff += weight;
        perSubjectComponent.set(comp.id, compCell);
      }
    }
  }

  /* 6) Construire les moyennes par sous-matière et par matière */

  const per_subject_components: BulletinSubjectComponentAvg[] =
    subjectComponentsForReport.length === 0
      ? []
      : subjectComponentsForReport.map((comp) => {
          const cell = perSubjectComponent.get(comp.id);
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

  const per_subject: BulletinSubjectAvg[] = subjectsForReport.map((s) => {
    const comps = compsBySubject.get(s.subject_id) || [];

    let avg20: number | null = null;

    // Priorité: recalc depuis sous-matières si au moins une est notée
    if (comps.length) {
      let sum = 0;
      let sumW = 0;

      for (const comp of comps) {
        const cell = perSubjectComponent.get(comp.id);
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

    // Fallback: calcul direct via évaluations de la matière
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

  /* 7) Moyenne générale (mêmes règles que l’API admin) */

  let general_avg: number | null = null;
  {
    let sumGen = 0;
    let sumCoeffGen = 0;

    for (const s of subjectsForReport) {
      if (s.include_in_average === false) continue;
      const coeffSub = Number(s.coeff_bulletin ?? 0);
      if (!coeffSub || coeffSub <= 0) continue;

      const ps = per_subject.find((x) => x.subject_id === s.subject_id);
      const subAvg = ps?.avg20 ?? null;
      if (subAvg === null || subAvg === undefined) continue;

      sumGen += Number(subAvg) * coeffSub;
      sumCoeffGen += coeffSub;
    }

    general_avg = sumCoeffGen > 0 ? cleanNumber(sumGen / sumCoeffGen, 4) : null;
  }

  return {
    period,
    general_avg,
    subjects: subjectsForReport,
    per_subject,
    per_subject_components,
  };
}

/* ───────── GET /api/public/bulletins/verify ───────── */

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("c") || "").trim();
  const token = (req.nextUrl.searchParams.get("t") || "").trim();

  const srv = getSupabaseServiceClient() as unknown as SupabaseClient;

  // --- 1) Nouveau chemin: code court ?c=...

  if (code) {
    const resolved = await resolveBulletinByCode(srv, code);

    if (!resolved.ok) {
      return NextResponse.json(
        { ok: false, error: resolved.error },
        { status: 400 }
      );
    }

    const raw = (resolved.payload ?? {}) as any;

    const instId = pickStr(raw, ["instId", "inst_id"]) || "";
    let classId = pickStr(raw, ["classId", "class_id"]);
    const studentIdRaw = pickStr(raw, ["studentId", "student_id"]);
    const academicYear = pickStr(raw, ["academicYear", "academic_year"]);

    const periodFrom = pickStr(raw, ["periodFrom", "period_from", "from"]);
    const periodTo = pickStr(raw, ["periodTo", "period_to", "to"]);
    const periodLabel = pickStr(raw, ["periodLabel", "period_label", "label"]);
    const periodShortLabel = pickStr(raw, [
      "periodShortLabel",
      "period_short_label",
      "short_label",
    ]);

    if (!instId || !isUuid(instId)) {
      return NextResponse.json(
        { ok: false, error: "invalid_payload_inst" },
        { status: 400 }
      );
    }

    const studentId =
      studentIdRaw && isUuid(studentIdRaw) ? studentIdRaw : null;

    // Institution + élève en parallèle (indépendants de la classe)
    const [{ data: inst }, { data: stu }] = await Promise.all([
      srv
        .from("institutions")
        .select("id, name, code")
        .eq("id", instId)
        .maybeSingle(),
      studentId
        ? srv
            .from("students")
            .select("id, full_name, matricule, gender, birthdate, birth_place")
            .eq("id", studentId)
            .maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);

    // Helper : fetch classe + vérifie qu'elle appartient à l'institution (sécurité + cohérence)
    async function fetchClass(cid: string): Promise<ClassRow | null> {
      if (!cid || !isUuid(cid)) return null;
      const { data } = await srv
        .from("classes")
        .select("id, label, name, level, academic_year, institution_id")
        .eq("id", cid)
        .maybeSingle();

      const c = (data as any) ?? null;
      if (!c) return null;

      if (c.institution_id && String(c.institution_id) !== instId) return null;

      return {
        id: String(c.id),
        label: c.label ?? null,
        name: c.name ?? null,
        level: c.level ?? null,
        academic_year: c.academic_year ?? null,
      };
    }

    // 1) Classe direct depuis payload
    let cls: ClassRow | null = null;
    if (classId) {
      cls = await fetchClass(classId);
    }

    // 2) Fallback robuste via class_enrollments (⚠️ ne PAS filtrer end_date=null uniquement)
    if (!cls && studentId) {
      const { data: enrolls } = await srv
        .from("class_enrollments")
        .select("class_id, start_date, end_date, created_at")
        .eq("student_id", studentId)
        .order("end_date", { ascending: false, nullsFirst: true })
        .order("start_date", { ascending: false, nullsFirst: true })
        .order("created_at", { ascending: false })
        .limit(10);

      const orderedClassIds = Array.from(
        new Set(
          (enrolls || [])
            .map((e: any) => String(e.class_id || ""))
            .filter((cid: string) => isUuid(cid))
        )
      );

      for (const cid of orderedClassIds) {
        const c = await fetchClass(cid);
        if (!c) continue;

        if (academicYear && c.academic_year && String(c.academic_year) === academicYear) {
          cls = c;
          classId = cid;
          break;
        }
        if (!academicYear) {
          cls = c;
          classId = cid;
          break;
        }
      }
    }

    // ✅ Bulletin calculé si on a classe + élève
    const bulletin = await computeBulletinSummary({
      srv,
      instId,
      classRow: cls,
      studentId,
      periodFrom: periodFrom ?? null,
      periodTo: periodTo ?? null,
      periodLabel: periodLabel ?? null,
      periodShortLabel: periodShortLabel ?? null,
      periodAcademicYear: academicYear ?? null,
    });

    return NextResponse.json({
      ok: true,
      mode: "code",
      institution: inst ?? null,
      class: cls ?? null,
      student: stu ?? null,
      bulletin,
    });
  }

  // --- 2) Ancien chemin: token signé ?t=...

  if (!token) {
    return NextResponse.json(
      { ok: false, error: "missing_qr_param" },
      { status: 400 }
    );
  }

  const payload = verifyBulletinQR(token) as
    | {
        v: number;
        instId: string;
        classId: string;
        studentId: string;
        academicYear: string | null;
        periodFrom: string | null;
        periodTo: string | null;
        periodLabel: string | null;
        iat: number;
      }
    | null;

  if (!payload) {
    return NextResponse.json({ ok: false, error: "invalid_qr" }, { status: 400 });
  }

  const instIdToken = payload.instId;
  const classIdToken = payload.classId;
  const studentIdToken = payload.studentId;

  const [{ data: inst }, { data: cls }, { data: stu }] = await Promise.all([
    srv
      .from("institutions")
      .select("id, name, code")
      .eq("id", instIdToken)
      .maybeSingle(),
    srv
      .from("classes")
      .select("id, label, name, level, academic_year")
      .eq("id", classIdToken)
      .maybeSingle(),
    srv
      .from("students")
      .select("id, full_name, matricule, gender, birthdate, birth_place")
      .eq("id", studentIdToken)
      .maybeSingle(),
  ]);

  const bulletin = await computeBulletinSummary({
    srv,
    instId: instIdToken,
    classRow: (cls as ClassRow) ?? null,
    studentId: studentIdToken,
    periodFrom: payload.periodFrom,
    periodTo: payload.periodTo,
    periodLabel: payload.periodLabel,
    periodShortLabel: null,
    periodAcademicYear: payload.academicYear,
  });

  return NextResponse.json({
    ok: true,
    mode: "token",
    institution: inst ?? null,
    class: cls ?? null,
    student: stu ?? null,
    bulletin,
  });
}
