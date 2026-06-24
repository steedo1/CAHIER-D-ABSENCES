import { NextRequest, NextResponse } from "next/server";
import {
  canManageTextbook,
  cleanText,
  cleanUuid,
  findTextbookClassDevice,
  requireTeacherTextbook,
  toPositiveInt,
} from "@/lib/textbook/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeHm(value: unknown) {
  const m = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = Math.max(0, Math.min(23, Number(m[1]) || 0));
  const mm = Math.max(0, Math.min(59, Number(m[2]) || 0));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function minutesBetween(start: string | null, end: string | null) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60;
  return diff > 0 && diff <= 24 * 60 ? diff : 0;
}

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

function subjectMatches(assignment: any, rows: any[]) {
  const tokens = assignmentSubjectTokens(assignment);
  if (!tokens.length) return Array.isArray(rows) && rows.length > 0;
  return ((rows || []) as any[]).some((row) =>
    tokens.includes(String(row.subject_id || "")),
  );
}


async function findTeacherForClassSubject(srv: any, assignment: any) {
  const { data: rows } = await srv
    .from("class_teachers")
    .select("teacher_id,subject_id")
    .eq("class_id", assignment.class_id);

  const explicit = String(assignment.teacher_id || "").trim();
  if (explicit) return explicit;

  const tokens = assignmentSubjectTokens(assignment);
  const matched = ((rows || []) as any[]).find((row) => {
    const teacherId = String(row.teacher_id || "").trim();
    if (!teacherId) return false;
    if (!tokens.length) return true;
    return tokens.includes(String(row.subject_id || ""));
  });

  return String(matched?.teacher_id || "").trim() || null;
}

async function resolveAssignmentAccess(
  srv: any,
  userId: string,
  institutionId: string,
  roles: Set<any>,
  assignment: any,
) {
  const isClassDevice = roles.has("class_device");

  if (isClassDevice) {
    const classDevice = await findTextbookClassDevice(srv, userId, institutionId);
    if (
      !classDevice ||
      String(classDevice.id || "") !== String(assignment.class_id || "")
    ) {
      return {
        allowed: false,
        effectiveTeacherId: null,
        error: "forbidden_not_class_device",
      };
    }

    const effectiveTeacherId = await findTeacherForClassSubject(
      srv,
      assignment,
    );
    if (!effectiveTeacherId) {
      return {
        allowed: false,
        effectiveTeacherId: null,
        error: "teacher_not_found_for_class_subject",
      };
    }

    return { allowed: true, effectiveTeacherId, error: null };
  }

  if (canManageTextbook(roles)) {
    return {
      allowed: true,
      effectiveTeacherId: String(assignment.teacher_id || userId),
      error: null,
    };
  }

  if (String(assignment.teacher_id || "") === userId) {
    return { allowed: true, effectiveTeacherId: userId, error: null };
  }

  const { data: rows } = await srv
    .from("class_teachers")
    .select("class_id,subject_id")
    .eq("teacher_id", userId)
    .eq("class_id", assignment.class_id);

  if (subjectMatches(assignment, rows || [])) {
    return { allowed: true, effectiveTeacherId: userId, error: null };
  }

  return { allowed: false, effectiveTeacherId: null, error: "forbidden" };
}

