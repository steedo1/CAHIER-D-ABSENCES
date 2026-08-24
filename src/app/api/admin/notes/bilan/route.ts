// src/app/api/admin/notes/bilan/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  classMatchesEducationScope,
  getClassLevelCode,
  normalizeClassEducationType,
  readEducationScopeFromSearchParams,
  type EducationScopedClass,
} from "@/lib/education-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClassRow = EducationScopedClass & {
  id: string;
  label: string | null;
  code?: string | null;
  level: string | null;
  academic_year: string | null;
  institution_id: string | null;
  official_track_code?: string | null;
};

type GradePeriodRow = {
  id: string;
  academic_year: string | null;
  code: string | null;
  label: string | null;
  short_label: string | null;
  start_date: string | null;
  end_date: string | null;
  order_index: number | null;
  is_active: boolean | null;
  coeff?: number | null;
};

type BulletinSubject = {
  subject_id: string;
  subject_name?: string | null;
  coeff_bulletin?: number | null;
  include_in_average?: boolean | null;
};

type BulletinPerSubject = {
  subject_id: string;
  avg20: number | null;
  has_grade?: boolean | null;
  is_nc?: boolean | null;
};

type BulletinItem = {
  student_id: string;
  full_name: string;
  matricule: string | null;
  general_avg: number | null;
  rank?: number | null;
  coverage?: { has_academic_grade?: boolean | null; status?: string | null } | null;
  general_avg_status?: string | null;
  admin_forced_nc?: boolean | null;
  annual_avg?: number | null;
  annual_rank?: number | null;
  annual_avg_status?: string | null;
  admin_annual_forced_nc?: boolean | null;
  per_subject?: BulletinPerSubject[];
};

type BulletinResponse = {
  ok?: boolean;
  class?: {
    id: string;
    label?: string | null;
    level?: string | null;
    academic_year?: string | null;
    official_track_code?: string | null;
  };
  period?: { is_last?: boolean | null };
  subjects?: BulletinSubject[];
  items?: BulletinItem[];
};

type StudentPerformance = {
  student_id: string;
  full_name: string;
  nom: string;
  prenoms: string;
  matricule: string | null;
  class_id: string;
  class_label: string;
  level: string;
  cycle: string;
  moyenne: number;
  rang_classe: number | null;
  moyenne_scientifique: number | null;
  moyenne_litteraire: number | null;
};

type ClassSummary = {
  class_id: string;
  class_label: string;
  level: string;
  cycle: string;
  effectif: number;
  classes_count: number;
  moyenne_classe: number | null;
  absence_count: number;
  absence_minutes: number;
};

type Leader = {
  id: string;
  label: string;
  count: number;
  meta?: string | null;
};

