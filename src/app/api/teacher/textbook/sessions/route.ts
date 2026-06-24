import { NextRequest, NextResponse } from "next/server";
import {
  canManageTextbook,
  cleanText,
  cleanUuid,
  requireTeacherTextbook,
  toPositiveInt,
} from "@/lib/textbook/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((v) => String(v || "").trim()).filter(Boolean)));
}

async function canAccessAssignment(srv: any, userId: string, roles: Set<any>, assignment: any) {
  if (canManageTextbook(roles)) return true;
  if (String(assignment.teacher_id || "") === userId) return true;

  const { data: rows } = await srv
    .from("class_teachers")
    .select("class_id,subject_id")
    .eq("teacher_id", userId)
    .eq("class_id", assignment.class_id);

  const tokens = uniq([
    assignment.subject_id,
    assignment.institution_subject_id,
    assignment.progression?.subject_id,
    assignment.progression?.institution_subject_id,
  ]);

  if (!tokens.length) return Array.isArray(rows) && rows.length > 0;
  return ((rows || []) as any[]).some((row) => tokens.includes(String(row.subject_id || "")));
}

export async function POST(req: NextRequest) {
  const auth = await requireTeacherTextbook();
  if (!auth.ok) return auth.response;
  const { srv, institutionId, userId, roles } = auth.ctx;

  const body = await req.json().catch(() => ({}));
  const assignmentId = cleanUuid(body.assignment_id);
  const itemId = cleanUuid(body.item_id);

  if (!assignmentId || !itemId) {
    return NextResponse.json({ ok: false, error: "assignment_and_item_required" }, { status: 400 });
  }

  const { data: assignment, error: assignmentErr } = await srv
    .from("textbook_progression_class_assignments")
    .select("*,progression:textbook_progression_templates(id,subject_id,institution_subject_id)")
    .eq("id", assignmentId)
    .eq("institution_id", institutionId)
    .eq("is_active", true)
    .maybeSingle();

  if (assignmentErr) return NextResponse.json({ ok: false, error: assignmentErr.message }, { status: 400 });
  if (!assignment) return NextResponse.json({ ok: false, error: "assignment_not_found" }, { status: 404 });

  const allowed = await canAccessAssignment(srv, userId, roles, assignment);
  if (!allowed) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const { data: item, error: itemErr } = await srv
    .from("textbook_progression_items")
    .select("id,progression_id,title,item_type")
    .eq("id", itemId)
    .eq("progression_id", (assignment as any).progression_id)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (itemErr) return NextResponse.json({ ok: false, error: itemErr.message }, { status: 400 });
  if (!item) return NextResponse.json({ ok: false, error: "item_not_found" }, { status: 404 });

  const { count } = await srv
    .from("textbook_lesson_sessions")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId)
    .eq("item_id", itemId)
    .eq("teacher_id", userId);

  const sessionTitle = cleanText(body.session_title, 160) || `Séance ${(count || 0) + 1}`;
  const durationMinutes = toPositiveInt(body.duration_minutes, 55) || 55;
  const sessionDate = cleanText(body.session_date, 20) || todayIso();

  const { data, error } = await srv
    .from("textbook_lesson_sessions")
    .insert({
      institution_id: institutionId,
      assignment_id: assignmentId,
      progression_id: (assignment as any).progression_id,
      item_id: itemId,
      class_id: (assignment as any).class_id,
      subject_id: (assignment as any).subject_id || (assignment as any).progression?.subject_id || null,
      institution_subject_id:
        (assignment as any).institution_subject_id || (assignment as any).progression?.institution_subject_id || null,
      teacher_id: userId,
      session_title: sessionTitle,
      session_date: sessionDate,
      duration_minutes: durationMinutes,
      content: cleanText(body.content, 4000) || null,
      homework: cleanText(body.homework, 2000) || null,
      observations: cleanText(body.observations, 2000) || null,
      created_by: userId,
      updated_by: userId,
    })
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  const { data: existingCompletion } = await srv
    .from("textbook_lesson_completions")
    .select("id,status")
    .eq("assignment_id", assignmentId)
    .eq("item_id", itemId)
    .maybeSingle();

  if (!(existingCompletion as any)?.id || (existingCompletion as any)?.status !== "completed") {
    await srv.from("textbook_lesson_completions").upsert(
      {
        institution_id: institutionId,
        assignment_id: assignmentId,
        progression_id: (assignment as any).progression_id,
        item_id: itemId,
        class_id: (assignment as any).class_id,
        subject_id: (assignment as any).subject_id || (assignment as any).progression?.subject_id || null,
        institution_subject_id:
          (assignment as any).institution_subject_id || (assignment as any).progression?.institution_subject_id || null,
        teacher_id: userId,
        status: "in_progress",
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "assignment_id,item_id" }
    );
  }

  return NextResponse.json({ ok: true, item: data }, { status: 201 });
}
