import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Role = "admin" | "super_admin" | "educator" | string;
type WeekdayMode = "iso" | "js" | "mon0";

type PeriodRow = {
  id: string;
  code: string | null;
  label: string | null;
  short_label: string | null;
  start_date: string | null;
  end_date: string | null;
  academic_year: string | null;
};

type EvaluationBucket = {
  class_id: string;
  subject_id: string;
  teacher_id: string;
  devoirs: number;
  interrogations: number;
  total: number;
  published: number;
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function pct(value: number, total: number) {
  if (!total) return 0;
  return round2((value / total) * 100);
}

function normalizeText(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseYMD(value: string | null | undefined) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isFinite(date.getTime()) ? date : null;
}

function toYMD(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;
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

function parseWeekday(raw: unknown) {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

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

function normalizeTime(raw: unknown) {
  const match = String(raw || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function niceStudentName(row: any) {
  const full = String(row?.full_name || "").trim();
  if (full) return full;
  return [row?.last_name, row?.first_name].map((part) => String(part || "").trim()).filter(Boolean).join(" ") || "Élève";
}

function niceTeacherName(row: any) {
  const display = String(row?.display_name || "").trim();
  const composed = [row?.last_name, row?.first_name]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  return display || composed || "Enseignant";
}

function firstRelation(value: any) {
  if (Array.isArray(value)) return value[0] || null;
  return value && typeof value === "object" ? value : null;
}

function evaluationKind(kind: unknown) {
  const normalized = normalizeText(kind);
  if (normalized === "devoir") return "devoir" as const;
  if (normalized === "interro_ecrite" || normalized === "interro_orale") return "interrogation" as const;
  return "other" as const;
}

function evaluationIsGood(bucket: EvaluationBucket) {
  // Référence officielle : 4 devoirs + 4 interrogations.
  // Tolérance métier validée : 3 interrogations + 2 devoirs (ou l'inverse) est satisfaisant.
  return bucket.total >= 5 && bucket.devoirs >= 2 && bucket.interrogations >= 2;
}

function isObservedSession(row: any) {
  if (!row?.actual_call_at || !row?.started_at) return false;
  const start = new Date(row.started_at).getTime();
  const actual = new Date(row.actual_call_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(actual) || actual < start) return false;
  const status = normalizeText(row?.status);
  return Boolean(row?.ended_at) || ["submitted", "closed", "completed", "validated"].includes(status);
}

async function getContext() {
  const supa = await getSupabaseServerClient();
  const srv = getSupabaseServiceClient();
  const {
    data: { user },
  } = await supa.auth.getUser();

  if (!user) return { error: "unauthorized" as const, status: 401 as const };

  const { data: profile, error: profileError } = await supa
    .from("profiles")
    .select("id,institution_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) return { error: profileError.message, status: 400 as const };
  const institutionId = String(profile?.institution_id || "").trim();
  if (!institutionId) return { error: "no_institution" as const, status: 400 as const };

  const { data: roleRow } = await supa
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("institution_id", institutionId)
    .maybeSingle();

  const role = String(roleRow?.role || "") as Role;
  if (!["admin", "super_admin", "educator"].includes(role)) {
    return { error: "forbidden" as const, status: 403 as const };
  }

  return { supa, srv, user, institutionId, role };
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getContext();
    if ("error" in ctx) {
      return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status });
    }

    const url = new URL(req.url);
    const requestedYear = String(url.searchParams.get("academic_year") || "").trim();
    const classId = String(url.searchParams.get("class_id") || "").trim();
    const periodId = String(url.searchParams.get("period_id") || "").trim();

    const [{ data: years, error: yearsError }, { data: institution, error: institutionError }] = await Promise.all([
      ctx.srv
        .from("academic_years")
        .select("id,code,label,start_date,end_date,is_current")
        .eq("institution_id", ctx.institutionId)
        .order("start_date", { ascending: false }),
      ctx.srv.from("institutions").select("*").eq("id", ctx.institutionId).maybeSingle(),
    ]);

    if (yearsError) throw new Error(yearsError.message);
    if (institutionError) throw new Error(institutionError.message);

    const currentYear = (years || []).find((year: any) => Boolean(year.is_current)) || (years || [])[0] || null;
    const academicYear = requestedYear || String(currentYear?.code || currentYear?.label || "").trim();

    const [{ data: classes, error: classesError }, { data: periods, error: periodsError }] = await Promise.all([
      ctx.srv
        .from("classes")
        .select("id,label,level,academic_year")
        .eq("institution_id", ctx.institutionId)
        .eq("academic_year", academicYear)
        .order("level", { ascending: true })
        .order("label", { ascending: true }),
      ctx.srv
        .from("grade_periods")
        .select("id,code,label,short_label,start_date,end_date,academic_year")
        .eq("institution_id", ctx.institutionId)
        .eq("academic_year", academicYear)
        .order("start_date", { ascending: true }),
    ]);

    if (classesError) throw new Error(classesError.message);
    if (periodsError) throw new Error(periodsError.message);

    const periodRows = (periods || []) as PeriodRow[];
    const selectedPeriod = periodRows.find((period) => period.id === periodId) || null;
    const selectedClass = (classes || []).find((row: any) => String(row.id) === classId) || null;

    const options = {
      academic_years: years || [],
      classes: classes || [],
      periods: periodRows,
      defaults: {
        academic_year: academicYear,
        class_id: String((classes || [])[0]?.id || ""),
        period_id: String(periodRows[periodRows.length - 1]?.id || ""),
      },
      institution: {
        name: String((institution as any)?.name || (institution as any)?.label || "Établissement"),
        logo_url: String((institution as any)?.logo_url || (institution as any)?.institution_logo_url || "") || null,
        code: String((institution as any)?.code || (institution as any)?.code_unique || "") || null,
        phone: String((institution as any)?.phone || "") || null,
      },
    };

    if (!classId || !periodId) {
      return NextResponse.json({ ok: true, options });
    }

    if (!selectedClass || !selectedPeriod) {
      return NextResponse.json({ ok: false, error: "invalid_scope" }, { status: 400 });
    }

    const periodCode = String(selectedPeriod.code || selectedPeriod.short_label || selectedPeriod.label || "").trim();
    const from = String(selectedPeriod.start_date || "").slice(0, 10);
    const to = String(selectedPeriod.end_date || "").slice(0, 10);
    if (!periodCode || !parseYMD(from) || !parseYMD(to)) {
      return NextResponse.json({ ok: false, error: "period_dates_missing" }, { status: 400 });
    }

    const { data: studentResults, error: studentResultsError } = await ctx.srv
      .from("student_period_results")
      .select(
        "student_id,absences_count,lates_count,total_absent_hours,total_late_minutes",
      )
      .eq("institution_id", ctx.institutionId)
      .eq("academic_year", academicYear)
      .eq("class_id", classId)
      .eq("period_code", periodCode);

    if (studentResultsError) throw new Error(studentResultsError.message);

    const bulletinUrl = new URL("/api/admin/grades/bulletin", req.nextUrl.origin);
    bulletinUrl.searchParams.set("class_id", classId);
    bulletinUrl.searchParams.set("from", from);
    bulletinUrl.searchParams.set("to", to);
    bulletinUrl.searchParams.set("published", "true");
    bulletinUrl.searchParams.set("active_only", "true");
    bulletinUrl.searchParams.set("academic_year", academicYear);
    bulletinUrl.searchParams.set("period_code", periodCode);
    bulletinUrl.searchParams.set("export_light", "1");

    const cookie = req.headers.get("cookie") || "";
    const authorization = req.headers.get("authorization") || "";
    const bulletinResponse = await fetch(bulletinUrl.toString(), {
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(authorization ? { authorization } : {}),
      },
      cache: "no-store",
    });

    if (!bulletinResponse.ok) {
      throw new Error(`bulletin_officiel_indisponible_http_${bulletinResponse.status}`);
    }

    const bulletinJson = (await bulletinResponse.json().catch(() => null)) as any;
    if (!bulletinJson?.ok || !Array.isArray(bulletinJson?.items)) {
      throw new Error("bulletin_officiel_invalide");
    }

    const attendanceByStudent = new Map<string, any>(
      (studentResults || []).map((row: any) => [String(row.student_id), row] as const),
    );
    const bulletinSubjectNames = new Map<string, string>();
    for (const row of Array.isArray(bulletinJson?.subjects) ? bulletinJson.subjects : []) {
      const subjectId = String(row?.subject_id || row?.id || "").trim();
      if (!subjectId) continue;
      bulletinSubjectNames.set(
        subjectId,
        String(row?.subject_name || row?.name || row?.label || row?.code || "Matière"),
      );
    }

    const bulletinItems: any[] = (bulletinJson.items || []).filter((item: any) =>
      Number.isFinite(Number(item?.general_avg)),
    );

    const difficultStudents = bulletinItems
      .filter((item: any) => Number(item.general_avg) < 10)
      .map((item: any) => {
        const studentId = String(item.student_id || "");
        const attendance = attendanceByStudent.get(studentId);
        const weakSubjects = (Array.isArray(item?.per_subject) ? item.per_subject : [])
          .map((subject: any) => {
            const subjectId = String(subject?.subject_id || subject?.id || "").trim();
            const average = Number(subject?.avg20);
            if (!subjectId || !Number.isFinite(average) || average >= 10) return null;
            return {
              name:
                String(
                  subject?.subject_name ||
                    subject?.name ||
                    subject?.label ||
                    subject?.code ||
                    bulletinSubjectNames.get(subjectId) ||
                    "Matière",
                ),
              average: round2(average),
            };
          })
          .filter(Boolean)
          .sort((a: any, b: any) => a.average - b.average)
          .slice(0, 4);

        return {
          student_id: studentId,
          full_name: String(item?.full_name || item?.matricule || "Élève"),
          matricule: item?.matricule == null ? null : String(item.matricule),
          average: round2(Number(item.general_avg)),
          rank: item?.rank == null ? null : Number(item.rank),
          priority: Number(item.general_avg) < 8 ? "priority" : "watch",
          weak_subjects: weakSubjects,
          absences: Number(attendance?.absences_count || 0),
          lates: Number(attendance?.lates_count || 0),
        };
      })
      .sort((a: any, b: any) => a.average - b.average);

    type SubjectAggregate = {
      subject_id: string;
      subject_name: string;
      sum: number;
      count: number;
      under10: number;
      under8: number;
    };
    const subjectAggregates = new Map<string, SubjectAggregate>();
    for (const item of bulletinItems) {
      for (const subject of Array.isArray(item?.per_subject) ? item.per_subject : []) {
        const subjectId = String(subject?.subject_id || subject?.id || "").trim();
        const average = Number(subject?.avg20);
        if (!subjectId || !Number.isFinite(average)) continue;
        const aggregate = subjectAggregates.get(subjectId) || {
          subject_id: subjectId,
          subject_name: String(
            subject?.subject_name ||
              subject?.name ||
              subject?.label ||
              subject?.code ||
              bulletinSubjectNames.get(subjectId) ||
              "Matière",
          ),
          sum: 0,
          count: 0,
          under10: 0,
          under8: 0,
        };
        aggregate.sum += average;
        aggregate.count += 1;
        if (average < 10) aggregate.under10 += 1;
        if (average < 8) aggregate.under8 += 1;
        subjectAggregates.set(subjectId, aggregate);
      }
    }

    const bulletinSubjectIds = Array.from(subjectAggregates.keys());

    const [{ data: evaluations, error: evaluationsError }, { data: timetableRows, error: timetableError }] =
      await Promise.all([
        ctx.srv
          .from("grade_evaluations")
          .select("id,class_id,subject_id,teacher_id,eval_date,eval_kind,is_published")
          .eq("class_id", classId)
          .gte("eval_date", from)
          .lte("eval_date", to),
        ctx.srv
          .from("teacher_timetables")
          .select("id,institution_id,class_id,subject_id,teacher_id,weekday,period_id")
          .eq("institution_id", ctx.institutionId)
          .eq("class_id", classId),
      ]);

    if (evaluationsError) throw new Error(evaluationsError.message);
    if (timetableError) throw new Error(timetableError.message);

    const teacherIds = Array.from(
      new Set(
        [...(evaluations || []), ...(timetableRows || [])]
          .map((row: any) => String(row.teacher_id || ""))
          .filter(Boolean),
      ),
    );
    const allSubjectIds = Array.from(
      new Set(
        [...bulletinSubjectIds.map((subject_id) => ({ subject_id })), ...(evaluations || []), ...(timetableRows || [])]
          .map((row: any) => String(row.subject_id || ""))
          .filter(Boolean),
      ),
    );

    const [{ data: teachers }, { data: baseSubjects }, { data: institutionSubjects }] = await Promise.all([
      teacherIds.length
        ? ctx.srv.from("profiles").select("id,display_name,first_name,last_name").in("id", teacherIds)
        : Promise.resolve({ data: [] } as any),
      allSubjectIds.length
        ? ctx.srv.from("subjects").select("id,name,code").in("id", allSubjectIds)
        : Promise.resolve({ data: [] } as any),
      allSubjectIds.length
        ? ctx.srv
            .from("institution_subjects")
            .select("id,subject_id,custom_name,subjects:subject_id(id,name,code)")
            .eq("institution_id", ctx.institutionId)
        : Promise.resolve({ data: [] } as any),
    ]);

    const teacherNameById = new Map(
      (teachers || []).map((row: any) => [String(row.id), niceTeacherName(row)] as const),
    );
    const subjectNameById = new Map<string, string>();
    const canonicalSubjectById = new Map<string, string>();
    for (const row of baseSubjects || []) {
      subjectNameById.set(String((row as any).id), String((row as any).name || (row as any).code || "Matière"));
    }
    for (const row of institutionSubjects || []) {
      const relation = firstRelation((row as any).subjects);
      const name = String((row as any).custom_name || relation?.name || relation?.code || "Matière");
      const institutionSubjectId = String((row as any).id || "");
      const baseSubjectId = String((row as any).subject_id || institutionSubjectId);
      if (institutionSubjectId) {
        subjectNameById.set(institutionSubjectId, name);
        canonicalSubjectById.set(institutionSubjectId, baseSubjectId);
      }
      if (baseSubjectId) subjectNameById.set(baseSubjectId, name);
    }
    const canonicalSubjectId = (raw: unknown) => {
      const id = String(raw || "").trim();
      return canonicalSubjectById.get(id) || id;
    };

    const canonicalSubjectAggregates = new Map<string, SubjectAggregate>();
    for (const aggregate of subjectAggregates.values()) {
      const canonicalId = canonicalSubjectId(aggregate.subject_id);
      const current = canonicalSubjectAggregates.get(canonicalId) || {
        subject_id: canonicalId,
        subject_name: subjectNameById.get(canonicalId) || aggregate.subject_name,
        sum: 0,
        count: 0,
        under10: 0,
        under8: 0,
      };
      current.sum += aggregate.sum;
      current.count += aggregate.count;
      current.under10 += aggregate.under10;
      current.under8 += aggregate.under8;
      canonicalSubjectAggregates.set(canonicalId, current);
      subjectNameById.set(aggregate.subject_id, current.subject_name);
      subjectNameById.set(canonicalId, current.subject_name);
    }

    const evaluationBuckets = new Map<string, EvaluationBucket>();
    const ensureEvaluationBucket = (subjectId: string, teacherId: string) => {
      const key = `${subjectId}::${teacherId}`;
      let bucket = evaluationBuckets.get(key);
      if (!bucket) {
        bucket = {
          class_id: classId,
          subject_id: subjectId,
          teacher_id: teacherId,
          devoirs: 0,
          interrogations: 0,
          total: 0,
          published: 0,
        };
        evaluationBuckets.set(key, bucket);
      }
      return bucket;
    };

    for (const row of timetableRows || []) {
      const subjectId = canonicalSubjectId((row as any).subject_id);
      const teacherId = String((row as any).teacher_id || "");
      if (subjectId && teacherId) ensureEvaluationBucket(subjectId, teacherId);
    }
    for (const row of evaluations || []) {
      const subjectId = canonicalSubjectId((row as any).subject_id);
      const teacherId = String((row as any).teacher_id || "");
      if (!subjectId || !teacherId) continue;
      const bucket = ensureEvaluationBucket(subjectId, teacherId);
      if (!Boolean((row as any).is_published)) continue;
      bucket.total += 1;
      bucket.published += 1;
      const kind = evaluationKind((row as any).eval_kind);
      if (kind === "devoir") bucket.devoirs += 1;
      if (kind === "interrogation") bucket.interrogations += 1;
    }

    const evaluationAlerts = Array.from(evaluationBuckets.values())
      .filter((bucket) => !evaluationIsGood(bucket))
      .map((bucket) => ({
        subject_id: bucket.subject_id,
        subject_name: subjectNameById.get(bucket.subject_id) || "Matière",
        teacher_id: bucket.teacher_id,
        teacher_name: teacherNameById.get(bucket.teacher_id) || "Enseignant",
        devoirs: bucket.devoirs,
        interrogations: bucket.interrogations,
        total: bucket.total,
        severity: bucket.total <= 2 || bucket.devoirs === 0 || bucket.interrogations === 0 ? "high" : "watch",
        message:
          bucket.total === 0
            ? "Aucune évaluation publiée sur la période."
            : `${bucket.interrogations} interrogation(s) et ${bucket.devoirs} devoir(s) publiés.`,
      }))
      .sort((a, b) => a.total - b.total || a.subject_name.localeCompare(b.subject_name));

    const problemSubjects = Array.from(canonicalSubjectAggregates.values())
      .map((aggregate) => ({
        subject_id: aggregate.subject_id,
        subject_name: aggregate.subject_name,
        average: round2(aggregate.sum / Math.max(1, aggregate.count)),
        students_count: aggregate.count,
        under_10: aggregate.under10,
        under_8: aggregate.under8,
        weak_rate: pct(aggregate.under10, aggregate.count),
      }))
      .filter((subject) => subject.average < 10 || subject.weak_rate >= 40)
      .sort((a, b) => a.average - b.average || b.weak_rate - a.weak_rate);

    const [{ data: institutionPeriods, error: institutionPeriodsError }, { data: sessions, error: sessionsError }, { data: absenceRequests, error: absenceRequestsError }] =
      await Promise.all([
        ctx.srv
          .from("institution_periods")
          .select("id,weekday,start_time,end_time")
          .eq("institution_id", ctx.institutionId),
        ctx.srv
          .from("teacher_sessions")
          .select("id,teacher_id,class_id,subject_id,started_at,actual_call_at,ended_at,status")
          .eq("institution_id", ctx.institutionId)
          .eq("class_id", classId)
          .gte("started_at", `${from}T00:00:00.000Z`)
          .lt("started_at", new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000).toISOString()),
        teacherIds.length
          ? ctx.srv
              .from("teacher_absence_requests")
              .select("teacher_profile_id,start_date,end_date,status")
              .eq("institution_id", ctx.institutionId)
              .eq("status", "approved")
              .in("teacher_profile_id", teacherIds)
              .lte("start_date", to)
              .gte("end_date", from)
          : Promise.resolve({ data: [], error: null } as any),
      ]);

    if (institutionPeriodsError) throw new Error(institutionPeriodsError.message);
    if (sessionsError) throw new Error(sessionsError.message);
    if (absenceRequestsError) throw new Error(absenceRequestsError.message);

    const weekdayMode = detectWeekdayMode(institutionPeriods || []);
    const periodById = new Map<string, { weekday: number | null; start_time: string | null }>(
      (institutionPeriods || []).map((row: any) => [
        String(row.id),
        {
          weekday: parseWeekday(row.weekday),
          start_time: normalizeTime(row.start_time),
        },
      ] as const),
    );
    const approvedAbsences = new Map<string, Array<{ start: string; end: string }>>();
    for (const row of absenceRequests || []) {
      const teacherId = String((row as any).teacher_profile_id || "");
      const start = String((row as any).start_date || "").slice(0, 10);
      const end = String((row as any).end_date || "").slice(0, 10);
      if (!teacherId || !start || !end) continue;
      const current = approvedAbsences.get(teacherId) || [];
      current.push({ start, end });
      approvedAbsences.set(teacherId, current);
    }

    const sessionKeys = new Set<string>();
    for (const row of sessions || []) {
      if (!isObservedSession(row)) continue;
      const startedAt = String((row as any).started_at || "");
      sessionKeys.add(
        `${String((row as any).teacher_id || "")}|${String((row as any).class_id || "")}|${startedAt.slice(0, 10)}|${startedAt.slice(11, 16)}`,
      );
    }

    type SessionMetric = {
      subject_id: string;
      teacher_id: string;
      expected: number;
      completed: number;
      justified: number;
    };
    const sessionMetrics = new Map<string, SessionMetric>();
    const plannedKeys = new Set<string>();
    for (const date of dateRange(from, to)) {
      const dateValue = toYMD(date);
      const weekday = jsDayToDbWeekday(date.getUTCDay(), weekdayMode);
      for (const row of timetableRows || []) {
        const teacherId = String((row as any).teacher_id || "");
        const subjectId = canonicalSubjectId((row as any).subject_id);
        const period = periodById.get(String((row as any).period_id || ""));
        const timetableWeekday = parseWeekday((row as any).weekday) ?? period?.weekday ?? null;
        if (!teacherId || !subjectId || !period?.start_time || timetableWeekday !== weekday) continue;

        const slotKey = `${teacherId}|${classId}|${dateValue}|${period.start_time}`;
        if (plannedKeys.has(slotKey)) continue;
        plannedKeys.add(slotKey);

        const metricKey = `${subjectId}::${teacherId}`;
        const metric = sessionMetrics.get(metricKey) || {
          subject_id: subjectId,
          teacher_id: teacherId,
          expected: 0,
          completed: 0,
          justified: 0,
        };
        metric.expected += 1;
        const justified = (approvedAbsences.get(teacherId) || []).some(
          (absence) => dateValue >= absence.start && dateValue <= absence.end,
        );
        if (justified) metric.justified += 1;
        else if (sessionKeys.has(slotKey)) metric.completed += 1;
        sessionMetrics.set(metricKey, metric);
      }
    }

    const teacherSessions = Array.from(sessionMetrics.values())
      .map((metric) => {
        const unresolved = Math.max(0, metric.expected - metric.completed - metric.justified);
        const observableExpected = Math.max(0, metric.expected - metric.justified);
        return {
          subject_id: metric.subject_id,
          subject_name: subjectNameById.get(metric.subject_id) || "Matière",
          teacher_id: metric.teacher_id,
          teacher_name: teacherNameById.get(metric.teacher_id) || "Enseignant",
          expected: metric.expected,
          completed: metric.completed,
          justified: metric.justified,
          unresolved,
          completion_rate: observableExpected > 0 ? pct(metric.completed, observableExpected) : 100,
        };
      })
      .sort((a, b) => b.unresolved - a.unresolved || a.subject_name.localeCompare(b.subject_name));

    const numericAverages: number[] = bulletinItems
      .map((item: any) => Number(item.general_avg))
      .filter((value: number) => Number.isFinite(value));
    const classAverage = numericAverages.length
      ? round2(numericAverages.reduce((sum, value) => sum + value, 0) / numericAverages.length)
      : null;
    const minAverage = numericAverages.length ? round2(Math.min(...numericAverages)) : null;
    const maxAverage = numericAverages.length ? round2(Math.max(...numericAverages)) : null;
    const studentsUnder8 = difficultStudents.filter((student) => student.average < 8).length;
    const totalAbsences = (studentResults || []).reduce((sum: number, row: any) => sum + Number(row.absences_count || 0), 0);
    const totalLates = (studentResults || []).reduce((sum: number, row: any) => sum + Number(row.lates_count || 0), 0);
    const totalExpectedSessions = teacherSessions.reduce((sum, row) => sum + row.expected, 0);
    const totalCompletedSessions = teacherSessions.reduce((sum, row) => sum + row.completed, 0);
    const totalJustifiedSessions = teacherSessions.reduce((sum, row) => sum + row.justified, 0);
    const totalUnresolvedSessions = teacherSessions.reduce((sum, row) => sum + row.unresolved, 0);

    const problems: string[] = [];
    const recommendations: string[] = [];

    if (studentsUnder8 > 0) {
      problems.push(`${studentsUnder8} élève(s) présentent une moyenne inférieure à 8/20 et nécessitent un examen prioritaire.`);
      recommendations.push(`Examiner individuellement les ${studentsUnder8} élève(s) prioritaires pendant le conseil de classe.`);
    }
    const watchCount = difficultStudents.length - studentsUnder8;
    if (watchCount > 0 && problems.length < 5) {
      problems.push(`${watchCount} autre(s) élève(s) ont une moyenne comprise entre 8 et 10/20.`);
      recommendations.push(`Identifier les difficultés précises des ${watchCount} élève(s) en vigilance et suivre leur évolution au trimestre suivant.`);
    }
    if (problemSubjects.length > 0 && problems.length < 5) {
      const subject = problemSubjects[0];
      problems.push(`${subject.subject_name} est la matière la plus préoccupante : moyenne ${subject.average.toFixed(2)}/20, ${subject.under_10} élève(s) sous 10/20.`);
      recommendations.push(`Prévoir une remédiation ciblée dans la matière ${subject.subject_name}, en priorité sur les notions les moins maîtrisées.`);
    }
    if (evaluationAlerts.length > 0 && problems.length < 5) {
      const highCount = evaluationAlerts.filter((alert) => alert.severity === "high").length;
      problems.push(`${evaluationAlerts.length} matière(s) présentent un volume ou une répartition d’évaluations à vérifier${highCount ? `, dont ${highCount} situation(s) prioritaire(s)` : ""}.`);
      recommendations.push(`Vérifier la complétude des évaluations dans les ${evaluationAlerts.length} matière(s) signalée(s) avant la clôture définitive du trimestre.`);
    }
    if (totalUnresolvedSessions > 0 && problems.length < 5) {
      problems.push(`${totalUnresolvedSessions} séance(s) programmée(s) ne sont pas validées ou renseignées sur la période.`);
      recommendations.push(`Clarifier le statut des ${totalUnresolvedSessions} séance(s) non validée(s) afin de distinguer annulation, absence justifiée et oubli de saisie.`);
    }
    const difficultWithAbsence = difficultStudents.filter((student) => student.absences > 0 || student.lates > 0).length;
    if (difficultWithAbsence > 0 && problems.length < 5) {
      problems.push(`${difficultWithAbsence} élève(s) en difficulté cumulent également absences ou retards.`);
      recommendations.push(`Examiner l’assiduité des ${difficultWithAbsence} élève(s) concernés et associer les familles lorsque la situation le justifie.`);
    }

    if (!problems.length) {
      problems.push("Aucune difficulté majeure n’est détectée dans les données disponibles pour cette classe et cette période.");
      recommendations.push("Maintenir le suivi régulier de la classe et confirmer les constats lors du conseil de classe.");
    }

    const dataWarnings: string[] = [];
    if (!(studentResults || []).length) {
      dataWarnings.push("Les compteurs d’absences et de retards ne sont pas encore persistés pour cette classe et cette période.");
    }
    if (!bulletinItems.length) {
      dataWarnings.push("Aucune moyenne officielle exploitable n’a été trouvée dans le bulletin de cette période.");
    }

    return NextResponse.json({
      ok: true,
      options,
      report: {
        generated_at: new Date().toISOString(),
        academic_year: academicYear,
        class: {
          id: String(selectedClass.id),
          label: String(selectedClass.label || "Classe"),
          level: String(selectedClass.level || "") || null,
        },
        period: {
          id: selectedPeriod.id,
          code: periodCode,
          label: String(selectedPeriod.label || selectedPeriod.short_label || periodCode),
          start_date: from,
          end_date: to,
        },
        summary: {
          students_count: numericAverages.length,
          class_average: classAverage,
          min_average: minAverage,
          max_average: maxAverage,
          students_under_10: difficultStudents.length,
          students_under_8: studentsUnder8,
          absences: totalAbsences,
          lates: totalLates,
          expected_teacher_sessions: totalExpectedSessions,
          completed_teacher_sessions: totalCompletedSessions,
          justified_teacher_absences: totalJustifiedSessions,
          unresolved_teacher_sessions: totalUnresolvedSessions,
        },
        difficult_students: difficultStudents,
        problem_subjects: problemSubjects,
        evaluation_alerts: evaluationAlerts,
        teacher_sessions: teacherSessions,
        problems: problems.slice(0, 5),
        recommendations: recommendations.slice(0, 5),
        data_warnings: dataWarnings,
        methodology: {
          evaluation_reference: "4 interrogations et 4 devoirs par trimestre",
          accepted_flexible_minimum: "5 évaluations publiées, avec au moins 2 devoirs et 2 interrogations",
          teacher_session_note:
            "Une séance non validée n’est pas automatiquement une absence de l’enseignant ; elle reste à vérifier.",
        },
      },
    });
  } catch (error: any) {
    console.error("[notes/conseil-classe/ai-report] failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "class_council_report_failed" },
      { status: 500 },
    );
  }
}