const ALLOWED_ROLES = new Set(["admin", "super_admin", "founder", "educator"]);

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanNumber(value: unknown, digits = 2): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function normalizeForMatch(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeLevel(value: unknown): string {
  const raw = normalizeForMatch(value);
  if (!raw) return "Non renseigné";
  if (raw === "6e" || raw.startsWith("6")) return "6e";
  if (raw === "5e" || raw.startsWith("5")) return "5e";
  if (raw === "4e" || raw.startsWith("4")) return "4e";
  if (raw === "3e" || raw.startsWith("3")) return "3e";
  if (raw.includes("seconde") || raw.startsWith("2")) return "Seconde";
  if (raw.includes("premiere") || raw.startsWith("1")) return "Première";
  if (raw.includes("terminale") || raw.startsWith("t")) return "Terminale";
  return cleanText(value) || "Non renseigné";
}

function cycleFromLevel(level: string): string {
  const n = normalizeForMatch(level);
  if (["6e", "5e", "4e", "3e"].includes(n)) return "Premier cycle";
  if (n.includes("seconde") || n.includes("premiere") || n.includes("terminale")) {
    return "Second cycle";
  }
  return "Cycle non renseigné";
}

function educationTypeLabel(cls: ClassRow): string {
  switch (normalizeClassEducationType(cls)) {
    case "technical_secondary":
      return "Enseignement technique secondaire";
    case "vocational_training":
      return "Formation professionnelle";
    case "higher_technical_short_cycle":
      return "Enseignement supérieur technique court";
    default:
      return "Secondaire général";
  }
}

function classLevelLabel(cls: ClassRow): string {
  const level = getClassLevelCode(cls);
  return normalizeClassEducationType(cls) === "general_secondary"
    ? normalizeLevel(level)
    : cleanText(level) || "Niveau non renseigné";
}

function classCycleLabel(cls: ClassRow, level: string): string {
  return normalizeClassEducationType(cls) === "general_secondary"
    ? cycleFromLevel(level)
    : educationTypeLabel(cls);
}

function splitName(fullName: string): { nom: string; prenoms: string } {
  const parts = cleanText(fullName).split(/\s+/).filter(Boolean);
  if (!parts.length) return { nom: "", prenoms: "" };
  if (parts.length === 1) return { nom: parts[0], prenoms: "" };
  return { nom: parts[0], prenoms: parts.slice(1).join(" ") };
}

function classLabel(cls: Pick<ClassRow, "label" | "code">): string {
  return cleanText(cls.label || cls.code || "Classe");
}

function periodLabel(p: GradePeriodRow | null): string {
  if (!p) return "Période";
  return cleanText(p.short_label || p.label || p.code || "Période");
}

function isBlockingStatus(value: unknown): boolean {
  const status = normalizeForMatch(value);
  return status === "empty" || status === "admin nc" || status === "not last period";
}

function periodAverage(item: BulletinItem): number | null {
  if (item.admin_forced_nc === true) return null;
  if (item.coverage?.has_academic_grade === false) return null;
  if (isBlockingStatus(item.general_avg_status || item.coverage?.status)) return null;
  return cleanNumber(item.general_avg);
}

function annualAverage(item: BulletinItem): number | null {
  if (item.admin_annual_forced_nc === true) return null;
  if (isBlockingStatus(item.annual_avg_status)) return null;
  return cleanNumber(item.annual_avg);
}

function isScienceSubject(name: unknown): boolean {
  const n = normalizeForMatch(name);
  return (
    n.includes("mathematique") ||
    n === "math" ||
    n.includes("maths") ||
    n.includes("science physique") ||
    n.includes("physique") ||
    n.includes("chimie") ||
    n.includes("svt") ||
    n.includes("sciences de la vie") ||
    n.includes("biologie")
  );
}

function isLiterarySubject(name: unknown): boolean {
  const n = normalizeForMatch(name);
  return (
    n.includes("francais") ||
    n.includes("composition francaise") ||
    n.includes("orthographe") ||
    n.includes("oral francais") ||
    n.includes("philosophie") ||
    n.includes("anglais") ||
    n.includes("histoire") ||
    n.includes("geographie") ||
    n.includes("espagnol") ||
    n.includes("allemand")
  );
}

function average(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (!valid.length) return null;
  return cleanNumber(valid.reduce((a, b) => a + b, 0) / valid.length);
}

function topN<T>(items: T[], n: number, value: (item: T) => number | null | undefined): T[] {
  return items
    .filter((item) => {
      const v = value(item);
      return typeof v === "number" && Number.isFinite(v);
    })
    .slice()
    .sort((a, b) => Number(value(b)) - Number(value(a)))
    .slice(0, n);
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item) || "Non renseigné";
    if (!out[key]) out[key] = [];
    out[key].push(item);
  }
  return out;
}

async function loadTeacherNames(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  teacherIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = Array.from(new Set(teacherIds.map((id) => cleanText(id)).filter(Boolean)));
  if (!ids.length) return out;

  /*
    Même source que les bulletins : profiles.display_name.
    Important : ne pas sélectionner first_name/last_name ici. Sur certaines bases
    Mon Cahier, ces colonnes n'existent pas dans profiles ; Supabase renvoie alors
    une erreur et aucun nom d'enseignant n'est chargé.
  */
  const { data: profiles, error: profilesError } = await srv
    .from("profiles")
    .select("id,display_name,email")
    .in("id", ids);

  if (!profilesError) {
    for (const p of profiles || []) {
      const id = cleanText((p as any).id);
      const label = cleanText((p as any).display_name) || cleanText((p as any).email);
      if (id && label) out.set(id, label);
    }
  } else {
    console.warn("[admin/notes/bilan] profiles teacher names warning ignored", profilesError);
  }

  // Fallback non cassant pour les anciennes bases qui avaient une table teachers.
  const missingIds = ids.filter((id) => !out.has(id));
  if (missingIds.length) {
    const { data: teachers, error: teachersError } = await srv
      .from("teachers")
      .select("id,full_name")
      .in("id", missingIds);

    if (!teachersError) {
      for (const t of teachers || []) {
        const id = cleanText((t as any).id);
        const label = cleanText((t as any).full_name);
        if (id && label) out.set(id, label);
      }
    }
  }

  return out;
}

