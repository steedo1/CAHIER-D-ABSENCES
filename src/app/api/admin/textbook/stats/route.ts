import { NextRequest, NextResponse } from "next/server";
import {
  cleanText,
  cleanUuid,
  getCurrentAcademicYearCode,
  requireTextbookManager,
} from "@/lib/textbook/context";

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

function uniq(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((v) => String(v || "").trim()).filter(Boolean)),
  );
}

function assignmentSubjectTokens(assignment: any) {
  return uniq([
    assignment.subject_id,
    assignment.institution_subject_id,
    assignment.progression?.subject_id,
    assignment.progression?.institution_subject_id,
  ]);
}

function findEffectiveTeacherId(assignment: any, classTeacherRows: any[]) {
  const explicit = String(assignment.teacher_id || "").trim();
  if (explicit) return explicit;

  const tokens = assignmentSubjectTokens(assignment);
  const matched = classTeacherRows.find((row) => {
    const teacherId = String(row.teacher_id || "").trim();
    if (!teacherId) return false;
    if (!tokens.length) return true;
    return tokens.includes(String(row.subject_id || ""));
  });

  return String(matched?.teacher_id || "").trim() || null;
}

function isActionableItem(item: any) {
  return (
    ACTIONABLE_TYPES.has(String(item.item_type || "")) ||
    Number(item.planned_duration_minutes || 0) > 0 ||
    Number(item.planned_sessions_count || 0) > 0
  );
}

function pct(done: number, total: number) {
  if (!total) return 0;
  return Math.round((done / total) * 1000) / 10;
}

