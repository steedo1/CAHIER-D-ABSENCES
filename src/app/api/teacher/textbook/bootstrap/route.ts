import { NextResponse } from "next/server";
import {
  canManageTextbook,
  requireTeacherTextbook,
} from "@/lib/textbook/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function subjectMatches(assignment: any, classTeacherRows: any[]) {
  if (!classTeacherRows.length) return false;

  const assignmentTokens = assignmentSubjectTokens(assignment);
  if (!assignmentTokens.length) return true;

  return classTeacherRows.some((row) => {
    const token = String(row.subject_id || "").trim();
    return token && assignmentTokens.includes(token);
  });
}

function findEffectiveTeacherId(assignment: any, classTeacherRows: any[]) {
  const explicit = String(assignment.teacher_id || "").trim();
  if (explicit) return explicit;

  const assignmentTokens = assignmentSubjectTokens(assignment);
  const matched = classTeacherRows.find((row) => {
    const teacherId = String(row.teacher_id || "").trim();
    if (!teacherId) return false;
    if (!assignmentTokens.length) return true;
    const subjectId = String(row.subject_id || "").trim();
    return subjectId && assignmentTokens.includes(subjectId);
  });

  return String(matched?.teacher_id || "").trim() || null;
}

async function getAuthPhone(srv: any, userId: string) {
  const fromSchema = await srv
    .schema("auth")
    .from("users")
    .select("phone")
    .eq("id", userId)
    .maybeSingle();

  if (!fromSchema.error && fromSchema.data?.phone) {
    return String(fromSchema.data.phone || "").trim();
  }

  const fromQualified = await srv
    .from("auth.users")
    .select("phone")
    .eq("id", userId)
    .maybeSingle();

  return String(fromQualified.data?.phone || "").trim();
}

async function getClassDevice(srv: any, userId: string, institutionId: string) {
  const phone = await getAuthPhone(srv, userId);
  if (!phone) return null;

  const { data } = await srv
    .from("classes")
    .select("id,label,level,institution_id,class_phone_e164")
    .eq("institution_id", institutionId)
    .eq("class_phone_e164", phone)
    .maybeSingle();

  return data || null;
}

async function decorateDocuments(srv: any, assignments: any[]) {
  for (const assignment of assignments) {
    const document = assignment?.progression?.document || null;
    if (!document?.storage_bucket || !document?.storage_path) {
      if (assignment?.progression)
        assignment.progression.document = document
          ? { ...document, signed_url: null }
          : null;
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
  const isClassDevice = roles.has("class_device");
  const privileged = canManageTextbook(roles) && !isClassDevice;

  const classDevice = isClassDevice
    ? await getClassDevice(srv, userId, institutionId)
    : null;
  if (isClassDevice && !classDevice) {
    return NextResponse.json(
      { ok: false, error: "forbidden_not_class_device" },
      { status: 403 },
    );
  }

  let classTeachersQuery = srv
    .from("class_teachers")
    .select("class_id,teacher_id,subject_id");
  if (isClassDevice) {
    classTeachersQuery = classTeachersQuery.eq("class_id", classDevice.id);
  } else {
    classTeachersQuery = classTeachersQuery.eq("teacher_id", userId);
  }

  const { data: classTeachers } = await classTeachersQuery;

  const classRowsByClass = new Map<string, any[]>();
  for (const row of (classTeachers || []) as any[]) {
    const key = String(row.class_id || "");
    if (!key) continue;
    if (!classRowsByClass.has(key)) classRowsByClass.set(key, []);
    classRowsByClass.get(key)!.push(row);
  }

  const { data: assignmentRows, error: assignmentErr } = await srv
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
    `,
    )
    .eq("institution_id", institutionId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (assignmentErr)
    return NextResponse.json(
      { ok: false, error: assignmentErr.message },
      { status: 400 },
    );

  let assignments = ((assignmentRows || []) as any[]).filter((assignment) => {
    if (!assignment?.progression || assignment.progression.status !== "active")
      return false;

    if (isClassDevice) {
      return String(assignment.class_id || "") === String(classDevice.id || "");
    }

    if (privileged) return true;
    if (String(assignment.teacher_id || "") === userId) return true;

    const rows = classRowsByClass.get(String(assignment.class_id || "")) || [];
    return subjectMatches(assignment, rows);
  });

  assignments = await decorateDocuments(srv, assignments);

  const teacherIds = uniq([
    ...assignments.map((a) => a.teacher_id),
    ...((classTeachers || []) as any[]).map((row) => row.teacher_id),
  ]);

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

  const assignmentsWithTeacher = assignments.map((assignment) => {
    const rows = classRowsByClass.get(String(assignment.class_id || "")) || [];
    const effectiveTeacherId = findEffectiveTeacherId(assignment, rows);
    return {
      ...assignment,
      effective_teacher_id: effectiveTeacherId,
      effective_teacher_name: effectiveTeacherId
        ? teacherNames.get(effectiveTeacherId) || "Enseignant"
        : null,
    };
  });

  const progressionIds = uniq(
    assignmentsWithTeacher.map((a) => a.progression_id),
  );
  const assignmentIds = uniq(assignmentsWithTeacher.map((a) => a.id));

  const itemsByProgression = new Map<string, any[]>();
  if (progressionIds.length) {
    const { data: items, error: itemsErr } = await srv
      .from("textbook_progression_items")
      .select("*")
      .eq("institution_id", institutionId)
      .in("progression_id", progressionIds)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

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

  const sessionsByAssignmentItem = new Map<string, any[]>();
  if (assignmentIds.length) {
    let sessionsQuery = srv
      .from("textbook_lesson_sessions")
      .select("*")
      .eq("institution_id", institutionId)
      .in("assignment_id", assignmentIds)
      .order("session_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (!isClassDevice) sessionsQuery = sessionsQuery.eq("teacher_id", userId);

    const { data: sessions, error: sessionsErr } = await sessionsQuery;

    if (sessionsErr)
      return NextResponse.json(
        { ok: false, error: sessionsErr.message },
        { status: 400 },
      );
    for (const session of (sessions || []) as any[]) {
      const key = `${session.assignment_id}|${session.item_id}`;
      if (!sessionsByAssignmentItem.has(key))
        sessionsByAssignmentItem.set(key, []);
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

    if (completionsErr)
      return NextResponse.json(
        { ok: false, error: completionsErr.message },
        { status: 400 },
      );
    for (const completion of (completions || []) as any[]) {
      completionsByAssignmentItem.set(
        `${completion.assignment_id}|${completion.item_id}`,
        completion,
      );
    }
  }

  const items = assignmentsWithTeacher.map((assignment) => {
    const progressionItems =
      itemsByProgression.get(String(assignment.progression_id)) || [];
    return {
      ...assignment,
      progression_items: progressionItems.map((item) => ({
        ...item,
        sessions:
          sessionsByAssignmentItem.get(`${assignment.id}|${item.id}`) || [],
        completion:
          completionsByAssignmentItem.get(`${assignment.id}|${item.id}`) ||
          null,
      })),
    };
  });

  return NextResponse.json({
    ok: true,
    mode: isClassDevice ? "class_device" : "teacher",
    class: classDevice,
    items,
  });
}