async function getContext() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();

  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ ok: false, error: "UNAUTHENTICATED" }, { status: 401 }) };
  }

  const { data: profile } = await supa
    .from("profiles")
    .select("id,institution_id,role")
    .eq("id", user.id)
    .maybeSingle();

  const { data: roleRows } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  let institutionId = cleanText((profile as any)?.institution_id);
  const roles = new Set<string>();

  const profileRole = cleanText((profile as any)?.role);
  if (profileRole) roles.add(profileRole);

  for (const row of roleRows || []) {
    const role = cleanText((row as any)?.role);
    const inst = cleanText((row as any)?.institution_id);
    if (role) roles.add(role);
    if (!institutionId && inst) institutionId = inst;
  }

  if (!institutionId) {
    return { error: NextResponse.json({ ok: false, error: "NO_INSTITUTION" }, { status: 400 }) };
  }

  const allowed = Array.from(roles).some((r) => ALLOWED_ROLES.has(r));
  if (!allowed) {
    return { error: NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }) };
  }

  return { supa, srv, user, institutionId };
}

async function getCurrentAcademicYear(srv: ReturnType<typeof getSupabaseServiceClient>, institutionId: string) {
  const { data: current } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .eq("is_current", true)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if ((current as any)?.code) return String((current as any).code);

  const { data: latest } = await srv
    .from("academic_years")
    .select("code")
    .eq("institution_id", institutionId)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (latest as any)?.code ? String((latest as any).code) : "";
}

async function fetchBulletin(req: NextRequest, cls: ClassRow, period: GradePeriodRow): Promise<BulletinResponse | null> {
  if (!period.start_date || !period.end_date) return null;

  const url = new URL("/api/admin/grades/bulletin", req.url);
  url.searchParams.set("class_id", cls.id);
  url.searchParams.set("from", period.start_date);
  url.searchParams.set("to", period.end_date);
  url.searchParams.set("published", "true");

  const cookie = req.headers.get("cookie") || "";
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: cookie ? { cookie } : undefined,
    cache: "no-store",
  });

  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as BulletinResponse | null;
  if (!json?.ok) return null;
  return json;
}

async function loadAbsenceCounts(params: {
  srv: ReturnType<typeof getSupabaseServiceClient>;
  institutionId: string;
  classes: ClassRow[];
  from: string;
  to: string;
}) {
  const out = new Map<string, { count: number; minutes: number }>();
  for (const cls of params.classes) out.set(cls.id, { count: 0, minutes: 0 });

  const { data: marks, error } = await params.srv
    .from("v_mark_minutes")
    .select("id,class_id,minutes,started_at,status")
    .eq("institution_id", params.institutionId)
    .eq("status", "absent")
    .gte("started_at", `${params.from}T00:00:00.000Z`)
    .lte("started_at", `${params.to}T23:59:59.999Z`)
    .limit(50000);

  if (error || !marks?.length) return out;

  for (const row of marks as any[]) {
    const classId = cleanText(row.class_id);
    if (!classId || !out.has(classId)) continue;
    const prev = out.get(classId)!;
    prev.count += 1;
    prev.minutes += Number(row.minutes || 0) || 0;
    out.set(classId, prev);
  }

  return out;
}