export async function GET(req: NextRequest) {
  const auth = await requireTextbookManager();
  if (!auth.ok) return auth.response;
  const { srv, institutionId } = auth.ctx;

  const url = new URL(req.url);
  const academicYear =
    cleanText(url.searchParams.get("academic_year"), 30) ||
    (await getCurrentAcademicYearCode(srv, institutionId));
  const classId = cleanUuid(url.searchParams.get("class_id"));
  const subjectId = cleanUuid(url.searchParams.get("subject_id"));

  let assignmentsQuery = srv
    .from("textbook_progression_class_assignments")
    .select(
      `
      id,
      class_id,
      teacher_id,
      subject_id,
      institution_subject_id,
      is_active,
      classes:class_id(id,label,level),
      progression:textbook_progression_templates(
        id,
        title,
        academic_year,
        subject_id,
        institution_subject_id,
        subject_name,
        level,
        series
      )
    `,
    )
    .eq("institution_id", institutionId)
    .eq("is_active", true);

  if (classId) assignmentsQuery = assignmentsQuery.eq("class_id", classId);
  if (subjectId)
    assignmentsQuery = assignmentsQuery.eq("subject_id", subjectId);

  const { data: assignmentRows, error: assignmentErr } = await assignmentsQuery;
  if (assignmentErr)
    return NextResponse.json(
      { ok: false, error: assignmentErr.message },
      { status: 400 },
    );

  const assignments = ((assignmentRows || []) as any[]).filter((a) => {
    const p = a?.progression || {};
    if (academicYear && String(p.academic_year || "") !== academicYear)
      return false;
    return true;
  });

  const progressionIds = uniq(assignments.map((a) => a.progression?.id));
  const assignmentIds = assignments.map((a) => String(a.id)).filter(Boolean);
  const classIds = uniq(assignments.map((a) => a.class_id));

  const classTeachersByClass = new Map<string, any[]>();
  if (classIds.length) {
    const { data: classTeachers } = await srv
      .from("class_teachers")
      .select("class_id,teacher_id,subject_id")
      .in("class_id", classIds);

    for (const row of (classTeachers || []) as any[]) {
      const key = String(row.class_id || "");
      if (!key) continue;
      if (!classTeachersByClass.has(key)) classTeachersByClass.set(key, []);
      classTeachersByClass.get(key)!.push(row);
    }
  }

  const effectiveTeacherByAssignment = new Map<string, string | null>();
  for (const assignment of assignments) {
    const rows =
      classTeachersByClass.get(String(assignment.class_id || "")) || [];
    effectiveTeacherByAssignment.set(
      String(assignment.id),
      findEffectiveTeacherId(assignment, rows),
    );
  }

  const teacherIds = uniq(Array.from(effectiveTeacherByAssignment.values()));

  const itemsByProgression = new Map<string, any[]>();
  if (progressionIds.length) {
    const { data: items, error: itemsErr } = await srv
      .from("textbook_progression_items")
      .select(
        "id,progression_id,item_type,planned_duration_minutes,planned_sessions_count",
      )
      .eq("institution_id", institutionId)
      .in("progression_id", progressionIds);

    if (itemsErr)
      return NextResponse.json(
        { ok: false, error: itemsErr.message },
        { status: 400 },
      );
    for (const item of (items || []) as any[]) {
      const key = String(item.progression_id || "");
      if (!itemsByProgression.has(key)) itemsByProgression.set(key, []);
      itemsByProgression.get(key)!.push(item);
    }
  }

  const completedByAssignment = new Map<string, Set<string>>();
  if (assignmentIds.length) {
    const { data: completions, error: completionErr } = await srv
      .from("textbook_lesson_completions")
      .select("assignment_id,item_id,status")
      .eq("institution_id", institutionId)
      .in("assignment_id", assignmentIds)
      .eq("status", "completed");

    if (completionErr)
      return NextResponse.json(
        { ok: false, error: completionErr.message },
        { status: 400 },
      );
    for (const row of (completions || []) as any[]) {
      const key = String(row.assignment_id || "");
      if (!completedByAssignment.has(key))
        completedByAssignment.set(key, new Set());
      completedByAssignment.get(key)!.add(String(row.item_id || ""));
    }
  }

  const sessionStats = new Map<string, { count: number; minutes: number }>();
  if (assignmentIds.length) {
    const { data: sessions, error: sessionErr } = await srv
      .from("textbook_lesson_sessions")
      .select("assignment_id,duration_minutes")
      .eq("institution_id", institutionId)
      .in("assignment_id", assignmentIds);

    if (sessionErr)
      return NextResponse.json(
        { ok: false, error: sessionErr.message },
        { status: 400 },
      );
    for (const row of (sessions || []) as any[]) {
      const key = String(row.assignment_id || "");
      const prev = sessionStats.get(key) || { count: 0, minutes: 0 };
      prev.count += 1;
      prev.minutes += Number(row.duration_minutes || 0) || 0;
      sessionStats.set(key, prev);
    }
  }

  const teacherNames = new Map<string, string>();
  if (teacherIds.length) {
    const { data: profiles } = await srv
      .from("profiles")
      .select("id,display_name,full_name,first_name,last_name")
      .in("id", teacherIds);

    for (const p of (profiles || []) as any[]) {
      const name =
        String(
          p.display_name ||
            p.full_name ||
            `${p.first_name || ""} ${p.last_name || ""}` ||
            "",
        ).trim() || "Enseignant";
      teacherNames.set(String(p.id), name);
    }
  }

  const items = assignments.map((assignment) => {
    const progression = assignment.progression || {};
    const allItems = itemsByProgression.get(String(progression.id || "")) || [];
    const actionable = allItems.filter(isActionableItem);
    const expected = actionable.length;
    const done = completedByAssignment.get(String(assignment.id))?.size || 0;
    const sess = sessionStats.get(String(assignment.id)) || {
      count: 0,
      minutes: 0,
    };

    return {
      assignment_id: assignment.id,
      progression_id: progression.id,
      progression_title: progression.title,
      academic_year: progression.academic_year,
      class_id: assignment.class_id,
      class_label: assignment.classes?.label || "Classe",
      level: assignment.classes?.level || progression.level || null,
      subject_id: progression.subject_id || assignment.subject_id || null,
      subject_name: progression.subject_name || "Matière",
      teacher_id:
        effectiveTeacherByAssignment.get(String(assignment.id)) || null,
      teacher_name: effectiveTeacherByAssignment.get(String(assignment.id))
        ? teacherNames.get(
            String(effectiveTeacherByAssignment.get(String(assignment.id))),
          ) || "Enseignant"
        : "Enseignant non affecté",
      expected_items: expected,
      completed_items: done,
      completion_rate: pct(done, expected),
      sessions_count: sess.count,
      realized_minutes: sess.minutes,
      realized_hours: Math.round((sess.minutes / 60) * 10) / 10,
    };
  });

  const totals = items.reduce(
    (acc, item) => {
      acc.assignments += 1;
      acc.expected_items += item.expected_items;
      acc.completed_items += item.completed_items;
      acc.sessions_count += item.sessions_count;
      acc.realized_minutes += item.realized_minutes;
      return acc;
    },
    {
      assignments: 0,
      expected_items: 0,
      completed_items: 0,
      sessions_count: 0,
      realized_minutes: 0,
    },
  );

  return NextResponse.json({
    ok: true,
    academic_year: academicYear,
    totals: {
      ...totals,
      completion_rate: pct(totals.completed_items, totals.expected_items),
      realized_hours: Math.round((totals.realized_minutes / 60) * 10) / 10,
    },
    items,
  });
}
