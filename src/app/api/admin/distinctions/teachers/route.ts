import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  computeTeacherScore,
  normalizeDistinctionSettings,
  type TeacherDistinctionSettings,
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

function niceName(profile: any) {
  const display = String(profile?.display_name || "").trim();
  const composed = `${profile?.last_name || ""} ${profile?.first_name || ""}`.trim();
  const email = String(profile?.email || "").trim();
  const phone = String(profile?.phone || "").trim();
  return display || composed || (email.includes("@") ? email.split("@")[0] : email) || phone || "Enseignant";
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

function sessionKey(row: any) {
  const start = String(row.started_at || "");
  return `${row.teacher_id || ""}|${start.slice(0, 10)}|${start.slice(11, 16)}`;
}

function plannedKey(teacherId: string, date: string, startTime: string) {
  return `${teacherId}|${date}|${startTime}`;
}

function isCompletedSession(row: any) {
  if (!row?.actual_call_at || !row?.started_at) return false;
  const start = new Date(row.started_at).getTime();
  const actual = new Date(row.actual_call_at).getTime();
  const duration = Math.max(1, Number(row.expected_minutes || 60)) * 60_000;
  return Number.isFinite(start) && Number.isFinite(actual) && actual >= start && actual < start + duration;
}

function firstRelation(value: any) {
  if (Array.isArray(value)) return value[0] || null;
  return value && typeof value === "object" ? value : null;
}

function competitionRanks<T>(rows: T[], score: (row: T) => number) {
  const sorted = rows.slice().sort((a, b) => score(b) - score(a));
  let previousScore: number | null = null;
  let previousRank = 0;
  return sorted.map((row, index) => {
    const value = score(row);
    const rank = previousScore !== null && Math.abs(value - previousScore) < 0.0001 ? previousRank : index + 1;
    previousScore = value;
    previousRank = rank;
    return { row, rank };
  });
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

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(requestedTo)) {
    return NextResponse.json({ ok: false, error: "from_and_to_required" }, { status: 400 });
  }

  const fromDate = parseYMD(from);
  const requestedToDate = parseYMD(requestedTo);
  if (!fromDate || !requestedToDate || requestedToDate.getTime() < fromDate.getTime()) {
    return NextResponse.json({ ok: false, error: "invalid_date_range" }, { status: 400 });
  }

  // Ne jamais pénaliser un enseignant pour des créneaux qui ne sont pas encore passés.
  const today = parseYMD(toYMD(new Date()))!;
  const effectiveToDate = requestedToDate.getTime() > today.getTime() ? today : requestedToDate;
  const to = toYMD(effectiveToDate);

  const { institutionId, srv } = ctx;
  const { data: inst } = await srv
    .from("institutions")
    .select("name,settings_json")
    .eq("id", institutionId)
    .maybeSingle();
  const distinctionSettings = normalizeDistinctionSettings(
    (inst as any)?.settings_json?.distinction_settings,
  );
  const teacherSettings = distinctionSettings.teachers;

  const { data: roleRows, error: rolesError } = await srv
    .from("user_roles")
    .select("profile_id")
    .eq("institution_id", institutionId)
    .eq("role", "teacher");

  if (rolesError) {
    return NextResponse.json({ ok: false, error: rolesError.message }, { status: 400 });
  }

  const teacherIds = Array.from(
    new Set((roleRows || []).map((row: any) => String(row.profile_id || "")).filter(Boolean)),
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

  const [{ data: profiles }, { data: subjectRows }] = await Promise.all([
    srv
      .from("profiles")
      .select("id,display_name,first_name,last_name,email,phone")
      .in("id", teacherIds),
    srv
      .from("teacher_subjects")
      .select("profile_id,subject_name")
      .eq("institution_id", institutionId)
      .in("profile_id", teacherIds),
  ]);

  const names = new Map<string, string>();
  for (const profile of profiles || []) names.set(String((profile as any).id), niceName(profile));
  const subjects = new Map<string, string[]>();
  for (const row of subjectRows || []) {
    const id = String((row as any).profile_id || "");
    const name = String((row as any).subject_name || "").trim();
    if (!id || !name) continue;
    const current = subjects.get(id) || [];
    if (!current.includes(name)) current.push(name);
    subjects.set(id, current);
  }

  const { fromIso, toIsoExclusive } = toIsoRange(from, to);
  const [periodsResult, timetablesResult, absencesResult, sessionsResult] = await Promise.all([
    srv
      .from("institution_periods")
      .select("id,weekday,start_time,end_time")
      .eq("institution_id", institutionId),
    srv
      .from("teacher_timetables")
      .select("id,teacher_id,weekday,period_id")
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
      .select("id,teacher_id,started_at,actual_call_at,expected_minutes")
      .eq("institution_id", institutionId)
      .in("teacher_id", teacherIds)
      .gte("started_at", fromIso)
      .lt("started_at", new Date(toIsoExclusive).toISOString()),
  ]);

  const periods = periodsResult.data || [];
  const timetables = timetablesResult.data || [];
  const sessionRows = sessionsResult.data || [];
  const weekdayMode = detectWeekdayMode(periods);
  const periodById = new Map(
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
  const permissionCounts = new Map<string, number>();
  for (const row of absencesResult.data || []) {
    const teacherId = String((row as any).teacher_profile_id || "");
    const start = String((row as any).start_date || "");
    const end = String((row as any).end_date || "");
    if (!teacherId || !start || !end) continue;
    const current = absencesByTeacher.get(teacherId) || [];
    current.push({ start, end });
    absencesByTeacher.set(teacherId, current);
    permissionCounts.set(teacherId, (permissionCounts.get(teacherId) || 0) + 1);
  }

  const now = new Date();
  const todayYmd = toYMD(now);
  const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const plannedSlots = new Map<string, { teacherId: string; justified: boolean }>();

  for (const date of dateRange(from, to)) {
    const ymd = toYMD(date);
    const dbWeekday = jsDayToDbWeekday(date.getUTCDay(), weekdayMode);
    for (const timetable of timetables) {
      const teacherId = String((timetable as any).teacher_id || "");
      const period = periodById.get(String((timetable as any).period_id || ""));
      if (!teacherId || !period?.startTime) continue;
      const timetableWeekday =
        parseWeekday((timetable as any).weekday) ?? period.weekday;
      if (timetableWeekday !== dbWeekday) continue;
      if (ymd === todayYmd && period.startMinutes > nowMinutes) continue;

      const key = plannedKey(teacherId, ymd, period.startTime);
      if (plannedSlots.has(key)) continue;
      plannedSlots.set(key, {
        teacherId,
        justified: dateCoveredByApprovedAbsence(teacherId, ymd, absencesByTeacher),
      });
    }
  }

  const sessionAgg = new Map<string, any>();
  for (const row of sessionRows) {
    const key = sessionKey(row);
    if (key.startsWith("|")) continue;
    const existing = sessionAgg.get(key);
    if (!existing || (!existing.actual_call_at && (row as any).actual_call_at)) {
      sessionAgg.set(key, row);
    }
  }

  const sessionMetrics = new Map<
    string,
    { planned: number; completed: number; punctual: number; lateness: number; justified: number }
  >();
  for (const id of teacherIds) {
    sessionMetrics.set(id, { planned: 0, completed: 0, punctual: 0, lateness: 0, justified: 0 });
  }

  // Si aucun emploi du temps exploitable n'est disponible, les séances réellement
  // enregistrées restent une base minimale d'observation sans inventer des absences.
  if (plannedSlots.size === 0) {
    for (const row of sessionAgg.values()) {
      plannedSlots.set(sessionKey(row), {
        teacherId: String(row.teacher_id || ""),
        justified: false,
      });
    }
  }

  for (const [key, slot] of plannedSlots.entries()) {
    const metric = sessionMetrics.get(slot.teacherId);
    if (!metric) continue;
    if (slot.justified) {
      metric.justified += 1;
      continue;
    }
    metric.planned += 1;
    const row = sessionAgg.get(key);
    if (!isCompletedSession(row)) continue;
    metric.completed += 1;
    const lateness = Math.max(
      0,
      Math.round(
        (new Date(row.actual_call_at).getTime() - new Date(row.started_at).getTime()) / 60_000,
      ),
    );
    metric.lateness += lateness;
    if (lateness <= teacherSettings.punctuality_tolerance_minutes) metric.punctual += 1;
  }

  const { data: evalRows, error: evalError } = await srv
    .from("grade_evaluations")
    .select("id,teacher_id,is_published,eval_date,eval_kind,class_id,subject_id,classes!inner(institution_id)")
    .eq("classes.institution_id", institutionId)
    .in("teacher_id", teacherIds)
    .gte("eval_date", from)
    .lte("eval_date", to);

  const evalMetrics = new Map<string, { total: number; published: number }>();
  const evaluationKindsByTeacher = new Map<string, Set<string>>();
  const evaluationIdsByTeacher = new Map<string, string[]>();
  for (const id of teacherIds) {
    evalMetrics.set(id, { total: 0, published: 0 });
    evaluationKindsByTeacher.set(id, new Set());
    evaluationIdsByTeacher.set(id, []);
  }
  for (const row of evalRows || []) {
    const id = String((row as any).teacher_id || "");
    const metric = evalMetrics.get(id);
    if (!metric) continue;
    metric.total += 1;
    if ((row as any).is_published) metric.published += 1;
    const evalKind = String((row as any).eval_kind || "").trim();
    if (evalKind) evaluationKindsByTeacher.get(id)?.add(evalKind);
    const evaluationId = String((row as any).id || "").trim();
    if (evaluationId) evaluationIdsByTeacher.get(id)?.push(evaluationId);
  }

  const evalIds = Array.from(
    new Set((evalRows || []).map((row: any) => String(row?.id || "")).filter(Boolean)),
  );
  const evaluationAverageById = new Map<string, number>();
  if (evalIds.length) {
    const { data: markRows } = await srv
      .from("grade_flat_marks")
      .select("evaluation_id,mark_20")
      .in("evaluation_id", evalIds);

    const marksByEvaluation = new Map<string, { total: number; count: number }>();
    for (const row of markRows || []) {
      const evaluationId = String((row as any).evaluation_id || "");
      const mark20 = Number((row as any).mark_20);
      if (!evaluationId || !Number.isFinite(mark20)) continue;
      const current = marksByEvaluation.get(evaluationId) || { total: 0, count: 0 };
      current.total += mark20;
      current.count += 1;
      marksByEvaluation.set(evaluationId, current);
    }

    for (const [evaluationId, agg] of marksByEvaluation.entries()) {
      if (agg.count > 0) {
        evaluationAverageById.set(
          evaluationId,
          Math.round((agg.total / agg.count) * 100) / 100,
        );
      }
    }
  }

  const pedagogicalAverageByTeacher = new Map<string, number>();
  for (const id of teacherIds) {
    const averages = (evaluationIdsByTeacher.get(id) || [])
      .map((evaluationId) => evaluationAverageById.get(evaluationId))
      .filter((value): value is number => Number.isFinite(value));
    if (!averages.length) {
      pedagogicalAverageByTeacher.set(id, 0);
      continue;
    }
    const avg = averages.reduce((sum, value) => sum + value, 0) / averages.length;
    pedagogicalAverageByTeacher.set(id, Math.round(avg * 100) / 100);
  }

  const textbookMetrics = new Map<
    string,
    { expected: number; completed: number; assignments: number }
  >();
  for (const id of teacherIds) {
    textbookMetrics.set(id, { expected: 0, completed: 0, assignments: 0 });
  }
  let textbookModuleReadable = true;

  try {
    const { data: assignmentsRaw, error: assignmentsError } = await srv
      .from("textbook_progression_class_assignments")
      .select("id,teacher_id,class_id,progression:textbook_progression_templates(id,academic_year)")
      .eq("institution_id", institutionId)
      .eq("is_active", true);
    if (assignmentsError) throw assignmentsError;

    const assignments = (assignmentsRaw || []).filter((row: any) => {
      if (!academicYear) return true;
      const progression = firstRelation(row?.progression);
      return String(progression?.academic_year || "") === academicYear;
    });

    const classIds = Array.from(
      new Set(assignments.map((row: any) => String(row.class_id || "")).filter(Boolean)),
    );
    const effectiveTeacher = new Map<string, string>();
    const classTeachers = new Map<string, string[]>();
    if (classIds.length) {
      const { data: rows } = await srv
        .from("class_teachers")
        .select("class_id,teacher_id")
        .eq("institution_id", institutionId)
        .in("class_id", classIds);
      for (const row of rows || []) {
        const classId = String((row as any).class_id || "");
        const teacherId = String((row as any).teacher_id || "");
        if (!classId || !teacherId) continue;
        const current = classTeachers.get(classId) || [];
        if (!current.includes(teacherId)) current.push(teacherId);
        classTeachers.set(classId, current);
      }
    }

    for (const assignment of assignments as any[]) {
      const explicit = String(assignment.teacher_id || "");
      const fallback = classTeachers.get(String(assignment.class_id || ""))?.[0] || "";
      const teacherId = explicit || fallback;
      if (teacherId && teacherIds.includes(teacherId)) {
        effectiveTeacher.set(String(assignment.id), teacherId);
      }
    }

    const assignmentIds = Array.from(effectiveTeacher.keys());
    const progressionIds = Array.from(
      new Set(
        assignments
          .map((row: any) => String(firstRelation(row?.progression)?.id || ""))
          .filter(Boolean),
      ),
    );
    const itemCounts = new Map<string, number>();
    if (progressionIds.length) {
      const { data: itemRows } = await srv
        .from("textbook_progression_items")
        .select("id,progression_id,item_type,planned_duration_minutes,planned_sessions_count")
        .eq("institution_id", institutionId)
        .in("progression_id", progressionIds);
      for (const row of itemRows || []) {
        const actionable =
          ["lesson", "chapter", "activity", "assessment", "revision"].includes(
            String((row as any).item_type || ""),
          ) ||
          Number((row as any).planned_duration_minutes || 0) > 0 ||
          Number((row as any).planned_sessions_count || 0) > 0;
        if (!actionable) continue;
        const key = String((row as any).progression_id || "");
        itemCounts.set(key, (itemCounts.get(key) || 0) + 1);
      }
    }

    const completedByAssignment = new Map<string, number>();
    if (assignmentIds.length) {
      const { data: completionRows } = await srv
        .from("textbook_lesson_completions")
        .select("assignment_id,item_id,status")
        .eq("institution_id", institutionId)
        .in("assignment_id", assignmentIds)
        .eq("status", "completed");
      const seen = new Set<string>();
      for (const row of completionRows || []) {
        const assignmentId = String((row as any).assignment_id || "");
        const key = `${assignmentId}|${String((row as any).item_id || "")}`;
        if (!assignmentId || seen.has(key)) continue;
        seen.add(key);
        completedByAssignment.set(
          assignmentId,
          (completedByAssignment.get(assignmentId) || 0) + 1,
        );
      }
    }

    const assignmentById = new Map(assignments.map((row: any) => [String(row.id), row]));
    for (const [assignmentId, teacherId] of effectiveTeacher.entries()) {
      const assignment: any = assignmentById.get(assignmentId);
      const progressionId = String(firstRelation(assignment?.progression)?.id || "");
      const metric = textbookMetrics.get(teacherId);
      if (!metric) continue;
      metric.assignments += 1;
      metric.expected += itemCounts.get(progressionId) || 0;
      metric.completed += completedByAssignment.get(assignmentId) || 0;
    }
  } catch {
    textbookModuleReadable = false;
  }

  const totalPlannedSessions = Array.from(sessionMetrics.values()).reduce(
    (sum, metric) => sum + metric.planned,
    0,
  );
  const totalEvaluations = Array.from(evalMetrics.values()).reduce(
    (sum, metric) => sum + metric.total,
    0,
  );
  const totalTextbookAssignments = Array.from(textbookMetrics.values()).reduce(
    (sum, metric) => sum + metric.assignments,
    0,
  );
  const maxPermissionRequests = Math.max(0, ...Array.from(permissionCounts.values()));

  const attendanceAvailable = totalPlannedSessions > 0;
  const evaluationsAvailable = !evalError && totalEvaluations > 0;
  const textbookAvailable = textbookModuleReadable && totalTextbookAssignments > 0;
  const criteriaWarnings: string[] = [];
  if (!attendanceAvailable) {
    criteriaWarnings.push("Emploi du temps ou séances insuffisants : assiduité et ponctualité neutralisées.");
  }
  if (!evaluationsAvailable) {
    criteriaWarnings.push("Aucune évaluation exploitable sur la période : le critère évaluations/pédagogie est neutralisé.");
  }
  if (!textbookAvailable) {
    criteriaWarnings.push("Cahier de texte non exploitable sur la période : ce critère est neutralisé.");
  }

  const items = teacherIds.map((teacherId) => {
    const sessions = sessionMetrics.get(teacherId) || {
      planned: 0,
      completed: 0,
      punctual: 0,
      lateness: 0,
      justified: 0,
    };
    const evaluations = evalMetrics.get(teacherId) || { total: 0, published: 0 };
    const textbook = textbookMetrics.get(teacherId) || {
      expected: 0,
      completed: 0,
      assignments: 0,
    };

    const attendanceRate = pct(sessions.completed, sessions.planned);
    const punctualityRate = pct(sessions.punctual, sessions.completed);
    const evaluationPublicationRate = pct(evaluations.published, evaluations.total);
    const textbookRate = pct(textbook.completed, textbook.expected);
    const evaluationTypesCount = evaluationKindsByTeacher.get(teacherId)?.size || 0;
    const evaluationDiversityRate = pct(evaluationTypesCount, 3);
    const evaluationVolumeScore = Math.min(
      100,
      Math.round(
        ((evaluations.total / Math.max(1, teacherSettings.minimum_evaluations)) * 100) * 10,
      ) / 10,
    );
    const evaluationQualityRate =
      evaluations.total > 0
        ? Math.round(
            (evaluationVolumeScore * 0.45 +
              evaluationDiversityRate * 0.25 +
              evaluationPublicationRate * 0.3) *
              10,
          ) / 10
        : 0;
    const pedagogicalMean20 = pedagogicalAverageByTeacher.get(teacherId) || 0;
    const pedagogicalPerformanceRate = Number.isFinite(pedagogicalMean20)
      ? Math.round(((pedagogicalMean20 / 20) * 100) * 10) / 10
      : 0;
    const combinedEvaluationRate =
      evaluations.total > 0
        ? Math.round(((evaluationQualityRate + pedagogicalPerformanceRate) / 2) * 10) / 10
        : 0;
    const permissionRequestsCount = permissionCounts.get(teacherId) || 0;
    const permissionScore =
      maxPermissionRequests > 0
        ? Math.round((Math.max(0, 1 - permissionRequestsCount / maxPermissionRequests) * 100) * 10) / 10
        : 100;

    const engagementComponents: number[] = [];
    if (attendanceAvailable && sessions.planned > 0) {
      engagementComponents.push(
        Math.min(100, (sessions.completed / Math.max(1, teacherSettings.minimum_sessions)) * 100),
      );
    }
    if (evaluationsAvailable && evaluations.total > 0) {
      engagementComponents.push(evaluationVolumeScore);
    }
    if (textbookAvailable && textbook.assignments > 0) {
      engagementComponents.push(Math.min(100, textbook.assignments * 25));
    }
    engagementComponents.push(permissionScore);
    const digitalEngagementRate = engagementComponents.length
      ? Math.round(
          (engagementComponents.reduce((sum, value) => sum + value, 0) /
            engagementComponents.length) *
            10,
        ) / 10
      : permissionScore;

    const effectiveSettings: TeacherDistinctionSettings = {
      ...teacherSettings,
      weights: {
        ...teacherSettings.weights,
        attendance:
          attendanceAvailable && sessions.planned > 0 ? teacherSettings.weights.attendance : 0,
        punctuality:
          attendanceAvailable && sessions.completed > 0 ? teacherSettings.weights.punctuality : 0,
        evaluations:
          evaluationsAvailable && evaluations.total > 0 ? teacherSettings.weights.evaluations : 0,
        textbook:
          textbookAvailable && textbook.assignments > 0 ? teacherSettings.weights.textbook : 0,
        digital_engagement: teacherSettings.weights.digital_engagement,
      },
    };

    const score = computeTeacherScore(
      {
        attendance_rate: attendanceRate,
        punctuality_rate: punctualityRate,
        evaluation_publication_rate: combinedEvaluationRate,
        textbook_completion_rate: textbookRate,
        digital_engagement_rate: digitalEngagementRate,
      },
      effectiveSettings,
    );

    const reviewReasons: string[] = [];
    if (attendanceAvailable && sessions.planned < teacherSettings.minimum_sessions) {
      reviewReasons.push(`Seulement ${sessions.planned} séance(s) prévue(s) observable(s)`);
    }
    if (evaluationsAvailable && evaluations.total < teacherSettings.minimum_evaluations) {
      reviewReasons.push(`Seulement ${evaluations.total} évaluation(s) observable(s)`);
    }
    if (textbookAvailable && textbook.assignments === 0 && teacherSettings.weights.textbook > 0) {
      reviewReasons.push("Aucune progression pédagogique attribuée ou observable");
    }

    const hasObservableCriterion = Object.values(effectiveSettings.weights).some(
      (weight) => Number(weight) > 0,
    );
    if (!hasObservableCriterion) {
      reviewReasons.push("Aucune donnée suffisante pour établir une distinction fiable");
    }

    let status: "eligible" | "review" | "ineligible";
    if (reviewReasons.length > 0) status = "review";
    else if (score >= teacherSettings.minimum_score) status = "eligible";
    else {
      status = "ineligible";
      reviewReasons.push(
        `Score ${score.toFixed(1)}/100, minimum ${teacherSettings.minimum_score}/100`,
      );
    }

    return {
      teacher_id: teacherId,
      teacher_name: names.get(teacherId) || "Enseignant",
      subject_names: (subjects.get(teacherId) || []).sort((a, b) => a.localeCompare(b, "fr")),
      score,
      status,
      review_reasons: reviewReasons,
      metrics: {
        planned_sessions: sessions.planned,
        completed_sessions: sessions.completed,
        justified_absence_sessions: sessions.justified,
        attendance_rate: attendanceRate,
        punctual_sessions: sessions.punctual,
        punctuality_rate: punctualityRate,
        average_lateness_minutes:
          sessions.completed > 0
            ? Math.round((sessions.lateness / sessions.completed) * 10) / 10
            : 0,
        evaluations_total: evaluations.total,
        evaluations_published: evaluations.published,
        evaluation_publication_rate: evaluationPublicationRate,
        evaluation_types_count: evaluationTypesCount,
        evaluation_diversity_rate: evaluationDiversityRate,
        evaluation_volume_score: evaluationVolumeScore,
        evaluation_quality_rate: evaluationQualityRate,
        pedagogical_mean_20: pedagogicalMean20,
        pedagogical_performance_rate: pedagogicalPerformanceRate,
        textbook_assignments: textbook.assignments,
        textbook_expected_items: textbook.expected,
        textbook_completed_items: textbook.completed,
        textbook_completion_rate: textbookRate,
        permission_requests_count: permissionRequestsCount,
        permission_score: permissionScore,
        digital_engagement_rate: digitalEngagementRate,
      },
    };
  });

  const ranked = competitionRanks(items, (item) => item.score).map(({ row, rank }) => ({
    ...row,
    rank,
  }));

  return NextResponse.json({
    ok: true,
    institution_name: (inst as any)?.name || "Établissement",
    academic_year: academicYear || null,
    from,
    to,
    requested_to: requestedTo,
    settings: teacherSettings,
    criteria_warnings: criteriaWarnings,
    items: ranked,
  });
}
