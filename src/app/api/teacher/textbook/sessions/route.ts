import { NextRequest, NextResponse } from "next/server";
import {
  canManageTextbook,
  cleanText,
  cleanUuid,
  findTextbookClassDevice,
  requireTeacherTextbook,
  toPositiveInt,
} from "@/lib/textbook/context";
import {
  buildTextbookSubjectCatalog,
  findTextbookTeacherForAssignment,
  resolveTextbookAssignmentSubject,
  textbookAssignmentMatchesClassTeacherRows,
} from "@/lib/textbook/subject-matching";

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

function normalizeClientUuid(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    normalized,
  )
    ? normalized
    : null;
}

function minutesBetween(start: string | null, end: string | null) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60;
  return diff > 0 && diff <= 24 * 60 ? diff : 0;
}

function isSameSessionOperation(
  session: any,
  institutionId: string,
  assignmentId: string,
  itemId: string,
  teacherId: string,
) {
  return (
    String(session?.institution_id || "") === institutionId &&
    String(session?.assignment_id || "") === assignmentId &&
    String(session?.item_id || "") === itemId &&
    String(session?.teacher_id || "") === teacherId
  );
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
    const classDevice = await findTextbookClassDevice(
      srv,
      userId,
      institutionId,
    );
    if (
      !classDevice ||
      String(classDevice.id || "") !== String(assignment.class_id || "")
    ) {
      return {
        allowed: false,
        effectiveTeacherId: null,
        subject: null,
        error: "forbidden_not_class_device",
      };
    }

    const { data: rows } = await srv
      .from("class_teachers")
      .select("class_id,teacher_id,subject_id")
      .eq("institution_id", institutionId)
      .eq("class_id", assignment.class_id)
      .is("end_date", null);

    const subjectCatalog = await buildTextbookSubjectCatalog(
      srv,
      institutionId,
      [
        assignment?.subject_id,
        assignment?.institution_subject_id,
        assignment?.progression?.subject_id,
        assignment?.progression?.institution_subject_id,
        ...((rows || []) as any[]).map((row) => row?.subject_id),
      ],
    );
    const subject = resolveTextbookAssignmentSubject(
      assignment,
      subjectCatalog,
    );
    const effectiveTeacherId = findTextbookTeacherForAssignment(
      assignment,
      rows || [],
      subjectCatalog,
    );

    if (!subject || !effectiveTeacherId) {
      return {
        allowed: false,
        effectiveTeacherId: null,
        subject,
        error: !subject
          ? "subject_not_resolved_for_assignment"
          : "teacher_not_found_for_class_subject",
      };
    }

    return { allowed: true, effectiveTeacherId, subject, error: null };
  }

  if (canManageTextbook(roles)) {
    const subjectCatalog = await buildTextbookSubjectCatalog(
      srv,
      institutionId,
      [
        assignment?.subject_id,
        assignment?.institution_subject_id,
        assignment?.progression?.subject_id,
        assignment?.progression?.institution_subject_id,
      ],
    );
    return {
      allowed: true,
      effectiveTeacherId: String(assignment.teacher_id || userId),
      subject: resolveTextbookAssignmentSubject(assignment, subjectCatalog),
      error: null,
    };
  }

  if (String(assignment.teacher_id || "") === userId) {
    const subjectCatalog = await buildTextbookSubjectCatalog(
      srv,
      institutionId,
      [
        assignment?.subject_id,
        assignment?.institution_subject_id,
        assignment?.progression?.subject_id,
        assignment?.progression?.institution_subject_id,
      ],
    );
    return {
      allowed: true,
      effectiveTeacherId: userId,
      subject: resolveTextbookAssignmentSubject(assignment, subjectCatalog),
      error: null,
    };
  }

  const { data: rows } = await srv
    .from("class_teachers")
    .select("class_id,teacher_id,subject_id")
    .eq("institution_id", institutionId)
    .eq("teacher_id", userId)
    .eq("class_id", assignment.class_id)
    .is("end_date", null);

  const subjectCatalog = await buildTextbookSubjectCatalog(srv, institutionId, [
    assignment?.subject_id,
    assignment?.institution_subject_id,
    assignment?.progression?.subject_id,
    assignment?.progression?.institution_subject_id,
    ...((rows || []) as any[]).map((row) => row?.subject_id),
  ]);
  const subject = resolveTextbookAssignmentSubject(assignment, subjectCatalog);

  if (
    subject &&
    textbookAssignmentMatchesClassTeacherRows(
      assignment,
      rows || [],
      subjectCatalog,
    )
  ) {
    return { allowed: true, effectiveTeacherId: userId, subject, error: null };
  }

  return {
    allowed: false,
    effectiveTeacherId: null,
    subject,
    error: subject ? "forbidden" : "subject_not_resolved_for_assignment",
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireTeacherTextbook();
  if (!auth.ok) return auth.response;
  const { srv, institutionId, userId, roles } = auth.ctx;

  const body = await req.json().catch(() => ({}));
  const assignmentId = cleanUuid(body.assignment_id);
  const itemId = cleanUuid(body.item_id);
  const rawClientSessionId = String(body.client_session_id || "").trim();
  const clientSessionId = normalizeClientUuid(rawClientSessionId);

  if (!assignmentId || !itemId) {
    return NextResponse.json(
      { ok: false, error: "assignment_and_item_required" },
      { status: 400 },
    );
  }
  if (rawClientSessionId && !clientSessionId) {
    return NextResponse.json(
      { ok: false, error: "bad_client_session_id" },
      { status: 400 },
    );
  }

  const { data: assignment, error: assignmentErr } = await srv
    .from("textbook_progression_class_assignments")
    .select(
      "*,progression:textbook_progression_templates(id,subject_id,institution_subject_id,subject_name)",
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
  const resolvedSubject = access.subject;

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

  if (clientSessionId) {
    const { data: existingSession, error: existingSessionErr } = await srv
      .from("textbook_lesson_sessions")
      .select("*")
      .eq("id", clientSessionId)
      .maybeSingle();

    if (existingSessionErr) {
      return NextResponse.json(
        { ok: false, error: existingSessionErr.message },
        { status: 400 },
      );
    }
    if (existingSession) {
      if (
        !isSameSessionOperation(
          existingSession,
          institutionId,
          assignmentId,
          itemId,
          effectiveTeacherId,
        )
      ) {
        return NextResponse.json(
          { ok: false, error: "client_session_id_conflict" },
          { status: 409 },
        );
      }
      return NextResponse.json({ ok: true, item: existingSession, idempotent: true });
    }
  }

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
      ...(clientSessionId ? { id: clientSessionId } : {}),
      institution_id: institutionId,
      assignment_id: assignmentId,
      progression_id: (assignment as any).progression_id,
      item_id: itemId,
      class_id: (assignment as any).class_id,
      subject_id:
        (assignment as any).subject_id ||
        (assignment as any).progression?.subject_id ||
        resolvedSubject?.globalSubjectId ||
        null,
      institution_subject_id:
        (assignment as any).institution_subject_id ||
        (assignment as any).progression?.institution_subject_id ||
        resolvedSubject?.institutionSubjectId ||
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

  if (error && clientSessionId && String((error as any)?.code || "") === "23505") {
    const { data: concurrentSession } = await srv
      .from("textbook_lesson_sessions")
      .select("*")
      .eq("id", clientSessionId)
      .maybeSingle();
    if (
      concurrentSession &&
      isSameSessionOperation(
        concurrentSession,
        institutionId,
        assignmentId,
        itemId,
        effectiveTeacherId,
      )
    ) {
      return NextResponse.json({
        ok: true,
        item: concurrentSession,
        idempotent: true,
      });
    }
    return NextResponse.json(
      { ok: false, error: "client_session_id_conflict" },
      { status: 409 },
    );
  }

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
          resolvedSubject?.globalSubjectId ||
          null,
        institution_subject_id:
          (assignment as any).institution_subject_id ||
          (assignment as any).progression?.institution_subject_id ||
          resolvedSubject?.institutionSubjectId ||
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
