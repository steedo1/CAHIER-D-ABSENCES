import { NextRequest, NextResponse } from "next/server";
import {
  canManageTextbook,
  cleanText,
  cleanUuid,
  requireTeacherTextbook,
} from "@/lib/textbook/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_STATUS = new Set(["not_started", "in_progress", "completed", "reopened"]);

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
  const status = cleanText(body.status, 40) || "completed";

  if (!assignmentId || !itemId) {
    return NextResponse.json({ ok: false, error: "assignment_and_item_required" }, { status: 400 });
  }
  if (!ALLOWED_STATUS.has(status)) {
    return NextResponse.json({ ok: false, error: "bad_status" }, { status: 400 });
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
    .select("id")
    .eq("id", itemId)
    .eq("progression_id", (assignment as any).progression_id)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (itemErr) return NextResponse.json({ ok: false, error: itemErr.message }, { status: 400 });
  if (!item) return NextResponse.json({ ok: false, error: "item_not_found" }, { status: 404 });

  const completedAt = status === "completed" ? new Date().toISOString() : null;

  const payload = {
    institution_id: institutionId,
    assignment_id: assignmentId,
    progression_id: (assignment as any).progression_id,
    item_id: itemId,
    class_id: (assignment as any).class_id,
    subject_id: (assignment as any).subject_id || (assignment as any).progression?.subject_id || null,
    institution_subject_id:
      (assignment as any).institution_subject_id || (assignment as any).progression?.institution_subject_id || null,
    teacher_id: userId,
    status,
    completed_at: completedAt,
    completed_by: status === "completed" ? userId : null,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await srv
    .from("textbook_lesson_completions")
    .upsert(payload, { onConflict: "assignment_id,item_id" })
    .select("*")
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  await srv.from("textbook_lesson_status_logs").insert({
    institution_id: institutionId,
    assignment_id: assignmentId,
    progression_id: (assignment as any).progression_id,
    item_id: itemId,
    class_id: (assignment as any).class_id,
    teacher_id: userId,
    status,
    note: cleanText(body.note, 1000) || null,
    created_by: userId,
  });

  return NextResponse.json({ ok: true, item: data });
}
