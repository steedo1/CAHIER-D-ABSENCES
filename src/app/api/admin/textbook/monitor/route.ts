import { NextRequest, NextResponse } from "next/server";
import {
  cleanText,
  getCurrentAcademicYearCode,
  requireTextbookManager,
} from "@/lib/textbook/context";
import {
  buildTextbookSubjectCatalog,
  findTextbookTeacherForAssignment,
  resolveTextbookAssignmentSubject,
} from "@/lib/textbook/subject-matching";
import { decorateTextbookClassEducation } from "@/lib/textbook/education-context";
import { syncTextbookAssignmentsFromTeaching } from "@/lib/textbook/auto-assignment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONABLE_TYPES = new Set([
  "lesson",
  "sequence",
  "session",
  "evaluation",
  "remediation",
  "regulation",
  "revision",
  "other",
]);

type PeriodCode = "T1" | "T2" | "T3";

function uniq(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function isActionableItem(item: any) {
  return (
    ACTIONABLE_TYPES.has(String(item?.item_type || "")) ||
    Number(item?.planned_duration_minutes || 0) > 0 ||
    Number(item?.planned_sessions_count || 0) > 0
  );
}

function plannedMinutes(item: any) {
  const duration = Number(item?.planned_duration_minutes || 0);
  if (duration > 0) return duration;
  const sessions = Number(item?.planned_sessions_count || 0);
  if (sessions > 0) return sessions * 55;
  return 0;
}

function pct(done: number, total: number) {
  if (!total) return 0;
  return Math.round((done / total) * 1000) / 10;
}

function normalizePeriod(value: unknown): PeriodCode | null {
  const raw = String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (!raw) return null;
  if (
    raw === "t1" ||
    raw.includes("trimestre 1") ||
    raw.includes("1er trimestre") ||
    raw.includes("premier trimestre")
  ) {
    return "T1";
  }
  if (
    raw === "t2" ||
    raw.includes("trimestre 2") ||
    raw.includes("2e trimestre") ||
    raw.includes("deuxieme trimestre")
  ) {
    return "T2";
  }
  if (
    raw === "t3" ||
    raw.includes("trimestre 3") ||
    raw.includes("3e trimestre") ||
    raw.includes("troisieme trimestre")
  ) {
    return "T3";
  }
  return null;
}

function firstRelation(value: unknown) {
  if (Array.isArray(value)) return value[0] || null;
  return value && typeof value === "object" ? (value as any) : null;
}

function periodMetric(
  items: any[],
  completedSet: Set<string>,
  sessions: any[],
) {
  const actionable = items.filter(isActionableItem);
  const itemIds = new Set(actionable.map((item) => String(item.id || "")));
  const expected = actionable.length;
  const completed = actionable.filter((item) =>
    completedSet.has(String(item.id || "")),
  );
  const planned = actionable.reduce(
    (sum, item) => sum + plannedMinutes(item),
    0,
  );
  const completedPlanned = completed.reduce(
    (sum, item) => sum + plannedMinutes(item),
    0,
  );
  const matchingSessions = sessions.filter((session) =>
    itemIds.has(String(session?.item_id || "")),
  );
  const realizedMinutes = matchingSessions.reduce(
    (sum, session) => sum + (Number(session?.duration_minutes || 0) || 0),
    0,
  );

  return {
    expected_items: expected,
    completed_items: completed.length,
    planned_minutes: planned,
    planned_hours: Math.round((planned / 60) * 10) / 10,
    completed_planned_minutes: completedPlanned,
    completed_planned_hours:
      Math.round((completedPlanned / 60) * 10) / 10,
    completion_rate: planned
      ? pct(completedPlanned, planned)
      : pct(completed.length, expected),
    sessions_count: matchingSessions.length,
    realized_minutes: realizedMinutes,
    realized_hours: Math.round((realizedMinutes / 60) * 10) / 10,
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireTextbookManager();
  if (!auth.ok) return auth.response;
  const { srv, institutionId, userId } = auth.ctx;

  const url = new URL(req.url);
  const academicYear =
    cleanText(url.searchParams.get("academic_year"), 30) ||
    (await getCurrentAcademicYearCode(srv, institutionId));

  if (!academicYear) {
    return NextResponse.json(
      { ok: false, error: "academic_year_required" },
      { status: 400 },
    );
  }

  try {
    await syncTextbookAssignmentsFromTeaching({
      srv,
      institutionId,
      userId,
      academicYear,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "textbook_auto_assignment_failed",
      },
      { status: 400 },
    );
  }

  const [{ data: institution }, { data: classYearRows, error: classYearError }] =
    await Promise.all([
      srv
        .from("institutions")
        .select("settings_json")
        .eq("id", institutionId)
        .maybeSingle(),
      srv
        .from("classes")
        .select("academic_year")
        .eq("institution_id", institutionId),
    ]);

  if (classYearError) {
    return NextResponse.json(
      { ok: false, error: classYearError.message },
      { status: 400 },
    );
  }

  const academicYears = uniq(
    (classYearRows || []).map((row: any) => row?.academic_year),
  ).sort((a, b) => b.localeCompare(a));

  const { data: assignmentRows, error: assignmentError } = await srv
    .from("textbook_progression_class_assignments")
    .select(
      `
      id,
      class_id,
      teacher_id,
      subject_id,
      institution_subject_id,
      is_active,
      classes:class_id(
        id,label,level,academic_year,institution_id,
        education_type,formation_code,formation_level_code
      ),
      progression:textbook_progression_templates(
        id,title,academic_year,subject_id,institution_subject_id,
        subject_name,level,series,status
      )
    `,
    )
    .eq("institution_id", institutionId)
    .eq("is_active", true);

  if (assignmentError) {
    return NextResponse.json(
      { ok: false, error: assignmentError.message },
      { status: 400 },
    );
  }

  const assignments = ((assignmentRows || []) as any[]).filter((row) => {
    const progression = firstRelation(row?.progression) || {};
    const classRow = firstRelation(row?.classes) || {};
    if (String(progression?.status || "") !== "active") return false;
    const year =
      String(progression?.academic_year || classRow?.academic_year || "").trim();
    return !academicYear || year === academicYear;
  });

  const assignmentIds = uniq(assignments.map((row) => row?.id));
  const progressionIds = uniq(
    assignments.map((row) => (firstRelation(row?.progression) || {})?.id),
  );
  const classIds = uniq(assignments.map((row) => row?.class_id));

  const classTeachersByClass = new Map<string, any[]>();
  if (classIds.length) {
    const { data: classTeachers, error: classTeacherError } = await srv
      .from("class_teachers")
      .select("class_id,teacher_id,subject_id")
      .eq("institution_id", institutionId)
      .in("class_id", classIds)
      .is("end_date", null);

    if (classTeacherError) {
      return NextResponse.json(
        { ok: false, error: classTeacherError.message },
        { status: 400 },
      );
    }

    for (const row of (classTeachers || []) as any[]) {
      const classId = String(row?.class_id || "");
      if (!classId) continue;
      if (!classTeachersByClass.has(classId)) {
        classTeachersByClass.set(classId, []);
      }
      classTeachersByClass.get(classId)!.push(row);
    }
  }

  let subjectCatalog;
  try {
    subjectCatalog = await buildTextbookSubjectCatalog(srv, institutionId, [
      ...assignments.flatMap((assignment) => {
        const progression = firstRelation(assignment?.progression) || {};
        return [
          assignment?.subject_id,
          assignment?.institution_subject_id,
          progression?.subject_id,
          progression?.institution_subject_id,
        ];
      }),
      ...Array.from(classTeachersByClass.values())
        .flat()
        .map((row) => row?.subject_id),
    ]);
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "subject_catalog_error" },
      { status: 400 },
    );
  }

  const effectiveTeacherByAssignment = new Map<string, string | null>();
  const resolvedSubjectByAssignment = new Map<string, any>();

  for (const assignment of assignments) {
    const assignmentId = String(assignment?.id || "");
    const rows =
      classTeachersByClass.get(String(assignment?.class_id || "")) || [];
    effectiveTeacherByAssignment.set(
      assignmentId,
      findTextbookTeacherForAssignment(assignment, rows, subjectCatalog),
    );
    resolvedSubjectByAssignment.set(
      assignmentId,
      resolveTextbookAssignmentSubject(assignment, subjectCatalog),
    );
  }

  const teacherIds = uniq(Array.from(effectiveTeacherByAssignment.values()));
  const teacherNames = new Map<string, string>();
  if (teacherIds.length) {
    const [profilesResult, teachersResult] = await Promise.all([
      srv.from("profiles").select("id,display_name").in("id", teacherIds),
      srv.from("teachers").select("id,full_name").in("id", teacherIds),
    ]);

    if (!profilesResult.error) {
      for (const profile of (profilesResult.data || []) as any[]) {
        const id = String(profile?.id || "").trim();
        const name = String(profile?.display_name || "").trim();
        if (id && name) teacherNames.set(id, name);
      }
    }

    if (!teachersResult.error) {
      for (const teacher of (teachersResult.data || []) as any[]) {
        const id = String(teacher?.id || "").trim();
        if (!id || teacherNames.has(id)) continue;
        const name = String(teacher?.full_name || "").trim();
        if (name) teacherNames.set(id, name);
      }
    }
  }

  const itemsByProgression = new Map<string, any[]>();
  if (progressionIds.length) {
    const { data: progressionItems, error: itemsError } = await srv
      .from("textbook_progression_items")
      .select(
        "id,progression_id,item_type,trimester,planned_duration_minutes,planned_sessions_count",
      )
      .eq("institution_id", institutionId)
      .in("progression_id", progressionIds);

    if (itemsError) {
      return NextResponse.json(
        { ok: false, error: itemsError.message },
        { status: 400 },
      );
    }

    for (const item of (progressionItems || []) as any[]) {
      const progressionId = String(item?.progression_id || "");
      if (!itemsByProgression.has(progressionId)) {
        itemsByProgression.set(progressionId, []);
      }
      itemsByProgression.get(progressionId)!.push(item);
    }
  }

  const completedByAssignment = new Map<string, Set<string>>();
  if (assignmentIds.length) {
    const { data: completions, error: completionError } = await srv
      .from("textbook_lesson_completions")
      .select("assignment_id,item_id,status")
      .eq("institution_id", institutionId)
      .in("assignment_id", assignmentIds)
      .eq("status", "completed");

    if (completionError) {
      return NextResponse.json(
        { ok: false, error: completionError.message },
        { status: 400 },
      );
    }

    for (const row of (completions || []) as any[]) {
      const assignmentId = String(row?.assignment_id || "");
      if (!completedByAssignment.has(assignmentId)) {
        completedByAssignment.set(assignmentId, new Set());
      }
      completedByAssignment
        .get(assignmentId)!
        .add(String(row?.item_id || ""));
    }
  }

  const sessionsByAssignment = new Map<string, any[]>();
  if (assignmentIds.length) {
    const { data: sessions, error: sessionError } = await srv
      .from("textbook_lesson_sessions")
      .select("assignment_id,item_id,duration_minutes,session_date")
      .eq("institution_id", institutionId)
      .in("assignment_id", assignmentIds);

    if (sessionError) {
      return NextResponse.json(
        { ok: false, error: sessionError.message },
        { status: 400 },
      );
    }

    for (const session of (sessions || []) as any[]) {
      const assignmentId = String(session?.assignment_id || "");
      if (!sessionsByAssignment.has(assignmentId)) {
        sessionsByAssignment.set(assignmentId, []);
      }
      sessionsByAssignment.get(assignmentId)!.push(session);
    }
  }

  const educationSettings = (institution as any)?.settings_json || null;

  const items = assignments
    .map((assignment) => {
      const assignmentId = String(assignment?.id || "");
      const progression = firstRelation(assignment?.progression) || {};
      const classRow = decorateTextbookClassEducation(
        firstRelation(assignment?.classes),
        educationSettings,
      );
      const progressionItems =
        itemsByProgression.get(String(progression?.id || "")) || [];
      const completed =
        completedByAssignment.get(assignmentId) || new Set<string>();
      const sessions = sessionsByAssignment.get(assignmentId) || [];
      const annual = periodMetric(progressionItems, completed, sessions);

      const periods = (["T1", "T2", "T3"] as PeriodCode[]).reduce(
        (acc, code) => {
          acc[code] = periodMetric(
            progressionItems.filter(
              (item) => normalizePeriod(item?.trimester) === code,
            ),
            completed,
            sessions,
          );
          return acc;
        },
        {} as Record<PeriodCode, ReturnType<typeof periodMetric>>,
      );

      const teacherId =
        effectiveTeacherByAssignment.get(assignmentId) || null;
      const resolvedSubject = resolvedSubjectByAssignment.get(assignmentId);

      return {
        assignment_id: assignmentId,
        progression_id: progression?.id || null,
        progression_title: progression?.title || "Progression",
        academic_year:
          progression?.academic_year || classRow?.academic_year || academicYear,
        class_id: assignment?.class_id || classRow?.id || null,
        class_label: classRow?.label || "Classe",
        level: classRow?.level || progression?.level || null,
        education_type: classRow?.education_type || "general_secondary",
        education_label: classRow?.education_label || "Secondaire général",
        education_context_label:
          classRow?.education_context_label || "Secondaire général",
        subject_id:
          resolvedSubject?.globalSubjectId ||
          progression?.subject_id ||
          assignment?.subject_id ||
          null,
        subject_name:
          resolvedSubject?.displayName ||
          progression?.subject_name ||
          "Matière",
        teacher_id: teacherId,
        teacher_name: teacherId
          ? teacherNames.get(teacherId) || "Nom enseignant indisponible"
          : "Enseignant non affecté",
        ...annual,
        periods,
      };
    })
    .sort((a, b) => {
      const byLevel = String(a.level || "").localeCompare(
        String(b.level || ""),
        "fr",
        { numeric: true },
      );
      if (byLevel) return byLevel;
      const byClass = String(a.class_label || "").localeCompare(
        String(b.class_label || ""),
        "fr",
        { numeric: true },
      );
      if (byClass) return byClass;
      return String(a.subject_name || "").localeCompare(
        String(b.subject_name || ""),
        "fr",
      );
    });

  const totals = items.reduce(
    (acc, item) => {
      acc.assignments += 1;
      acc.expected_items += item.expected_items;
      acc.completed_items += item.completed_items;
      acc.planned_minutes += item.planned_minutes;
      acc.completed_planned_minutes += item.completed_planned_minutes;
      acc.sessions_count += item.sessions_count;
      acc.realized_minutes += item.realized_minutes;
      return acc;
    },
    {
      assignments: 0,
      expected_items: 0,
      completed_items: 0,
      planned_minutes: 0,
      completed_planned_minutes: 0,
      sessions_count: 0,
      realized_minutes: 0,
    },
  );

  return NextResponse.json({
    ok: true,
    academic_year: academicYear,
    academic_years: academicYears.includes(academicYear)
      ? academicYears
      : [academicYear, ...academicYears],
    totals: {
      ...totals,
      completion_rate: totals.planned_minutes
        ? pct(totals.completed_planned_minutes, totals.planned_minutes)
        : pct(totals.completed_items, totals.expected_items),
      planned_hours: Math.round((totals.planned_minutes / 60) * 10) / 10,
      completed_planned_hours:
        Math.round((totals.completed_planned_minutes / 60) * 10) / 10,
      realized_hours:
        Math.round((totals.realized_minutes / 60) * 10) / 10,
    },
    items,
  });
}
