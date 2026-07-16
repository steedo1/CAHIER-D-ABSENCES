import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  computeTeacherScore,
  normalizeDistinctionSettings,
} from "@/lib/distinctions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

function pct(value: number, total: number) {
  if (!total) return 0;
  return Math.round(clamp((value / total) * 100) * 10) / 10;
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function niceName(profile: any) {
  const display = String(profile?.display_name || "").trim();
  const composed = `${profile?.last_name || ""} ${profile?.first_name || ""}`.trim();
  const email = String(profile?.email || "").trim();
  const phone = String(profile?.phone || "").trim();
  return display || composed || (email.includes("@") ? email.split("@")[0] : email) || phone || "Enseignant";
}

function firstRelation(value: any) {
  if (Array.isArray(value)) return value[0] || null;
  return value && typeof value === "object" ? value : null;
}

function parseYMD(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isFinite(date.getTime()) ? date : null;
}

function toYMD(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dateRange(from: string, to: string) {
  const start = parseYMD(from);
  const end = parseYMD(to);
  if (!start || !end || end.getTime() < start.getTime()) return [] as Date[];
  const dates: Date[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    dates.push(new Date(cursor.getTime()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function normalizeTime(raw: unknown) {
  const match = String(raw || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function hmToMinutes(raw: unknown) {
  const normalized = normalizeTime(raw);
  if (!normalized) return 0;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function parseWeekday(raw: unknown) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

type WeekdayMode = "iso" | "js" | "mon0";

function detectWeekdayMode(periods: any[]): WeekdayMode {
  const values = Array.from(
    new Set(
      (periods || [])
        .map((period) => parseWeekday(period?.weekday))
        .filter((value): value is number => value !== null),
    ),
  );
  if (values.includes(7)) return "iso";
  if (values.includes(6)) return "js";
  if (values.includes(0) && !values.includes(5)) return "mon0";
  return "js";
}

function jsDayToDbWeekday(jsDay: number, mode: WeekdayMode) {
  if (mode === "js") return jsDay;
  if (mode === "iso") return jsDay === 0 ? 7 : jsDay;
  return (jsDay + 6) % 7;
}

function toIsoRange(from: string, to: string) {
  return {
    fromIso: `${from}T00:00:00.000Z`,
    toIsoExclusive: new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000,
  };
}

function plannedKey(teacherId: string, classId: string, date: string, startTime: string) {
  return `${teacherId}|${classId}|${date}|${startTime}`;
}

function sessionKey(row: any) {
  const start = String(row?.started_at || "");
  return plannedKey(
    String(row?.teacher_id || ""),
    String(row?.class_id || ""),
    start.slice(0, 10),
    start.slice(11, 16),
  );
}

function isObservedSession(row: any) {
  if (!row?.actual_call_at || !row?.started_at) return false;
  const start = new Date(row.started_at).getTime();
  const actual = new Date(row.actual_call_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(actual) || actual < start) return false;
  const status = String(row?.status || "").toLowerCase();
  return Boolean(row?.ended_at) || ["submitted", "closed", "completed", "validated"].includes(status);
}

function dateCoveredByApprovedAbsence(
  teacherId: string,
  date: string,
  absencesByTeacher: Map<string, Array<{ start: string; end: string }>>,
) {
  return (absencesByTeacher.get(teacherId) || []).some(
    (absence) => date >= absence.start && date <= absence.end,
  );
}

function assignmentOverlapsPeriod(row: any, from: string, to: string) {
  const start = String(row?.start_date || "").slice(0, 10);
  const end = String(row?.end_date || "").slice(0, 10);
  if (start && start > to) return false;
  if (end && end < from) return false;
  return true;
}

function assignmentActiveOn(row: any, date: string) {
  const start = String(row?.start_date || "").slice(0, 10);
  const end = String(row?.end_date || "").slice(0, 10);
  if (start && start > date) return false;
  if (end && end < date) return false;
  return true;
}

function normalizePeriodToken(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function periodTermNumber(...values: unknown[]): 1 | 2 | 3 | null {
  const token = normalizePeriodToken(values.filter(Boolean).join(" "));
  if (!token) return null;
  if (token === "1" || /\b(t1|s1|trimestre 1|trimestre i|1er trimestre|premier trimestre|semestre 1|semestre i|1er semestre|premier semestre|periode 1|term 1|term1)\b/.test(token)) return 1;
  if (token === "2" || /\b(t2|s2|trimestre 2|trimestre ii|2e trimestre|2eme trimestre|deuxieme trimestre|semestre 2|semestre ii|2e semestre|2eme semestre|deuxieme semestre|periode 2|term 2|term2)\b/.test(token)) return 2;
  if (token === "3" || /\b(t3|trimestre 3|trimestre iii|3e trimestre|3eme trimestre|troisieme trimestre|periode 3|term 3|term3)\b/.test(token)) return 3;
  return null;
}

function enrollmentActiveOn(row: any, date: string) {
  const start = String(row?.start_date || "").slice(0, 10);
  const end = String(row?.end_date || "").slice(0, 10);
  if (start && start > date) return false;
  if (end && end < date) return false;
  return true;
}

function publishedEvaluation(row: any) {
  return row?.is_published === true || String(row?.publication_status || "").toLowerCase() === "published";
}

function piecewise(value: number, points: Array<[number, number]>) {
  if (!Number.isFinite(value) || !points.length) return 0;
  const sorted = points.slice().sort((a, b) => a[0] - b[0]);
  if (value < sorted[0][0]) return 0;
  for (let index = 1; index < sorted.length; index += 1) {
    const [x1, y1] = sorted[index - 1];
    const [x2, y2] = sorted[index];
    if (value <= x2) {
      if (x2 === x1) return y2;
      return y1 + ((value - x1) / (x2 - x1)) * (y2 - y1);
    }
  }
  return sorted[sorted.length - 1][1];
}

function pedagogicalMeanScoreRate(mean20: number | null) {
  if (mean20 === null) return 0;
  const points = piecewise(mean20, [
    [8, 2],
    [10, 4],
    [12, 6],
    [14, 8],
    [16, 10],
  ]);
  return clamp((points / 10) * 100);
}

function successScoreRate(successRate: number | null) {
  if (successRate === null) return 0;
  const points = piecewise(successRate, [
    [40, 6],
    [60, 9],
    [80, 12],
    [90, 15],
  ]);
  return clamp((points / 15) * 100);
}

function noteCoverageScoreRate(coverage: number) {
  const points = piecewise(coverage, [
    [70, 5],
    [80, 7],
    [90, 9],
    [95, 10],
  ]);
  return clamp((points / 10) * 100);
}

function studentPresenceScoreRate(rate: number | null) {
  if (rate === null) return 0;
  const points = piecewise(rate, [
    [75, 2],
    [80, 4],
    [85, 6],
    [90, 8],
    [95, 10],
  ]);
  return clamp((points / 10) * 100);
}

function strictTeacherCompare(a: any, b: any) {
  return (
    Number(b.score || 0) - Number(a.score || 0) ||
    Number(b.metrics?.results_points || 0) - Number(a.metrics?.results_points || 0) ||
    Number(b.metrics?.attendance_rate || 0) - Number(a.metrics?.attendance_rate || 0) ||
    Number(b.metrics?.textbook_session_coverage_rate || 0) -
      Number(a.metrics?.textbook_session_coverage_rate || 0) ||
    Number(b.metrics?.evaluation_regularity_rate || 0) -
      Number(a.metrics?.evaluation_regularity_rate || 0) ||
    String(a.teacher_name || "").localeCompare(String(b.teacher_name || ""), "fr")
  );
}

async function getContext() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) return { error: "unauthorized" as const };

  const { data: profile } = await supa
    .from("profiles")
    .select("institution_id,role")
    .eq("id", user.id)
    .maybeSingle();

  let institutionId = String((profile as any)?.institution_id || "").trim();
  const roles = new Set<string>();
  if ((profile as any)?.role) roles.add(String((profile as any).role));

  const { data: rows } = await srv
    .from("user_roles")
    .select("role,institution_id")
    .eq("profile_id", user.id);

  for (const row of rows || []) {
    const role = String((row as any).role || "");
    const inst = String((row as any).institution_id || "").trim();
    if (role) roles.add(role);
    if (!institutionId && inst) institutionId = inst;
  }

  if (!institutionId) return { error: "no_institution" as const };
  if (!["admin", "super_admin", "founder"].some((role) => roles.has(role))) {
    return { error: "forbidden" as const };
  }

  return { institutionId, srv };
}

export async function GET(req: NextRequest) {
  const ctx = await getContext();
  if ("error" in ctx) {
    return NextResponse.json(
      { ok: false, error: ctx.error },
      { status: ctx.error === "unauthorized" ? 401 : 403 },
    );
  }

  const url = new URL(req.url);
  const from = String(url.searchParams.get("from") || "").trim();
  const requestedTo = String(url.searchParams.get("to") || "").trim();
  const academicYear = String(url.searchParams.get("academic_year") || "").trim();
  const periodCode = String(url.searchParams.get("period_code") || "").trim();
  const periodLabel = String(url.searchParams.get("period_label") || "").trim();
  const selectedTerm = periodTermNumber(periodCode, periodLabel);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(requestedTo)) {
    return NextResponse.json({ ok: false, error: "from_and_to_required" }, { status: 400 });
  }

  const fromDate = parseYMD(from);
  const requestedToDate = parseYMD(requestedTo);
  if (!fromDate || !requestedToDate || requestedToDate.getTime() < fromDate.getTime()) {
    return NextResponse.json({ ok: false, error: "invalid_date_range" }, { status: 400 });
  }

  const today = parseYMD(toYMD(new Date()))!;
  const effectiveToDate = requestedToDate.getTime() > today.getTime() ? today : requestedToDate;
  const to = toYMD(effectiveToDate);

  const { institutionId, srv } = ctx;
  const { data: inst } = await srv
    .from("institutions")
    .select("name,settings_json")
    .eq("id", institutionId)
    .maybeSingle();
  const teacherSettings = normalizeDistinctionSettings(
    (inst as any)?.settings_json?.distinction_settings,
  ).teachers;

  const { data: roleRows, error: rolesError } = await srv
    .from("user_roles")
    .select("profile_id")
    .eq("institution_id", institutionId)
    .eq("role", "teacher");

  if (rolesError) {
    return NextResponse.json({ ok: false, error: rolesError.message }, { status: 400 });
  }

  const teacherIds: string[] = Array.from(
    new Set<string>((roleRows || []).map((row: any) => String(row.profile_id || "")).filter(Boolean)),
  );

  if (!teacherIds.length) {
    return NextResponse.json({
      ok: true,
      institution_name: (inst as any)?.name || "Établissement",
      settings: teacherSettings,
      criteria_warnings: [],
      items: [],
    });
  }

  const [profilesResult, teacherSubjectsResult, classTeachersResult] = await Promise.all([
    srv.from("profiles").select("id,display_name,email,phone").in("id", teacherIds),
    srv
      .from("teacher_subjects")
      .select("profile_id,subject_id")
      .eq("institution_id", institutionId)
      .in("profile_id", teacherIds),
    srv
      .from("class_teachers")
      .select(
        "teacher_id,class_id,subject_id,start_date,end_date,classes!inner(id,label,academic_year,institution_id)",
      )
      .eq("institution_id", institutionId)
      .in("teacher_id", teacherIds),
  ]);

  if (profilesResult.error) {
    return NextResponse.json({ ok: false, error: profilesResult.error.message }, { status: 400 });
  }

  const names = new Map<string, string>();
  for (const profile of profilesResult.data || []) {
    const id = String((profile as any).id || "");
    if (id) names.set(id, niceName(profile));
  }

  const classTeacherRows = (classTeachersResult.data || []).filter((row: any) => {
    if (!assignmentOverlapsPeriod(row, from, to)) return false;
    const cls = firstRelation(row?.classes);
    if (academicYear && String(cls?.academic_year || "") !== academicYear) return false;
    return true;
  });

  const assignedClassesByTeacher = new Map<string, Set<string>>();
  const assignedClassSubjectsByTeacher = new Map<string, Set<string>>();
  const subjectIdsByTeacher = new Map<string, Set<string>>();
  for (const teacherId of teacherIds) {
    assignedClassesByTeacher.set(teacherId, new Set());
    assignedClassSubjectsByTeacher.set(teacherId, new Set());
    subjectIdsByTeacher.set(teacherId, new Set());
  }

  for (const row of classTeacherRows as any[]) {
    const teacherId = String(row.teacher_id || "");
    const classId = String(row.class_id || "");
    const subjectId = String(row.subject_id || "");
    if (!teacherId || !classId) continue;
    assignedClassesByTeacher.get(teacherId)?.add(classId);
    assignedClassSubjectsByTeacher.get(teacherId)?.add(`${classId}|${subjectId || "matiere"}`);
    if (subjectId) subjectIdsByTeacher.get(teacherId)?.add(subjectId);
  }
  if (!teacherSubjectsResult.error) {
    for (const row of teacherSubjectsResult.data || []) {
      const teacherId = String((row as any).profile_id || "");
      const subjectId = String((row as any).subject_id || "");
      if (teacherId && subjectId) subjectIdsByTeacher.get(teacherId)?.add(subjectId);
    }
  }

  const rawSubjectIds: string[] = Array.from(
    new Set<string>(Array.from(subjectIdsByTeacher.values()).flatMap((set) => Array.from(set))),
  );
  const institutionSubjectById = new Map<string, { subjectId: string; customName: string }>();
  const institutionSubjectByCanonicalId = new Map<string, { subjectId: string; customName: string }>();
  const canonicalSubjectIds = new Set<string>(rawSubjectIds);

  const { data: institutionSubjectRows } = await srv
    .from("institution_subjects")
    .select("id,subject_id,custom_name")
    .eq("institution_id", institutionId);

  for (const row of institutionSubjectRows || []) {
    const id = String((row as any).id || "");
    const subjectId = String((row as any).subject_id || "");
    const customName = String((row as any).custom_name || "").trim();
    const normalized = { subjectId, customName };
    if (id) institutionSubjectById.set(id, normalized);
    if (subjectId && !institutionSubjectByCanonicalId.has(subjectId)) {
      institutionSubjectByCanonicalId.set(subjectId, normalized);
    }
    if (subjectId) canonicalSubjectIds.add(subjectId);
  }

  const subjectNameById = new Map<string, string>();
  if (canonicalSubjectIds.size) {
    const { data: subjectNameRows } = await srv
      .from("subjects")
      .select("id,name")
      .in("id", Array.from(canonicalSubjectIds));
    for (const row of subjectNameRows || []) {
      const id = String((row as any).id || "");
      const name = String((row as any).name || "").trim();
      if (id && name) subjectNameById.set(id, name);
    }
  }

  const resolveSubjectLabel = (rawId: string) => {
    const institutionSubject = institutionSubjectById.get(rawId);
    if (institutionSubject) {
      return (
        institutionSubject.customName ||
        subjectNameById.get(institutionSubject.subjectId) ||
        subjectNameById.get(rawId) ||
        ""
      );
    }
    const linked = institutionSubjectByCanonicalId.get(rawId);
    return linked?.customName || subjectNameById.get(rawId) || "";
  };

  const canonicalSubjectId = (rawId: unknown) => {
    const id = String(rawId || "").trim();
    if (!id) return "";
    return institutionSubjectById.get(id)?.subjectId || id;
  };

  const assignmentsByTeacherClass = new Map<string, any[]>();
  for (const row of classTeacherRows as any[]) {
    const teacherId = String(row.teacher_id || "");
    const classId = String(row.class_id || "");
    if (!teacherId || !classId) continue;
    const key = `${teacherId}|${classId}`;
    const current = assignmentsByTeacherClass.get(key) || [];
    current.push(row);
    assignmentsByTeacherClass.set(key, current);
  }

  const teacherAssignedToClassSubjectOn = (
    teacherId: string,
    classId: string,
    subjectId: unknown,
    date: string,
  ) => {
    const activeAssignments = (
      assignmentsByTeacherClass.get(`${teacherId}|${classId}`) || []
    ).filter((assignment) => assignmentActiveOn(assignment, date));
    const expectedSubject = canonicalSubjectId(subjectId);
    if (expectedSubject) {
      return activeAssignments.some(
        (assignment) => canonicalSubjectId(assignment.subject_id) === expectedSubject,
      );
    }
    const activeSubjects = new Set(
      activeAssignments.map((assignment) => canonicalSubjectId(assignment.subject_id)).filter(Boolean),
    );
    return activeSubjects.size === 1;
  };

  const subjects = new Map<string, string[]>();
  for (const teacherId of teacherIds) {
    const labels = Array.from(subjectIdsByTeacher.get(teacherId) || [])
      .map(resolveSubjectLabel)
      .map((label) => label.trim())
      .filter(Boolean);
    subjects.set(teacherId, Array.from(new Set(labels)));
  }

  const { fromIso, toIsoExclusive } = toIsoRange(from, to);
  const [periodsResult, timetablesResult, absencesResult, sessionsResult, evaluationsResult] =
    await Promise.all([
      srv
        .from("institution_periods")
        .select("id,weekday,start_time,end_time")
        .eq("institution_id", institutionId),
      srv
        .from("teacher_timetables")
        .select("id,teacher_id,class_id,subject_id,weekday,period_id")
        .eq("institution_id", institutionId)
        .in("teacher_id", teacherIds),
      srv
        .from("teacher_absence_requests")
        .select("teacher_profile_id,start_date,end_date,status")
        .eq("institution_id", institutionId)
        .eq("status", "approved")
        .lte("start_date", to)
        .gte("end_date", from),
      srv
        .from("teacher_sessions")
        .select(
          "id,teacher_id,class_id,subject_id,started_at,actual_call_at,ended_at,status,expected_minutes",
        )
        .eq("institution_id", institutionId)
        .in("teacher_id", teacherIds)
        .gte("started_at", fromIso)
        .lt("started_at", new Date(toIsoExclusive).toISOString()),
      srv
        .from("grade_evaluations")
        .select(
          "id,teacher_id,is_published,publication_status,published_at,eval_date,eval_kind,class_id,subject_id,scale,classes!inner(institution_id,academic_year)",
        )
        .eq("classes.institution_id", institutionId)
        .in("teacher_id", teacherIds)
        .gte("eval_date", from)
        .lte("eval_date", to),
    ]);

  const evaluationRowsInYear = (evaluationsResult.data || []).filter((row: any) => {
    if (!academicYear) return true;
    const cls = firstRelation(row?.classes);
    return String(cls?.academic_year || "") === academicYear;
  });
  const allEvaluationRows = evaluationRowsInYear.filter((row: any) =>
    teacherAssignedToClassSubjectOn(
      String(row.teacher_id || ""),
      String(row.class_id || ""),
      row.subject_id,
      String(row.eval_date || "").slice(0, 10),
    ),
  );
  const evaluationsExcludedUnassigned = evaluationRowsInYear.length - allEvaluationRows.length;
  const publishedEvaluationRows = allEvaluationRows.filter(publishedEvaluation);

  for (const row of allEvaluationRows as any[]) {
    const teacherId = String(row.teacher_id || "");
    const subjectLabel = resolveSubjectLabel(String(row.subject_id || ""));
    if (teacherId && subjectLabel) {
      const current = subjects.get(teacherId) || [];
      if (!current.includes(subjectLabel)) current.push(subjectLabel);
      subjects.set(teacherId, current);
    }
  }

  const periods = periodsResult.data || [];
  const timetables = timetablesResult.data || [];
  const sessionRows = sessionsResult.data || [];
  const weekdayMode = detectWeekdayMode(periods);
  const periodById = new Map<
    string,
    { weekday: number | null; startTime: string | null; startMinutes: number }
  >(
    periods.map((period: any) => [
      String(period.id),
      {
        weekday: parseWeekday(period.weekday),
        startTime: normalizeTime(period.start_time),
        startMinutes: hmToMinutes(period.start_time),
      },
    ]),
  );

  const absencesByTeacher = new Map<string, Array<{ start: string; end: string }>>();
  for (const row of absencesResult.data || []) {
    const teacherId = String((row as any).teacher_profile_id || "");
    const start = String((row as any).start_date || "");
    const end = String((row as any).end_date || "");
    if (!teacherId || !start || !end) continue;
    const current = absencesByTeacher.get(teacherId) || [];
    current.push({ start, end });
    absencesByTeacher.set(teacherId, current);
  }

  const attendanceSourcesReadable =
    !periodsResult.error &&
    !timetablesResult.error &&
    !sessionsResult.error &&
    !absencesResult.error &&
    !classTeachersResult.error;

  const now = new Date();
  const todayYmd = toYMD(now);
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const plannedSlots = new Map<
    string,
    { teacherId: string; classId: string; justified: boolean }
  >();

  for (const date of dateRange(from, to)) {
    const ymd = toYMD(date);
    const dbWeekday = jsDayToDbWeekday(date.getUTCDay(), weekdayMode);
    for (const timetable of timetables as any[]) {
      const teacherId = String(timetable.teacher_id || "");
      const classId = String(timetable.class_id || "");
      const period = periodById.get(String(timetable.period_id || ""));
      if (!teacherId || !classId || !period?.startTime) continue;
      if (!teacherAssignedToClassSubjectOn(teacherId, classId, timetable.subject_id, ymd)) continue;
      const timetableWeekday = parseWeekday(timetable.weekday) ?? period.weekday;
      if (timetableWeekday !== dbWeekday) continue;
      if (ymd === todayYmd && period.startMinutes > nowMinutes) continue;
      const subjectId = canonicalSubjectId(timetable.subject_id) || "matiere";
      const key = `${plannedKey(teacherId, classId, ymd, period.startTime)}|${subjectId}`;
      if (plannedSlots.has(key)) continue;
      plannedSlots.set(key, {
        teacherId,
        classId,
        justified: dateCoveredByApprovedAbsence(teacherId, ymd, absencesByTeacher),
      });
    }
  }

  const sessionByExactKey = new Map<string, any>();
  for (const row of sessionRows as any[]) {
    if (!isObservedSession(row)) continue;
    const subjectId = canonicalSubjectId(row.subject_id) || "matiere";
    const exact = `${sessionKey(row)}|${subjectId}`;
    const existing = sessionByExactKey.get(exact);
    if (!existing || (!existing.ended_at && row.ended_at)) sessionByExactKey.set(exact, row);
  }

  const sessionMetrics = new Map<
    string,
    {
      planned: number;
      completed: number;
      punctual: number;
      lateness: number;
      justified: number;
      observedSessionIds: string[];
    }
  >();
  for (const teacherId of teacherIds) {
    sessionMetrics.set(teacherId, {
      planned: 0,
      completed: 0,
      punctual: 0,
      lateness: 0,
      justified: 0,
      observedSessionIds: [],
    });
  }

  const consumedSessionIds = new Set<string>();
  for (const [key, slot] of plannedSlots.entries()) {
    const metric = sessionMetrics.get(slot.teacherId);
    if (!metric) continue;
    if (slot.justified) {
      metric.justified += 1;
      continue;
    }
    metric.planned += 1;
    const row = sessionByExactKey.get(key);
    if (!row) continue;
    const sessionId = String(row.id || "");
    if (!sessionId || consumedSessionIds.has(sessionId)) continue;
    consumedSessionIds.add(sessionId);
    metric.completed += 1;
    metric.observedSessionIds.push(sessionId);
    const lateness = Math.max(
      0,
      Math.round(
        (new Date(row.actual_call_at).getTime() - new Date(row.started_at).getTime()) / 60_000,
      ),
    );
    metric.lateness += lateness;
    if (lateness <= teacherSettings.punctuality_tolerance_minutes) metric.punctual += 1;
  }

  const publishedEvalIds: string[] = publishedEvaluationRows
    .map((row: any) => String(row.id || ""))
    .filter(Boolean);
  const allRelevantClassIds: string[] = Array.from(
    new Set<string>([
      ...classTeacherRows.map((row: any) => String(row.class_id || "")),
      ...allEvaluationRows.map((row: any) => String(row.class_id || "")),
      ...sessionRows.map((row: any) => String(row.class_id || "")),
    ].filter(Boolean)),
  );

  const [publishedScoresResult, enrollmentsResult] = await Promise.all([
    publishedEvalIds.length
      ? srv
          .from("grade_published_scores")
          .select("evaluation_id,student_id,score,scale,is_current")
          .in("evaluation_id", publishedEvalIds)
          .eq("is_current", true)
      : Promise.resolve({ data: [], error: null } as any),
    allRelevantClassIds.length
      ? srv
          .from("class_enrollments")
          .select("class_id,student_id,start_date,end_date")
          .eq("institution_id", institutionId)
          .in("class_id", allRelevantClassIds)
      : Promise.resolve({ data: [], error: null } as any),
  ]);

  const enrollmentsByClass = new Map<string, any[]>();
  for (const row of enrollmentsResult.data || []) {
    const classId = String((row as any).class_id || "");
    if (!classId) continue;
    const current = enrollmentsByClass.get(classId) || [];
    current.push(row);
    enrollmentsByClass.set(classId, current);
  }
  const rosterCache = new Map<string, Set<string>>();
  const rosterFor = (classId: string, date: string) => {
    const key = `${classId}|${date}`;
    const cached = rosterCache.get(key);
    if (cached) return cached;
    const set = new Set<string>();
    for (const row of enrollmentsByClass.get(classId) || []) {
      if (!enrollmentActiveOn(row, date)) continue;
      const studentId = String((row as any).student_id || "");
      if (studentId) set.add(studentId);
    }
    rosterCache.set(key, set);
    return set;
  };

  const evaluationById = new Map(
    publishedEvaluationRows.map((row: any) => [String(row.id || ""), row] as const),
  );
  const scoresByEvaluation = new Map<string, Map<string, number>>();
  for (const row of publishedScoresResult.data || []) {
    const evaluationId = String((row as any).evaluation_id || "");
    const studentId = String((row as any).student_id || "");
    const evaluation: any = evaluationById.get(evaluationId);
    const score = Number((row as any).score);
    const scale = Number((row as any).scale || evaluation?.scale || 20);
    if (!evaluationId || !studentId || !Number.isFinite(score) || !Number.isFinite(scale) || scale <= 0) {
      continue;
    }
    const mark20 = clamp((score / scale) * 20, 0, 20);
    const current = scoresByEvaluation.get(evaluationId) || new Map<string, number>();
    current.set(studentId, mark20);
    scoresByEvaluation.set(evaluationId, current);
  }

  type EvalTeacherAgg = {
    publishedTotal: number;
    validTotal: number;
    expectedNotes: number;
    foundNotes: number;
    invalidCoverage: number;
    validByClass: Map<string, number>;
    classSubjectStudents: Map<string, Map<string, number[]>>;
  };
  const evalAggByTeacher = new Map<string, EvalTeacherAgg>();
  for (const teacherId of teacherIds) {
    evalAggByTeacher.set(teacherId, {
      publishedTotal: 0,
      validTotal: 0,
      expectedNotes: 0,
      foundNotes: 0,
      invalidCoverage: 0,
      validByClass: new Map(),
      classSubjectStudents: new Map(),
    });
  }

  for (const evaluation of publishedEvaluationRows as any[]) {
    const teacherId = String(evaluation.teacher_id || "");
    const classId = String(evaluation.class_id || "");
    const subjectId = canonicalSubjectId(evaluation.subject_id) || "matiere";
    const evalDate = String(evaluation.eval_date || "").slice(0, 10);
    const agg = evalAggByTeacher.get(teacherId);
    if (!agg || !classId || !evalDate) continue;
    agg.publishedTotal += 1;
    const roster = rosterFor(classId, evalDate);
    const scores = scoresByEvaluation.get(String(evaluation.id || "")) || new Map();
    if (!roster.size) {
      agg.invalidCoverage += 1;
      continue;
    }
    const usableScores = Array.from(scores.entries()).filter(([studentId]) => roster.has(studentId));
    agg.expectedNotes += roster.size;
    agg.foundNotes += usableScores.length;
    const coverage = pct(usableScores.length, roster.size);
    if (coverage < teacherSettings.minimum_evaluation_note_coverage_rate) {
      agg.invalidCoverage += 1;
      continue;
    }
    agg.validTotal += 1;
    agg.validByClass.set(classId, (agg.validByClass.get(classId) || 0) + 1);
    const groupKey = `${classId}|${subjectId}`;
    const students = agg.classSubjectStudents.get(groupKey) || new Map<string, number[]>();
    for (const [studentId, mark20] of usableScores) {
      const current = students.get(studentId) || [];
      current.push(mark20);
      students.set(studentId, current);
    }
    agg.classSubjectStudents.set(groupKey, students);
  }

  const pedagogicalByTeacher = new Map<
    string,
    { mean20: number | null; successRate: number | null; groups: number }
  >();
  for (const teacherId of teacherIds) {
    const agg = evalAggByTeacher.get(teacherId)!;
    const groupMeans: number[] = [];
    const groupSuccessRates: number[] = [];
    for (const students of agg.classSubjectStudents.values()) {
      const studentMeans = Array.from(students.values())
        .filter((values) => values.length > 0)
        .map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
      if (!studentMeans.length) continue;
      groupMeans.push(studentMeans.reduce((sum, value) => sum + value, 0) / studentMeans.length);
      groupSuccessRates.push(pct(studentMeans.filter((value) => value >= 10).length, studentMeans.length));
    }
    pedagogicalByTeacher.set(teacherId, {
      mean20: groupMeans.length
        ? round2(groupMeans.reduce((sum, value) => sum + value, 0) / groupMeans.length)
        : null,
      successRate: groupSuccessRates.length
        ? round1(groupSuccessRates.reduce((sum, value) => sum + value, 0) / groupSuccessRates.length)
        : null,
      groups: groupMeans.length,
    });
  }

  const textbookMetrics = new Map<
    string,
    {
      expected: number;
      completed: number;
      assignments: number;
      sessions: number;
      unscopedAssignments: number;
    }
  >();
  for (const teacherId of teacherIds) {
    textbookMetrics.set(teacherId, {
      expected: 0,
      completed: 0,
      assignments: 0,
      sessions: 0,
      unscopedAssignments: 0,
    });
  }
  let textbookReadable = true;
  let textbookSessionsFound = 0;
  let textbookCompletedItemsFound = 0;
  let textbookAssignmentsExcludedUnassigned = 0;

  try {
    const [assignmentsResult, textbookSessionsResult] = await Promise.all([
      srv
        .from("textbook_progression_class_assignments")
        .select(
          "id,teacher_id,class_id,subject_id,institution_subject_id,progression:textbook_progression_templates(id,academic_year,subject_id,institution_subject_id)",
        )
        .eq("institution_id", institutionId)
        .eq("is_active", true),
      srv
        .from("textbook_lesson_sessions")
        .select("id,assignment_id,teacher_id,session_date,item_id")
        .eq("institution_id", institutionId)
        .gte("session_date", from)
        .lte("session_date", to),
    ]);
    if (assignmentsResult.error) throw assignmentsResult.error;
    if (textbookSessionsResult.error) throw textbookSessionsResult.error;

    const assignments = (assignmentsResult.data || []).filter((row: any) => {
      if (!academicYear) return true;
      const progression = firstRelation(row?.progression);
      return String(progression?.academic_year || "") === academicYear;
    });

    const progressionAssignmentSubjectId = (assignment: any) =>
      assignment?.subject_id ||
      assignment?.institution_subject_id ||
      firstRelation(assignment?.progression)?.subject_id ||
      firstRelation(assignment?.progression)?.institution_subject_id ||
      "";

    const effectiveTeacher = new Map<string, string>();
    for (const assignment of assignments as any[]) {
      const assignmentId = String(assignment.id || "");
      const classId = String(assignment.class_id || "");
      const subjectCandidates = new Set(
        [
          assignment.subject_id,
          assignment.institution_subject_id,
          firstRelation(assignment.progression)?.subject_id,
          firstRelation(assignment.progression)?.institution_subject_id,
        ]
          .map(canonicalSubjectId)
          .filter(Boolean),
      );
      const officialCandidates = subjectCandidates.size
        ? (classTeacherRows as any[]).filter(
            (row) =>
              String(row.class_id || "") === classId &&
              subjectCandidates.has(canonicalSubjectId(row.subject_id)),
          )
        : [];
      const officialTeacherIds = Array.from(
        new Set(officialCandidates.map((row) => String(row.teacher_id || "")).filter(Boolean)),
      );

      let teacherId = String(assignment.teacher_id || "");
      if (teacherId && !officialTeacherIds.includes(teacherId)) teacherId = "";
      if (!teacherId && officialTeacherIds.length === 1) teacherId = officialTeacherIds[0];
      if (assignmentId && teacherIds.includes(teacherId)) {
        effectiveTeacher.set(assignmentId, teacherId);
      } else if (assignmentId) {
        textbookAssignmentsExcludedUnassigned += 1;
      }
    }

    const progressionIds: string[] = Array.from(
      new Set<string>(
        assignments
          .map((row: any) => String(firstRelation(row.progression)?.id || ""))
          .filter(Boolean),
      ),
    );
    const actionableItemsByProgression = new Map<string, any[]>();
    if (progressionIds.length) {
      const { data: itemRows, error } = await srv
        .from("textbook_progression_items")
        .select("id,progression_id,item_type,trimester,planned_duration_minutes,planned_sessions_count")
        .eq("institution_id", institutionId)
        .in("progression_id", progressionIds);
      if (error) throw error;
      for (const row of itemRows || []) {
        const actionable =
          ["lesson", "chapter", "activity", "assessment", "revision"].includes(
            String((row as any).item_type || ""),
          ) ||
          Number((row as any).planned_duration_minutes || 0) > 0 ||
          Number((row as any).planned_sessions_count || 0) > 0;
        if (!actionable) continue;
        const progressionId = String((row as any).progression_id || "");
        const current = actionableItemsByProgression.get(progressionId) || [];
        current.push(row);
        actionableItemsByProgression.set(progressionId, current);
      }
    }

    const expectedItemIdsByProgression = new Map<string, Set<string>>();
    const unscopedProgressionIds = new Set<string>();
    for (const progressionId of progressionIds) {
      const rows = actionableItemsByProgression.get(progressionId) || [];
      const itemTerms = rows.map((row: any) => periodTermNumber(row.trimester));
      const periodScopeRequested = Boolean(periodCode || periodLabel);
      const hasUnrecognizedTerms = itemTerms.some((term) => term === null);
      if (
        rows.length > 0 &&
        ((periodScopeRequested && selectedTerm === null) ||
          (selectedTerm !== null && hasUnrecognizedTerms))
      ) {
        unscopedProgressionIds.add(progressionId);
        expectedItemIdsByProgression.set(progressionId, new Set());
        continue;
      }
      const expectedIds = new Set<string>();
      for (const row of rows) {
        const itemId = String((row as any).id || "");
        if (!itemId) continue;
        if (selectedTerm === null) {
          expectedIds.add(itemId);
          continue;
        }
        const itemTerm = periodTermNumber((row as any).trimester);
        if (itemTerm !== null && itemTerm <= selectedTerm) expectedIds.add(itemId);
      }
      expectedItemIdsByProgression.set(progressionId, expectedIds);
    }

    const assignmentById = new Map(assignments.map((row: any) => [String(row.id || ""), row]));
    const expectedItemIdsByAssignment = new Map<string, Set<string>>();
    for (const assignmentId of effectiveTeacher.keys()) {
      const assignment: any = assignmentById.get(assignmentId);
      const progressionId = String(firstRelation(assignment?.progression)?.id || "");
      expectedItemIdsByAssignment.set(
        assignmentId,
        expectedItemIdsByProgression.get(progressionId) || new Set<string>(),
      );
    }

    const completionByAssignment = new Map<string, number>();
    const assignmentIds = Array.from(effectiveTeacher.keys());
    if (assignmentIds.length) {
      const { data: completionRows, error } = await srv
        .from("textbook_lesson_completions")
        .select("assignment_id,item_id,status,completed_at,updated_at")
        .eq("institution_id", institutionId)
        .in("assignment_id", assignmentIds)
        .in("status", ["completed", "validated"]);
      if (error) throw error;
      const seen = new Set<string>();
      const progressionCutoff = new Date(toIsoExclusive).getTime();
      for (const row of completionRows || []) {
        const completedTimestamp = String(
          (row as any).completed_at || (row as any).updated_at || "",
        );
        if (completedTimestamp) {
          const completedAt = new Date(completedTimestamp).getTime();
          if (Number.isFinite(completedAt) && completedAt >= progressionCutoff) continue;
        }
        const assignmentId = String((row as any).assignment_id || "");
        const itemId = String((row as any).item_id || "");
        const assignment: any = assignmentById.get(assignmentId);
        const teacherId = effectiveTeacher.get(assignmentId) || "";
        const completionDate = completedTimestamp.slice(0, 10);
        if (
          completionDate &&
          !teacherAssignedToClassSubjectOn(
            teacherId,
            String(assignment?.class_id || ""),
            progressionAssignmentSubjectId(assignment),
            completionDate,
          )
        ) {
          continue;
        }
        const expectedIds = expectedItemIdsByAssignment.get(assignmentId);
        const key = `${assignmentId}|${itemId}`;
        if (!assignmentId || !itemId || !teacherId || !expectedIds?.has(itemId) || seen.has(key)) continue;
        seen.add(key);
        textbookCompletedItemsFound += 1;
        completionByAssignment.set(assignmentId, (completionByAssignment.get(assignmentId) || 0) + 1);
      }
    }

    for (const [assignmentId, teacherId] of effectiveTeacher.entries()) {
      const assignment: any = assignmentById.get(assignmentId);
      const progressionId = String(firstRelation(assignment?.progression)?.id || "");
      const metric = textbookMetrics.get(teacherId);
      if (!metric) continue;
      metric.assignments += 1;
      if (unscopedProgressionIds.has(progressionId)) {
        metric.unscopedAssignments += 1;
        continue;
      }
      metric.expected += expectedItemIdsByProgression.get(progressionId)?.size || 0;
      metric.completed += completionByAssignment.get(assignmentId) || 0;
    }

    const seenSessions = new Set<string>();
    for (const row of textbookSessionsResult.data || []) {
      const sessionId = String((row as any).id || "");
      const assignmentId = String((row as any).assignment_id || "");
      const teacherId = effectiveTeacher.get(assignmentId) || "";
      const assignment: any = assignmentById.get(assignmentId);
      const sessionDate = String((row as any).session_date || "").slice(0, 10);
      if (!sessionId || !assignmentId || !teacherId || !sessionDate || seenSessions.has(sessionId)) continue;
      if (
        !teacherAssignedToClassSubjectOn(
          teacherId,
          String(assignment?.class_id || ""),
          progressionAssignmentSubjectId(assignment),
          sessionDate,
        )
      ) {
        continue;
      }
      seenSessions.add(sessionId);
      textbookSessionsFound += 1;
      const metric = textbookMetrics.get(teacherId);
      if (metric) metric.sessions += 1;
    }
  } catch {
    textbookReadable = false;
  }

  const allObservedSessionIds = Array.from(
    new Set(
      Array.from(sessionMetrics.values()).flatMap((metric) => metric.observedSessionIds).filter(Boolean),
    ),
  );
  const attendanceMarksResult = allObservedSessionIds.length
    ? await srv
        .from("attendance_marks")
        .select("session_id,student_id,status")
        .in("session_id", allObservedSessionIds)
    : ({ data: [], error: null } as any);
  const absentStudentsBySession = new Map<string, Set<string>>();
  for (const row of attendanceMarksResult.data || []) {
    if (String((row as any).status || "") !== "absent") continue;
    const sessionId = String((row as any).session_id || "");
    const studentId = String((row as any).student_id || "");
    if (!sessionId || !studentId) continue;
    const current = absentStudentsBySession.get(sessionId) || new Set<string>();
    current.add(studentId);
    absentStudentsBySession.set(sessionId, current);
  }

  const sessionById = new Map(
    (sessionRows as any[]).map((row) => [String(row.id || ""), row] as const),
  );
  const studentPresenceByTeacher = new Map<
    string,
    { sessions: number; expected: number; present: number }
  >();
  for (const teacherId of teacherIds) {
    studentPresenceByTeacher.set(teacherId, { sessions: 0, expected: 0, present: 0 });
  }
  for (const [teacherId, metric] of sessionMetrics.entries()) {
    const agg = studentPresenceByTeacher.get(teacherId)!;
    for (const sessionId of metric.observedSessionIds) {
      const session: any = sessionById.get(sessionId);
      const classId = String(session?.class_id || "");
      const date = String(session?.started_at || "").slice(0, 10);
      if (!classId || !date) continue;
      const roster = rosterFor(classId, date);
      if (!roster.size) continue;
      const absent = Array.from(absentStudentsBySession.get(sessionId) || []).filter((id) =>
        roster.has(id),
      ).length;
      agg.sessions += 1;
      agg.expected += roster.size;
      agg.present += Math.max(0, roster.size - absent);
    }
  }

  const criteriaWarnings: string[] = [];
  const totalPlannedSessions = Array.from(sessionMetrics.values()).reduce(
    (sum, metric) => sum + metric.planned,
    0,
  );
  const totalObservedSessions = Array.from(sessionMetrics.values()).reduce(
    (sum, metric) => sum + metric.completed,
    0,
  );
  const totalPublishedEvaluations = publishedEvaluationRows.length;
  const totalValidPublishedEvaluations = Array.from(evalAggByTeacher.values()).reduce(
    (sum, agg) => sum + agg.validTotal,
    0,
  );
  const totalTextbookAssignments = Array.from(textbookMetrics.values()).reduce(
    (sum, metric) => sum + metric.assignments,
    0,
  );
  const totalTextbookSessions = Array.from(textbookMetrics.values()).reduce(
    (sum, metric) => sum + metric.sessions,
    0,
  );
  const totalUnscopedTextbookAssignments = Array.from(textbookMetrics.values()).reduce(
    (sum, metric) => sum + metric.unscopedAssignments,
    0,
  );

  if ((profilesResult.data || []).length < teacherIds.length) {
    criteriaWarnings.push(
      `${teacherIds.length - (profilesResult.data || []).length} profil(s) enseignant(s) n’ont pas été retrouvés.`,
    );
  }
  if (classTeachersResult.error) {
    criteriaWarnings.push("Les affectations officielles des enseignants n’ont pas pu être lues.");
  }
  if (periodsResult.error || timetablesResult.error) {
    criteriaWarnings.push("Les créneaux de l’emploi du temps n’ont pas pu être lus complètement.");
  }
  if (sessionsResult.error) {
    criteriaWarnings.push("Les séances réellement effectuées par les enseignants n’ont pas pu être lues.");
  }
  if (absencesResult.error) {
    criteriaWarnings.push("Les permissions approuvées n’ont pas pu être vérifiées ; l’assiduité est donc non calculable.");
  }
  if (!timetablesResult.error && totalPlannedSessions === 0) {
    criteriaWarnings.push("Aucun emploi du temps exploitable : assiduité, ponctualité, cahier de texte et présence des élèves ne peuvent pas être certifiés.");
  }
  if (evaluationsResult.error) {
    criteriaWarnings.push("Les évaluations n’ont pas pu être lues.");
  } else if (totalPublishedEvaluations === 0) {
    criteriaWarnings.push("Aucune évaluation publiée sur la période. Une évaluation non publiée ne compte jamais.");
  }
  if (publishedScoresResult.error) {
    criteriaWarnings.push("Les notes officielles publiées n’ont pas pu être lues.");
  }
  if (enrollmentsResult.error) {
    criteriaWarnings.push("Les effectifs actifs des classes n’ont pas pu être vérifiés.");
  }
  if (!textbookReadable) {
    criteriaWarnings.push("Le module cahier de texte/progression n’a pas pu être lu.");
  }
  if (textbookAssignmentsExcludedUnassigned > 0) {
    criteriaWarnings.push(
      `${textbookAssignmentsExcludedUnassigned} attribution(s) de progression ont été exclues car elles ne correspondent pas à une affectation officielle classe-matière sur la période.`,
    );
  }
  if (totalUnscopedTextbookAssignments > 0) {
    criteriaWarnings.push(
      `${totalUnscopedTextbookAssignments} progression(s) contiennent des éléments sans trimestre exploitable : leur avancement ne peut pas être comparé honnêtement à la période sélectionnée.`,
    );
  }
  if ((periodCode || periodLabel) && selectedTerm === null) {
    criteriaWarnings.push(
      `La période « ${periodLabel || periodCode} » n’a pas pu être reconnue comme T1, T2 ou T3 : vérifiez son code ou son libellé pour fiabiliser le calcul cumulatif de la progression.`,
    );
  }
  if (attendanceMarksResult.error) {
    criteriaWarnings.push("Les appels élèves n’ont pas pu être lus.");
  }

  const items = teacherIds.map((teacherId) => {
    const sessions = sessionMetrics.get(teacherId)!;
    const evalAgg = evalAggByTeacher.get(teacherId)!;
    const pedagogical = pedagogicalByTeacher.get(teacherId)!;
    const textbook = textbookMetrics.get(teacherId)!;
    const studentPresence = studentPresenceByTeacher.get(teacherId)!;
    const assignedClassesCount = assignedClassesByTeacher.get(teacherId)?.size || 0;
    const assignedClassSubjectsCount = assignedClassSubjectsByTeacher.get(teacherId)?.size || 0;

    const attendanceCoverageRate = pct(sessions.completed, sessions.planned);
    const attendanceRate = attendanceCoverageRate;
    const punctualityRate = pct(sessions.punctual, sessions.completed);
    const attendanceDataAvailable =
      attendanceSourcesReadable &&
      sessions.planned > 0 &&
      sessions.completed >= teacherSettings.minimum_teacher_attendance_observations &&
      attendanceCoverageRate >= teacherSettings.minimum_teacher_attendance_coverage_rate;

    const assignedClassIds = Array.from(assignedClassesByTeacher.get(teacherId) || []);
    const evaluationsPerClass = assignedClassesCount > 0 ? evalAgg.validTotal / assignedClassesCount : 0;
    const classesMeetingEvaluationMinimum = assignedClassIds.filter(
      (classId) =>
        (evalAgg.validByClass.get(classId) || 0) >=
        teacherSettings.minimum_published_evaluations_per_class,
    ).length;
    const classEvaluationComplianceRate = pct(
      classesMeetingEvaluationMinimum,
      assignedClassesCount,
    );
    const evaluationRegularityRate = clamp(
      (evaluationsPerClass / teacherSettings.evaluations_target_per_class) * 100,
    );
    const noteCoverageRate = pct(evalAgg.foundNotes, evalAgg.expectedNotes);
    const evaluationDataAvailable =
      assignedClassesCount > 0 &&
      !classTeachersResult.error &&
      !evaluationsResult.error &&
      !publishedScoresResult.error &&
      !enrollmentsResult.error;
    const resultDataAvailable = evalAgg.validTotal > 0 && pedagogical.groups > 0;

    const textbookSessionCoverageRate = pct(textbook.sessions, sessions.planned);
    const textbookProgressionRate = pct(textbook.completed, textbook.expected);
    const textbookConfigured =
      textbookReadable &&
      textbook.assignments > 0 &&
      textbook.expected > 0 &&
      textbook.unscopedAssignments === 0;
    const textbookDataAvailable =
      attendanceSourcesReadable && sessions.planned > 0 && textbookConfigured;

    const studentAttendanceCoverageRate = pct(studentPresence.sessions, sessions.planned);
    const studentPresenceRate = studentPresence.expected > 0
      ? pct(studentPresence.present, studentPresence.expected)
      : null;
    const studentPresenceDataAvailable =
      attendanceSourcesReadable &&
      !attendanceMarksResult.error &&
      studentPresence.sessions >= teacherSettings.minimum_student_attendance_sessions &&
      studentAttendanceCoverageRate >= teacherSettings.minimum_student_attendance_coverage_rate &&
      studentPresenceRate !== null;

    const allFamiliesAvailable =
      evaluationDataAvailable &&
      resultDataAvailable &&
      attendanceDataAvailable &&
      textbookDataAvailable &&
      studentPresenceDataAvailable;

    const score = allFamiliesAvailable
      ? computeTeacherScore(
          {
            evaluation_regularity_rate: evaluationRegularityRate,
            note_coverage_rate: noteCoverageScoreRate(noteCoverageRate),
            pedagogical_mean_score_rate: pedagogicalMeanScoreRate(pedagogical.mean20),
            success_rate_score_rate: successScoreRate(pedagogical.successRate),
            attendance_rate: attendanceRate,
            punctuality_rate: punctualityRate,
            textbook_rate: textbookSessionCoverageRate,
            progression_rate: textbookProgressionRate,
            student_presence_score_rate: studentPresenceScoreRate(studentPresenceRate),
          },
          teacherSettings,
        )
      : null;

    const dataReasons: string[] = [];
    const failureReasons: string[] = [];
    const informationReasons: string[] = [];

    if (assignedClassesCount === 0) {
      dataReasons.push("Aucune classe officiellement affectée sur la période");
    }
    if (sessions.planned === 0) {
      dataReasons.push("Aucun créneau prévu exploitable dans l’emploi du temps");
    } else if (!attendanceDataAvailable) {
      dataReasons.push(
        `Présence enseignant insuffisamment observée : ${sessions.completed} séance(s), couverture ${attendanceCoverageRate.toFixed(1)} % ; minimum ${teacherSettings.minimum_teacher_attendance_observations} séances et ${teacherSettings.minimum_teacher_attendance_coverage_rate} %`,
      );
    }
    if (!textbookReadable) {
      dataReasons.push("Cahier de texte indisponible techniquement");
    } else if (textbook.unscopedAssignments > 0) {
      dataReasons.push(
        `${textbook.unscopedAssignments} progression(s) sans trimestre exploitable : impossible de calculer l’avancement attendu à la période sélectionnée`,
      );
    } else if (!textbookConfigured) {
      dataReasons.push("Progression non configurée ou non attribuée par l’établissement");
    }
    if (!studentPresenceDataAvailable) {
      dataReasons.push(
        `Présence des élèves insuffisamment observable : ${studentPresence.sessions} appel(s), couverture ${studentAttendanceCoverageRate.toFixed(1)} % ; minimum ${teacherSettings.minimum_student_attendance_sessions} appels et ${teacherSettings.minimum_student_attendance_coverage_rate} %`,
      );
    }

    if (evalAgg.publishedTotal === 0) {
      dataReasons.push("Aucune évaluation publiée : les brouillons et évaluations en attente ne comptent pas");
    }
    if (evalAgg.invalidCoverage > 0) {
      informationReasons.push(
        `${evalAgg.invalidCoverage} évaluation(s) publiée(s) rejetée(s) car moins de ${teacherSettings.minimum_evaluation_note_coverage_rate} % des élèves actifs ont une note`,
      );
    }
    if (
      assignedClassesCount > 0 &&
      classEvaluationComplianceRate < teacherSettings.minimum_class_evaluation_compliance_rate
    ) {
      failureReasons.push(
        `${classesMeetingEvaluationMinimum}/${assignedClassesCount} classe(s) atteignent le minimum de ${teacherSettings.minimum_published_evaluations_per_class} évaluation(s) publiée(s) valide(s) ; couverture minimale exigée ${teacherSettings.minimum_class_evaluation_compliance_rate} %`,
      );
    }
    if (evalAgg.validTotal === 0) {
      dataReasons.push("Aucune évaluation publiée et suffisamment renseignée pour calculer les résultats pédagogiques");
    }
    if (textbookDataAvailable && textbookSessionCoverageRate < teacherSettings.minimum_textbook_session_coverage_rate) {
      failureReasons.push(
        `Cahier de texte renseigné à ${textbookSessionCoverageRate.toFixed(1)} %, minimum ${teacherSettings.minimum_textbook_session_coverage_rate} %`,
      );
    }

    let status: "eligible" | "review" | "ineligible";
    if (dataReasons.length > 0) {
      status = "review";
    } else if (score === null) {
      status = "review";
      dataReasons.push("Toutes les familles obligatoires ne sont pas calculables");
    } else if (failureReasons.length > 0 || score < teacherSettings.minimum_score) {
      status = "ineligible";
      if (score < teacherSettings.minimum_score) {
        failureReasons.push(
          `Score ${score.toFixed(1)}/100, minimum ${teacherSettings.minimum_score}/100`,
        );
      }
    } else {
      status = "eligible";
    }

    const evaluationPoints =
      (evaluationRegularityRate / 100) * teacherSettings.weights.evaluation_regularity +
      (noteCoverageScoreRate(noteCoverageRate) / 100) * teacherSettings.weights.note_coverage;
    const resultsPoints =
      (pedagogicalMeanScoreRate(pedagogical.mean20) / 100) * teacherSettings.weights.pedagogical_mean +
      (successScoreRate(pedagogical.successRate) / 100) * teacherSettings.weights.success_rate;

    return {
      teacher_id: teacherId,
      teacher_name: names.get(teacherId) || `Enseignant (${teacherId.slice(0, 6)})`,
      subject_names: (subjects.get(teacherId) || []).sort((a, b) => a.localeCompare(b, "fr")),
      rank: null as number | null,
      score,
      status,
      review_reasons: [...dataReasons, ...failureReasons, ...informationReasons],
      metrics: {
        assigned_classes_count: assignedClassesCount,
        assigned_class_subjects_count: assignedClassSubjectsCount,
        evaluations_total: allEvaluationRows.filter((row: any) => String(row.teacher_id || "") === teacherId).length,
        evaluations_published: evalAgg.publishedTotal,
        evaluations_valid: evalAgg.validTotal,
        evaluations_rejected_coverage: evalAgg.invalidCoverage,
        evaluations_per_class: round2(evaluationsPerClass),
        classes_meeting_evaluation_minimum: classesMeetingEvaluationMinimum,
        class_evaluation_compliance_rate: round1(classEvaluationComplianceRate),
        evaluation_regularity_rate: round1(evaluationRegularityRate),
        note_coverage_rate: round1(noteCoverageRate),
        pedagogical_mean_20: pedagogical.mean20,
        success_rate: pedagogical.successRate,
        pedagogical_groups_count: pedagogical.groups,
        planned_sessions: sessions.planned,
        completed_sessions: sessions.completed,
        attendance_observations: sessions.completed,
        attendance_coverage_rate: attendanceCoverageRate,
        attendance_data_available: attendanceDataAvailable,
        justified_absence_sessions: sessions.justified,
        attendance_rate: attendanceRate,
        punctual_sessions: sessions.punctual,
        punctuality_rate: punctualityRate,
        average_lateness_minutes:
          sessions.completed > 0 ? round1(sessions.lateness / sessions.completed) : null,
        textbook_assignments: textbook.assignments,
        textbook_expected_items: textbook.expected,
        textbook_completed_items: textbook.completed,
        textbook_sessions_count: textbook.sessions,
        textbook_session_coverage_rate: textbookSessionCoverageRate,
        textbook_progression_rate: textbookProgressionRate,
        textbook_data_available: textbookDataAvailable,
        textbook_unscoped_assignments: textbook.unscopedAssignments,
        student_attendance_sessions: studentPresence.sessions,
        student_attendance_coverage_rate: studentAttendanceCoverageRate,
        student_presence_rate: studentPresenceRate,
        student_presence_data_available: studentPresenceDataAvailable,
        evaluation_points: round1(evaluationPoints),
        results_points: round1(resultsPoints),
      },
    };
  });

  const eligible = items.filter((item) => item.status === "eligible" && item.score !== null);
  eligible.sort(strictTeacherCompare);
  for (let index = 0; index < eligible.length; index += 1) {
    eligible[index].rank = index + 1;
  }

  const ranked = items.sort(
    (a, b) =>
      (a.rank ?? 999) - (b.rank ?? 999) ||
      Number(b.score ?? -1) - Number(a.score ?? -1) ||
      a.teacher_name.localeCompare(b.teacher_name, "fr"),
  );

  return NextResponse.json({
    ok: true,
    institution_name: (inst as any)?.name || "Établissement",
    academic_year: academicYear || null,
    from,
    to,
    requested_to: requestedTo,
    settings: teacherSettings,
    criteria_warnings: criteriaWarnings,
    data_audit: {
      teacher_roles: teacherIds.length,
      profiles_found: (profilesResult.data || []).length,
      subject_assignments:
        (teacherSubjectsResult.data || []).length + classTeacherRows.length,
      class_assignments: classTeacherRows.length,
      evaluations_found: evaluationRowsInYear.length,
      evaluations_excluded_unassigned: evaluationsExcludedUnassigned,
      evaluations_published: totalPublishedEvaluations,
      evaluations_valid: totalValidPublishedEvaluations,
      evaluations_unpublished: allEvaluationRows.length - totalPublishedEvaluations,
      published_score_rows: (publishedScoresResult.data || []).length,
      planned_slots_found: totalPlannedSessions,
      sessions_found: totalObservedSessions,
      textbook_assignments: totalTextbookAssignments,
      textbook_assignments_excluded_unassigned: textbookAssignmentsExcludedUnassigned,
      textbook_sessions_found: textbookSessionsFound || totalTextbookSessions,
      textbook_completed_items: textbookCompletedItemsFound,
      textbook_unscoped_assignments: totalUnscopedTextbookAssignments,
      period_term: selectedTerm,
      student_attendance_sessions: Array.from(studentPresenceByTeacher.values()).reduce(
        (sum, value) => sum + value.sessions,
        0,
      ),
    },
    items: ranked,
  });
}
