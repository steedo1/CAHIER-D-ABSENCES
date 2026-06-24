import { NextResponse } from "next/server";
import { canManageTextbook, requireTeacherTextbook } from "@/lib/textbook/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((v) => String(v || "").trim()).filter(Boolean)));
}

function subjectMatches(assignment: any, classTeacherRows: any[]) {
  if (!classTeacherRows.length) return false;

  const assignmentTokens = uniq([
    assignment.subject_id,
    assignment.institution_subject_id,
    assignment.progression?.subject_id,
    assignment.progression?.institution_subject_id,
  ]);

  if (!assignmentTokens.length) return true;

  return classTeacherRows.some((row) => {
    const token = String(row.subject_id || "").trim();
    return token && assignmentTokens.includes(token);
  });
}

async function decorateDocuments(srv: any, assignments: any[]) {
  for (const assignment of assignments) {
    const document = assignment?.progression?.document || null;
    if (!document?.storage_bucket || !document?.storage_path) {
      if (assignment?.progression) assignment.progression.document = document ? { ...document, signed_url: null } : null;
      continue;
    }

    const { data } = await srv.storage
      .from(String(document.storage_bucket))
      .createSignedUrl(String(document.storage_path), 60 * 60);

    assignment.progression.document = {
      ...document,
      signed_url: data?.signedUrl || null,
    };
  }

  return assignments;
}

export async function GET() {
  const auth = await requireTeacherTextbook();
  if (!auth.ok) return auth.response;
  const { srv, userId, institutionId, roles } = auth.ctx;
  const privileged = canManageTextbook(roles);

  const { data: classTeachers } = await srv
    .from("class_teachers")
    .select("class_id,subject_id")
    .eq("teacher_id", userId);

  const classRowsByClass = new Map<string, any[]>();
  for (const row of (classTeachers || []) as any[]) {
    const key = String(row.class_id || "");
    if (!key) continue;
    if (!classRowsByClass.has(key)) classRowsByClass.set(key, []);
    classRowsByClass.get(key)!.push(row);
  }

  let query = srv
    .from("textbook_progression_class_assignments")
    .select(
      `
      id,
      institution_id,
      progression_id,
      class_id,
      teacher_id,
      subject_id,
      institution_subject_id,
      is_active,
      classes:class_id(id,label,level,academic_year),
      progression:textbook_progression_templates(
        id,
        academic_year,
        subject_id,
        institution_subject_id,
        subject_name,
        level,
        series,
        title,
        description,
        status,
        document:textbook_progression_documents(
          id,
          original_name,
          storage_bucket,
          storage_path,
          mime_type,
          size_bytes
        )
      )
    `
    )
    .eq("institution_id", institutionId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  const { data: assignmentRows, error: assignmentErr } = await query;
  if (assignmentErr) return NextResponse.json({ ok: false, error: assignmentErr.message }, { status: 400 });

  let assignments = ((assignmentRows || []) as any[]).filter((assignment) => {
    if (!assignment?.progression || assignment.progression.status !== "active") return false;
    if (privileged) return true;
    if (String(assignment.teacher_id || "") === userId) return true;

    const rows = classRowsByClass.get(String(assignment.class_id || "")) || [];
    return subjectMatches(assignment, rows);
  });

  assignments = await decorateDocuments(srv, assignments);

  const progressionIds = uniq(assignments.map((a) => a.progression_id));
  const assignmentIds = uniq(assignments.map((a) => a.id));

  const itemsByProgression = new Map<string, any[]>();
  if (progressionIds.length) {
    const { data: items, error: itemsErr } = await srv
      .from("textbook_progression_items")
      .select("*")
      .eq("institution_id", institutionId)
      .in("progression_id", progressionIds)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (itemsErr) return NextResponse.json({ ok: false, error: itemsErr.message }, { status: 400 });
    for (const item of (items || []) as any[]) {
      const key = String(item.progression_id || "");
      if (!itemsByProgression.has(key)) itemsByProgression.set(key, []);
      itemsByProgression.get(key)!.push(item);
    }
  }

  const sessionsByAssignmentItem = new Map<string, any[]>();
  if (assignmentIds.length) {
    const { data: sessions, error: sessionsErr } = await srv
      .from("textbook_lesson_sessions")
      .select("*")
      .eq("institution_id", institutionId)
      .in("assignment_id", assignmentIds)
      .eq("teacher_id", userId)
      .order("session_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (sessionsErr) return NextResponse.json({ ok: false, error: sessionsErr.message }, { status: 400 });
    for (const session of (sessions || []) as any[]) {
      const key = `${session.assignment_id}|${session.item_id}`;
      if (!sessionsByAssignmentItem.has(key)) sessionsByAssignmentItem.set(key, []);
      sessionsByAssignmentItem.get(key)!.push(session);
    }
  }

  const completionsByAssignmentItem = new Map<string, any>();
  if (assignmentIds.length) {
    const { data: completions, error: completionsErr } = await srv
      .from("textbook_lesson_completions")
      .select("*")
      .eq("institution_id", institutionId)
      .in("assignment_id", assignmentIds);

    if (completionsErr) return NextResponse.json({ ok: false, error: completionsErr.message }, { status: 400 });
    for (const completion of (completions || []) as any[]) {
      completionsByAssignmentItem.set(`${completion.assignment_id}|${completion.item_id}`, completion);
    }
  }

  const items = assignments.map((assignment) => {
    const progressionItems = itemsByProgression.get(String(assignment.progression_id)) || [];
    return {
      ...assignment,
      progression_items: progressionItems.map((item) => ({
        ...item,
        sessions: sessionsByAssignmentItem.get(`${assignment.id}|${item.id}`) || [],
        completion: completionsByAssignmentItem.get(`${assignment.id}|${item.id}`) || null,
      })),
    };
  });

  return NextResponse.json({ ok: true, items });
}
