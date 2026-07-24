import { NextRequest, NextResponse } from "next/server";
import {
  cleanText,
  cleanUuid,
  getCurrentAcademicYearCode,
  requireTextbookManager,
} from "@/lib/textbook/context";
import {
  buildTextbookSubjectCatalog,
  findTextbookTeacherForAssignment,
  resolveTextbookAssignmentSubject,
} from "@/lib/textbook/subject-matching";
import { decorateTextbookClassEducation } from "@/lib/textbook/education-context";

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

function plannedMinutes(item: any) {
  const duration = Number(item?.planned_duration_minutes || 0);
  if (duration > 0) return duration;
  const sessions = Number(item?.planned_sessions_count || 0);
  if (sessions > 0) return sessions * 55;
  return 0;
}

export async function GET(req: NextRequest) {
  const auth = await requireTextbookManager();
  if (!auth.ok) return auth.response;
  const { srv, institutionId } = auth.ctx;

  const { data: institution } = await srv
    .from("institutions")
    .select("settings_json")
    .eq("id", institutionId)
    .maybeSingle();
  const educationSettings = (institution as any)?.settings_json || null;

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
      classes:class_id(id,label,level,academic_year,institution_id,education_type,formation_code,formation_level_code),
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
      .eq("institution_id", institutionId)
      .in("class_id", classIds)
      .is("end_date", null);

    for (const row of (classTeachers || []) as any[]) {
      const key = String(row.class_id || "");
      if (!key) continue;
      if (!classTeachersByClass.has(key)) classTeachersByClass.set(key, []);
      classTeachersByClass.get(key)!.push(row);
    }
  }

  let subjectCatalog;
  try {
    subjectCatalog = await buildTextbookSubjectCatalog(srv, institutionId, [
      ...assignments.flatMap((assignment) => [
        assignment?.subject_id,
        assignment?.institution_subject_id,
        assignment?.progression?.subject_id,
        assignment?.progression?.institution_subject_id,
      ]),
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
    const rows =
      classTeachersByClass.get(String(assignment.class_id || "")) || [];
    effectiveTeacherByAssignment.set(
      String(assignment.id),
      findTextbookTeacherForAssignment(assignment, rows, subjectCatalog),
    );
    resolvedSubjectByAssignment.set(
      String(assignment.id),
      resolveTextbookAssignmentSubject(assignment, subjectCatalog),
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
    const classContext = decorateTextbookClassEducation(
      assignment.classes,
      educationSettings,
    );
    const allItems = itemsByProgression.get(String(progression.id || "")) || [];
    const actionable = allItems.filter(isActionableItem);
    const expected = actionable.length;
    const completedSet =
      completedByAssignment.get(String(assignment.id)) || new Set<string>();
    const done = completedSet.size;
    const planned_minutes = actionable.reduce(
      (sum, item) => sum + plannedMinutes(item),
      0,
    );
    const completed_planned_minutes = actionable.reduce(
      (sum, item) =>
        completedSet.has(String(item.id || ""))
          ? sum + plannedMinutes(item)
          : sum,
      0,
    );
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
      class_label: classContext?.label || "Classe",
      level: classContext?.level || progression.level || null,
      education_type: classContext?.education_type || "general_secondary",
      education_label: classContext?.education_label || "Secondaire général",
      formation_code: classContext?.formation_code || null,
      formation_label: classContext?.formation_label || null,
      formation_level_code: classContext?.formation_level_code || null,
      formation_level_label: classContext?.formation_level_label || null,
      education_context_label:
        classContext?.education_context_label || "Secondaire général",
      subject_id:
        progression.subject_id ||
        assignment.subject_id ||
        resolvedSubjectByAssignment.get(String(assignment.id))
          ?.globalSubjectId ||
        null,
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
      planned_minutes,
      planned_hours: Math.round((planned_minutes / 60) * 10) / 10,
      completed_planned_minutes,
      completed_planned_hours:
        Math.round((completed_planned_minutes / 60) * 10) / 10,
      completion_rate: planned_minutes
        ? pct(completed_planned_minutes, planned_minutes)
        : pct(done, expected),
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
      acc.planned_minutes += item.planned_minutes || 0;
      acc.completed_planned_minutes += item.completed_planned_minutes || 0;
      return acc;
    },
    {
      assignments: 0,
      expected_items: 0,
      completed_items: 0,
      sessions_count: 0,
      realized_minutes: 0,
      planned_minutes: 0,
      completed_planned_minutes: 0,
    },
  );

  return NextResponse.json({
    ok: true,
    academic_year: academicYear,
    totals: {
      ...totals,
      completion_rate: totals.planned_minutes
        ? pct(totals.completed_planned_minutes, totals.planned_minutes)
        : pct(totals.completed_items, totals.expected_items),
      planned_hours: Math.round((totals.planned_minutes / 60) * 10) / 10,
      completed_planned_hours:
        Math.round((totals.completed_planned_minutes / 60) * 10) / 10,
      realized_hours: Math.round((totals.realized_minutes / 60) * 10) / 10,
    },
    items,
  });
}
