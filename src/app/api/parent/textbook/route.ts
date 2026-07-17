// src/app/api/parent/textbook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanUuid(value: string | null) {
  const s = String(value || "").trim();
  return s || null;
}

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((v) => String(v || "").trim()).filter(Boolean)));
}

async function assertParentCanReadStudent(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  deviceId: string,
  studentId: string,
) {
  const { data: link } = await srv
    .from("parent_device_children")
    .select("student_id")
    .eq("device_id", deviceId)
    .eq("student_id", studentId)
    .maybeSingle();

  return Boolean(link?.student_id);
}

async function signedUrlForDocument(srv: any, document: any) {
  if (!document?.storage_bucket || !document?.storage_path) return null;
  const { data } = await srv.storage
    .from(String(document.storage_bucket))
    .createSignedUrl(String(document.storage_path), 60 * 60);
  return data?.signedUrl || null;
}

export async function GET(req: NextRequest) {
  const srv = getSupabaseServiceClient();
  const studentId = cleanUuid(req.nextUrl.searchParams.get("student_id"));

  if (!studentId) {
    return NextResponse.json(
      { ok: false, error: "student_id_required" },
      { status: 400 },
    );
  }

  const jar = await cookies();
  const deviceId = jar.get("parent_device")?.value || "";
  if (!deviceId) return NextResponse.json({ ok: true, items: [] });

  const allowed = await assertParentCanReadStudent(srv, deviceId, studentId);
  if (!allowed) {
    return NextResponse.json(
      { ok: false, error: "forbidden_student" },
      { status: 403 },
    );
  }

  const { data: enrollment, error: enrollmentErr } = await srv
    .from("class_enrollments")
    .select("student_id,institution_id,class_id,classes:class_id(id,label,level,academic_year,institution_id)")
    .eq("student_id", studentId)
    .is("end_date", null)
    .limit(1)
    .maybeSingle();

  if (enrollmentErr) {
    return NextResponse.json(
      { ok: false, error: enrollmentErr.message },
      { status: 400 },
    );
  }

  const institutionId = String(
    (enrollment as any)?.classes?.institution_id ||
      (enrollment as any)?.institution_id ||
      "",
  ).trim();
  const classId = String((enrollment as any)?.class_id || "").trim();

  if (!institutionId || !classId) {
    return NextResponse.json({ ok: true, items: [] });
  }

  const { data: assignments, error: assignmentErr } = await srv
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
      progression:textbook_progression_templates(
        id,
        academic_year,
        subject_name,
        level,
        series,
        title,
        description,
        status,
        source_national_template_id,
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
    .eq("class_id", classId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (assignmentErr) {
    return NextResponse.json(
      { ok: false, error: assignmentErr.message },
      { status: 400 },
    );
  }

  const activeAssignments = ((assignments || []) as any[]).filter(
    (a) => a?.progression?.status === "active",
  );

  const progressionIds = uniq(activeAssignments.map((a) => a.progression_id));
  const assignmentIds = uniq(activeAssignments.map((a) => a.id));

  const sourceIdsMissingDocument = uniq(
    activeAssignments
      .filter((a) => !a?.progression?.document)
      .map((a) => a?.progression?.source_national_template_id),
  );

  const sourceDocuments = new Map<string, any>();
  if (sourceIdsMissingDocument.length) {
    const { data: sources } = await srv
      .from("textbook_progression_templates")
      .select(
        `
        id,
        document:textbook_progression_documents(
          id,
          original_name,
          storage_bucket,
          storage_path,
          mime_type,
          size_bytes
        )
      `,
      )
      .in("id", sourceIdsMissingDocument);
    for (const source of (sources || []) as any[]) {
      if (source?.document) sourceDocuments.set(String(source.id), source.document);
    }
  }

  const itemsByProgression = new Map<string, any[]>();
  if (progressionIds.length) {
    const { data: progressionItems, error: itemsErr } = await srv
      .from("textbook_progression_items")
      .select("*")
      .in("progression_id", progressionIds)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (itemsErr) {
      return NextResponse.json(
        { ok: false, error: itemsErr.message },
        { status: 400 },
      );
    }

    for (const item of (progressionItems || []) as any[]) {
      const key = String(item.progression_id || "");
      if (!itemsByProgression.has(key)) itemsByProgression.set(key, []);
      itemsByProgression.get(key)!.push(item);
    }
  }

  const sessionsByAssignmentItem = new Map<string, any[]>();
  if (assignmentIds.length) {
    const { data: sessions, error: sessionsErr } = await srv
      .from("textbook_lesson_sessions")
      .select("id,assignment_id,item_id,teacher_id,session_title,session_date,session_period_label,session_start_time,session_end_time,duration_minutes,content,homework,created_at")
      .eq("institution_id", institutionId)
      .in("assignment_id", assignmentIds)
      .order("session_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (sessionsErr) {
      return NextResponse.json(
        { ok: false, error: sessionsErr.message },
        { status: 400 },
      );
    }

    for (const session of (sessions || []) as any[]) {
      const key = `${session.assignment_id}|${session.item_id}`;
      if (!sessionsByAssignmentItem.has(key)) sessionsByAssignmentItem.set(key, []);
      sessionsByAssignmentItem.get(key)!.push(session);
    }
  }

  const completionsByAssignmentItem = new Map<string, any>();
  if (assignmentIds.length) {
    const { data: completions } = await srv
      .from("textbook_lesson_completions")
      .select("id,assignment_id,item_id,status,updated_at")
      .eq("institution_id", institutionId)
      .in("assignment_id", assignmentIds);

    for (const completion of (completions || []) as any[]) {
      completionsByAssignmentItem.set(
        `${completion.assignment_id}|${completion.item_id}`,
        completion,
      );
    }
  }

  const teacherIds = uniq([
    ...activeAssignments.map((a) => a.teacher_id),
    ...Array.from(sessionsByAssignmentItem.values()).flat().map((s) => s.teacher_id),
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
            `${p.first_name || ""} ${p.last_name || ""}`,
        ).trim() || "Enseignant";
      teacherNames.set(String(p.id), name);
    }
  }

  const items = await Promise.all(
    activeAssignments.map(async (assignment) => {
      const progressionItems = itemsByProgression.get(String(assignment.progression_id)) || [];
      const rows = progressionItems.map((item) => {
        const key = `${assignment.id}|${item.id}`;
        const sessions = (sessionsByAssignmentItem.get(key) || []).map((session) => ({
          ...session,
          teacher_name: session.teacher_id ? teacherNames.get(String(session.teacher_id)) || "Enseignant" : null,
        }));
        return {
          ...item,
          sessions,
          completion: completionsByAssignmentItem.get(key) || null,
        };
      });

      const plannedTotal = rows.reduce((sum, row) => sum + Number(row.planned_duration_minutes || 0), 0);
      const completedTotal = rows.reduce((sum, row) => {
        return row.completion?.status === "completed"
          ? sum + Number(row.planned_duration_minutes || 0)
          : sum;
      }, 0);
      const sessionsCount = rows.reduce((sum, row) => sum + (row.sessions?.length || 0), 0);
      const latestSession = rows
        .flatMap((row) => row.sessions || [])
        .sort((a, b) => String(b.session_date || "").localeCompare(String(a.session_date || "")) || String(b.created_at || "").localeCompare(String(a.created_at || "")))[0] || null;

      let document = assignment?.progression?.document || null;
      const sourceId = String(assignment?.progression?.source_national_template_id || "");
      if (!document && sourceDocuments.has(sourceId)) document = sourceDocuments.get(sourceId);
      const signedUrl = await signedUrlForDocument(srv, document);

      return {
        assignment_id: assignment.id,
        class_id: assignment.class_id,
        class_label: (enrollment as any)?.classes?.label || null,
        subject_name: assignment?.progression?.subject_name || "Matière",
        teacher_name: assignment.teacher_id ? teacherNames.get(String(assignment.teacher_id)) || null : null,
        progression: {
          ...assignment.progression,
          document: document ? { ...document, signed_url: signedUrl } : null,
        },
        planned_total_minutes: plannedTotal,
        completed_total_minutes: completedTotal,
        progress_percent: plannedTotal > 0 ? Math.round((completedTotal / plannedTotal) * 100) : 0,
        sessions_count: sessionsCount,
        latest_session: latestSession,
        items: rows,
      };
    }),
  );

  items.sort((a: any, b: any) => String(a.subject_name || "").localeCompare(String(b.subject_name || ""), "fr"));

  return NextResponse.json({
    ok: true,
    student_id: studentId,
    class_id: classId,
    class_label: (enrollment as any)?.classes?.label || null,
    items,
  });
}