export async function POST(req: NextRequest) {
  const auth = await requireTeacherTextbook();
  if (!auth.ok) return auth.response;
  const { srv, institutionId, userId, roles } = auth.ctx;

  const body = await req.json().catch(() => ({}));
  const assignmentId = cleanUuid(body.assignment_id);
  const itemId = cleanUuid(body.item_id);

  if (!assignmentId || !itemId) {
    return NextResponse.json(
      { ok: false, error: "assignment_and_item_required" },
      { status: 400 },
    );
  }

  const { data: assignment, error: assignmentErr } = await srv
    .from("textbook_progression_class_assignments")
    .select(
      "*,progression:textbook_progression_templates(id,subject_id,institution_subject_id)",
    )
    .eq("id", assignmentId)
    .eq("institution_id", institutionId)
    .eq("is_active", true)
    .maybeSingle();

  if (assignmentErr)
    return NextResponse.json(
      { ok: false, error: assignmentErr.message },
      { status: 400 },
    );
  if (!assignment)
    return NextResponse.json(
      { ok: false, error: "assignment_not_found" },
      { status: 404 },
    );

  const access = await resolveAssignmentAccess(
    srv,
    userId,
    institutionId,
    roles,
    assignment,
  );
  if (!access.allowed) {
    return NextResponse.json(
      { ok: false, error: access.error || "forbidden" },
      {
        status:
          access.error === "teacher_not_found_for_class_subject" ? 400 : 403,
      },
    );
  }

  const effectiveTeacherId = access.effectiveTeacherId as string;

  const { data: item, error: itemErr } = await srv
    .from("textbook_progression_items")
    .select("id,progression_id,title,item_type")
    .eq("id", itemId)
    .eq("progression_id", (assignment as any).progression_id)
    .eq("institution_id", institutionId)
    .maybeSingle();

  if (itemErr)
    return NextResponse.json(
      { ok: false, error: itemErr.message },
      { status: 400 },
    );
  if (!item)
    return NextResponse.json(
      { ok: false, error: "item_not_found" },
      { status: 404 },
    );

  const { count } = await srv
    .from("textbook_lesson_sessions")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId)
    .eq("item_id", itemId)
    .eq("teacher_id", effectiveTeacherId);

  const sessionTitle =
    cleanText(body.session_title, 160) || `Séance ${(count || 0) + 1}`;
  const sessionDate = cleanText(body.session_date, 20) || todayIso();
  const sessionStartTime = normalizeHm(body.session_start_time);
  const sessionEndTime = normalizeHm(body.session_end_time);
  const durationFromRange = minutesBetween(sessionStartTime, sessionEndTime);
  const durationMinutes =
    durationFromRange || toPositiveInt(body.duration_minutes, 55) || 55;
  const sessionPeriodId = cleanUuid(body.session_period_id);
  const sessionPeriodLabel = cleanText(body.session_period_label, 120) || null;

  const { data, error } = await srv
    .from("textbook_lesson_sessions")
    .insert({
      institution_id: institutionId,
      assignment_id: assignmentId,
      progression_id: (assignment as any).progression_id,
      item_id: itemId,
      class_id: (assignment as any).class_id,
      subject_id:
        (assignment as any).subject_id ||
        (assignment as any).progression?.subject_id ||
        null,
      institution_subject_id:
        (assignment as any).institution_subject_id ||
        (assignment as any).progression?.institution_subject_id ||
        null,
      teacher_id: effectiveTeacherId,
      session_title: sessionTitle,
      session_date: sessionDate,
      session_period_id: sessionPeriodId || null,
      session_period_label: sessionPeriodLabel,
      session_start_time: sessionStartTime,
      session_end_time: sessionEndTime,
      duration_minutes: durationMinutes,
      content: cleanText(body.content, 4000) || null,
      homework: cleanText(body.homework, 2000) || null,
      observations: cleanText(body.observations, 2000) || null,
      created_by: userId,
      updated_by: userId,
    })
    .select("*")
    .maybeSingle();

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );

  const { data: existingCompletion } = await srv
    .from("textbook_lesson_completions")
    .select("id,status")
    .eq("assignment_id", assignmentId)
    .eq("item_id", itemId)
    .maybeSingle();

  if (
    !(existingCompletion as any)?.id ||
    (existingCompletion as any)?.status !== "completed"
  ) {
    await srv.from("textbook_lesson_completions").upsert(
      {
        institution_id: institutionId,
        assignment_id: assignmentId,
        progression_id: (assignment as any).progression_id,
        item_id: itemId,
        class_id: (assignment as any).class_id,
        subject_id:
          (assignment as any).subject_id ||
          (assignment as any).progression?.subject_id ||
          null,
        institution_subject_id:
          (assignment as any).institution_subject_id ||
          (assignment as any).progression?.institution_subject_id ||
          null,
        teacher_id: effectiveTeacherId,
        status: "in_progress",
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "assignment_id,item_id" },
    );
  }

  return NextResponse.json({ ok: true, item: data }, { status: 201 });
}