async function loadEvaluationLeaders(params: {
  srv: ReturnType<typeof getSupabaseServiceClient>;
  institutionId: string;
  classes: ClassRow[];
  from: string;
  to: string;
}) {
  const classMap = new Map(params.classes.map((c) => [c.id, c]));

  if (!classMap.size) {
    return {
      teacher_leaders: [],
      class_leaders: [],
      total_published_evaluations: 0,
    };
  }

  async function queryEvaluations(withPublicationStatus: boolean) {
    const select = withPublicationStatus
      ? "id,class_id,teacher_id,eval_date,is_published,publication_status,classes!inner(id,label,level,academic_year,institution_id)"
      : "id,class_id,teacher_id,eval_date,is_published,classes!inner(id,label,level,academic_year,institution_id)";

    let query = params.srv
      .from("grade_evaluations")
      .select(select)
      .eq("classes.institution_id", params.institutionId)
      .gte("eval_date", params.from)
      .lte("eval_date", params.to)
      .limit(50000);

    if (withPublicationStatus) {
      query = query.or("is_published.eq.true,publication_status.eq.published");
    } else {
      query = query.eq("is_published", true);
    }

    return query;
  }

  let evalRows: any[] = [];
  const first = await queryEvaluations(true);
  if (first.error) {
    const fallback = await queryEvaluations(false);
    if (!fallback.error) evalRows = (fallback.data || []) as any[];
  } else {
    evalRows = (first.data || []) as any[];
  }

  evalRows = evalRows.filter((row) =>
    classMap.has(cleanText(row.class_id)),
  );

  const teacherIds = Array.from(new Set(evalRows.map((e) => cleanText(e.teacher_id)).filter(Boolean)));
  const teacherNames = await loadTeacherNames(params.srv, teacherIds);

  const byTeacher = new Map<string, Leader>();
  const byClass = new Map<string, Leader>();

  for (const ev of evalRows) {
    const teacherId = cleanText(ev.teacher_id) || "unknown";
    const teacherLabel = teacherId === "unknown" ? "Enseignant non renseigné" : teacherNames.get(teacherId) || "Enseignant";
    const tPrev = byTeacher.get(teacherId) || { id: teacherId, label: teacherLabel, count: 0 };
    tPrev.count += 1;
    byTeacher.set(teacherId, tPrev);

    const classId = cleanText(ev.class_id);
    const cls = classMap.get(classId);
    if (!cls) continue;
    const cPrev = byClass.get(classId) || {
      id: classId,
      label: classLabel(cls),
      count: 0,
      meta: classLevelLabel(cls),
    };
    cPrev.count += 1;
    byClass.set(classId, cPrev);
  }

  const sortLeaders = (items: Leader[]) =>
    items.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "fr", { numeric: true, sensitivity: "base" }));

  return {
    teacher_leaders: sortLeaders(Array.from(byTeacher.values())).slice(0, 20),
    class_leaders: sortLeaders(Array.from(byClass.values())).slice(0, 20),
    total_published_evaluations: evalRows.length,
  };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getContext();
    if ("error" in ctx) return ctx.error;

    const { srv, institutionId } = ctx;
    const url = new URL(req.url);
    const requestedAcademicYear = cleanText(url.searchParams.get("academic_year"));
    const requestedPeriodId = cleanText(url.searchParams.get("period_id"));
    const requestedReportMode = normalizeForMatch(
      url.searchParams.get("report_mode") || url.searchParams.get("mode"),
    );
    const educationScope = readEducationScopeFromSearchParams(url.searchParams);
    const isAnnualRequested = requestedReportMode === "annual" || requestedReportMode === "annuel";

    const academicYear = requestedAcademicYear || (await getCurrentAcademicYear(srv, institutionId));

    const [{ data: institution }, { data: classesRaw }, { data: periodsRaw }] = await Promise.all([
      srv
        .from("institutions")
        .select("id,name,logo_url,phone,email,regional_direction,postal_address,status,head_name,head_title,country_name,country_motto,ministry_name,code,settings_json")
        .eq("id", institutionId)
        .maybeSingle(),
      srv
        .from("classes")
        .select("id,label,code,level,academic_year,institution_id,official_track_code,education_type,formation_code,formation_level_code")
        .eq("institution_id", institutionId)
        .eq("academic_year", academicYear)
        .order("level", { ascending: true })
        .order("label", { ascending: true }),
      srv
        .from("grade_periods")
        .select("id,academic_year,code,label,short_label,start_date,end_date,order_index,is_active,coeff")
        .eq("institution_id", institutionId)
        .eq("academic_year", academicYear)
        .order("order_index", { ascending: true }),
    ]);

    const classes = ((classesRaw || []) as ClassRow[]).filter(
      (c) => c.id && classMatchesEducationScope(c, educationScope),
    );
    const periods = ((periodsRaw || []) as GradePeriodRow[])
      .filter((p) => p.is_active !== false && p.start_date && p.end_date)
      .sort((a, b) => {
        const ai = Number(a.order_index ?? 999);
        const bi = Number(b.order_index ?? 999);
        if (ai !== bi) return ai - bi;
        return String(a.start_date || "").localeCompare(String(b.start_date || ""));
      });

    const firstPeriod = periods[0] || null;
    const lastPeriod = periods[periods.length - 1] || null;
    const selectedPeriod = isAnnualRequested
      ? lastPeriod
      : periods.find((p) => p.id === requestedPeriodId) || lastPeriod || null;

    if (!academicYear || !selectedPeriod?.start_date || !selectedPeriod?.end_date) {
      return NextResponse.json({
        ok: true,
        institution,
        academic_year: academicYear,
        periods,
        selected_period: selectedPeriod,
        mode: "period",
        top_by_class: [],
        top_by_level: {},
        top_by_cycle: {},
        top_school: [],
        top_scientific_by_level: {},
        top_literary_by_level: {},
        class_merit: [],
        class_absence_merit: [],
        teacher_evaluation_leaders: [],
        class_evaluation_leaders: [],
        meta: { message: "Aucune période exploitable." },
      });
    }

    const isAnnual = Boolean(isAnnualRequested && lastPeriod && selectedPeriod.id === lastPeriod.id);
    const reportFrom = isAnnual ? firstPeriod?.start_date || selectedPeriod.start_date : selectedPeriod.start_date;
    const reportTo = isAnnual ? lastPeriod?.end_date || selectedPeriod.end_date : selectedPeriod.end_date;

    const [absenceMap, evalLeaders] = await Promise.all([
      loadAbsenceCounts({
        srv,
        institutionId,
        classes,
        from: reportFrom,
        to: reportTo,
      }),
      loadEvaluationLeaders({
        srv,
        institutionId,
        classes,
        from: reportFrom,
        to: reportTo,
      }),
    ]);

    const bulletinResults = await Promise.all(
      classes.map((cls) => fetchBulletin(req, cls, selectedPeriod)),
    );

    const allStudents: StudentPerformance[] = [];
    const topByClass: Record<string, StudentPerformance[]> = {};
    const classSummaries: ClassSummary[] = [];

    classes.forEach((cls, index) => {
      const res = bulletinResults[index] as BulletinResponse | null;
      const classStudents: StudentPerformance[] = [];
      const subjectInfos = new Map<string, { name: string; coeff: number }>();

      for (const s of res?.subjects || []) {
        const sid = cleanText(s.subject_id);
        if (!sid) continue;
        const coeff = Number(s.coeff_bulletin || 1);
        subjectInfos.set(sid, {
          name: cleanText(s.subject_name) || "Matière",
          coeff: Number.isFinite(coeff) && coeff > 0 ? coeff : 1,
        });
      }

      for (const item of res?.items || []) {
        const avg = isAnnual ? annualAverage(item) ?? periodAverage(item) : periodAverage(item);
        if (avg === null) continue;

        let sciTotal = 0;
        let sciWeight = 0;
        let litTotal = 0;
        let litWeight = 0;

        for (const cell of item.per_subject || []) {
          const v = cleanNumber(cell.avg20);
          if (v === null) continue;
          if (cell.is_nc === true || cell.has_grade === false) continue;
          const info = subjectInfos.get(cleanText(cell.subject_id));
          const name = info?.name || "";
          const weight = info?.coeff || 1;
          if (isScienceSubject(name)) {
            sciTotal += v * weight;
            sciWeight += weight;
          }
          if (isLiterarySubject(name)) {
            litTotal += v * weight;
            litWeight += weight;
          }
        }

        const fullName = cleanText(item.full_name) || "Élève";
        const names = splitName(fullName);
        const level = classLevelLabel(cls);

        const row: StudentPerformance = {
          student_id: cleanText(item.student_id),
          full_name: fullName,
          nom: names.nom,
          prenoms: names.prenoms,
          matricule: item.matricule ?? null,
          class_id: cls.id,
          class_label: classLabel(cls),
          level,
          cycle: classCycleLabel(cls, level),
          moyenne: avg,
          rang_classe: isAnnual ? cleanNumber(item.annual_rank, 0) : cleanNumber(item.rank, 0),
          moyenne_scientifique: sciWeight > 0 ? cleanNumber(sciTotal / sciWeight) : null,
          moyenne_litteraire: litWeight > 0 ? cleanNumber(litTotal / litWeight) : null,
        };

        classStudents.push(row);
        allStudents.push(row);
      }

      classStudents.sort((a, b) => b.moyenne - a.moyenne || a.full_name.localeCompare(b.full_name, "fr"));
      topByClass[cls.id] = classStudents.slice(0, 3);

      const classAvg = average(classStudents.map((s) => s.moyenne));
      const abs = absenceMap.get(cls.id) || { count: 0, minutes: 0 };
      const level = classLevelLabel(cls);

      classSummaries.push({
        class_id: cls.id,
        class_label: classLabel(cls),
        level,
        cycle: classCycleLabel(cls, level),
        effectif: Array.isArray(res?.items) ? res!.items!.length : 0,
        classes_count: classStudents.length,
        moyenne_classe: classAvg,
        absence_count: abs.count,
        absence_minutes: Math.round(abs.minutes),
      });
    });

    const topByLevel: Record<string, StudentPerformance[]> = {};
    for (const [level, items] of Object.entries(groupBy(allStudents, (s) => s.level))) {
      topByLevel[level] = topN(items, 3, (s) => s.moyenne);
    }

    const topByCycle: Record<string, StudentPerformance[]> = {};
    for (const [cycle, items] of Object.entries(groupBy(allStudents, (s) => s.cycle))) {
      topByCycle[cycle] = topN(items, 3, (s) => s.moyenne);
    }

    const topScientificByLevel: Record<string, StudentPerformance[]> = {};
    for (const [level, items] of Object.entries(groupBy(allStudents, (s) => s.level))) {
      topScientificByLevel[level] = topN(items, 3, (s) => s.moyenne_scientifique);
    }

    const topLiteraryByLevel: Record<string, StudentPerformance[]> = {};
    for (const [level, items] of Object.entries(groupBy(allStudents, (s) => s.level))) {
      topLiteraryByLevel[level] = topN(items, 3, (s) => s.moyenne_litteraire);
    }

    const classMerit = classSummaries
      .slice()
      .sort((a, b) => {
        const av = a.moyenne_classe ?? -Infinity;
        const bv = b.moyenne_classe ?? -Infinity;
        if (bv !== av) return bv - av;
        return a.class_label.localeCompare(b.class_label, "fr", { numeric: true, sensitivity: "base" });
      });

    const classAbsenceMerit = classSummaries
      .slice()
      .sort((a, b) => {
        if (a.absence_count !== b.absence_count) return a.absence_count - b.absence_count;
        if (a.absence_minutes !== b.absence_minutes) return a.absence_minutes - b.absence_minutes;
        return (b.moyenne_classe ?? -Infinity) - (a.moyenne_classe ?? -Infinity);
      });

    return NextResponse.json({
      ok: true,
      institution,
      academic_year: academicYear,
      periods,
      selected_period: selectedPeriod,
      mode: isAnnual ? "annual" : "period",
      classes: classes.map((c) => ({
        id: c.id,
        label: classLabel(c),
        level: classLevelLabel(c),
        cycle: classCycleLabel(c, classLevelLabel(c)),
        academic_year: c.academic_year,
        education_type: normalizeClassEducationType(c),
        formation_code: c.formation_code || null,
        formation_level_code: getClassLevelCode(c) || null,
      })),
      top_by_class: classes.map((c) => ({
        class_id: c.id,
        class_label: classLabel(c),
        level: classLevelLabel(c),
        items: topByClass[c.id] || [],
      })),
      top_by_level: topByLevel,
      top_by_cycle: topByCycle,
      top_school: topN(allStudents, 3, (s) => s.moyenne),
      top_scientific_by_level: topScientificByLevel,
      top_literary_by_level: topLiteraryByLevel,
      class_merit: classMerit,
      class_absence_merit: classAbsenceMerit,
      teacher_evaluation_leaders: evalLeaders.teacher_leaders,
      class_evaluation_leaders: evalLeaders.class_leaders,
      meta: {
        period_label: isAnnual ? "Annuel" : periodLabel(selectedPeriod),
        report_from: reportFrom,
        report_to: reportTo,
        generated_at: new Date().toISOString(),
        classes_count: classes.length,
        classed_students_count: allStudents.length,
        total_published_evaluations: evalLeaders.total_published_evaluations,
        education_scope: educationScope,
      },
    });
  } catch (e: any) {
    console.error("[admin/notes/bilan] unexpected error", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "BILAN_FAILED" },
      { status: 500 }
    );
  }
}
