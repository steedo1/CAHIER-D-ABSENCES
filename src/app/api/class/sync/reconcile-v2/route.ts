import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { classDeviceMayAccessClass } from "@/lib/class-device-identity";
import { classDeviceCloudSessionId } from "@/lib/class-device-cloud-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type OperationType = "session-start" | "attendance" | "session-end";
type OperationInput = {
  operation_id?: unknown;
  operation_type?: unknown;
  session_dependency_key?: unknown;
  operation_body?: unknown;
};
type ReconcileBody = { class_id?: unknown; operations?: unknown };

type LocalMark = {
  studentId: string;
  status: "present" | "absent" | "late";
  reason: string | null;
  observedAt: string | null;
  minutesLate: number | null;
};

const OPERATION_TYPES = new Set<OperationType>([
  "session-start",
  "attendance",
  "session-end",
]);

function text(value: unknown) {
  return String(value ?? "").trim();
}
function validOperationId(value: string) {
  return /^[a-zA-Z0-9:_-]{8,160}$/.test(value) && !value.startsWith("client:");
}
function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
function asBody(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}
function parseDateMs(value: unknown) {
  const normalized = text(value);
  if (!normalized) return null;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}
function normalizedReason(value: unknown) {
  const normalized = text(value);
  return normalized || null;
}
function dependencyStartOperationId(value: string) {
  if (!value.startsWith("client:")) return null;
  const operationId = value.slice("client:".length).trim();
  return validOperationId(operationId) ? operationId : null;
}

function normalizeLocalMarks(value: unknown): LocalMark[] | null {
  if (!Array.isArray(value)) return null;
  const byStudent = new Map<string, LocalMark>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const studentId = text((raw as any).student_id);
    const status = text((raw as any).status);
    if (!studentId || !["present", "absent", "late"].includes(status)) return null;
    const observedAt =
      text((raw as any).observed_at) || text((raw as any).late_observed_at) || null;
    const rawMinutes = (raw as any).minutes_late;
    const minutesLate = Number.isFinite(Number(rawMinutes))
      ? Math.max(0, Math.round(Number(rawMinutes)))
      : null;
    byStudent.set(studentId, {
      studentId,
      status: status as LocalMark["status"],
      reason: normalizedReason((raw as any).reason ?? (raw as any).comment),
      observedAt,
      minutesLate,
    });
  }
  return Array.from(byStudent.values()).sort((a, b) =>
    a.studentId.localeCompare(b.studentId),
  );
}

function expectedLateMinutes(mark: LocalMark, sessionStartedAt: string | null) {
  if (mark.status !== "late") return 0;
  if (mark.minutesLate != null) return mark.minutesLate;
  const observedMs = parseDateMs(mark.observedAt);
  const startedMs = parseDateMs(sessionStartedAt);
  if (observedMs == null || startedMs == null || observedMs < startedMs) return null;
  return Math.max(0, Math.floor((observedMs - startedMs) / 60_000));
}

async function resolveSessionId(input: {
  operationType: OperationType;
  operationId: string;
  dependencyKey: string;
  localBody: Record<string, any>;
  institutionId: string;
  classId: string;
  actorProfileId: string;
}) {
  if (input.operationType === "session-start") {
    return classDeviceCloudSessionId({
      institutionId: input.institutionId,
      classId: input.classId,
      actorProfileId: input.actorProfileId,
      operationId: input.operationId,
    });
  }
  const bodySessionId = text(input.localBody.session_id);
  if (isUuid(bodySessionId)) return bodySessionId;
  if (isUuid(input.dependencyKey)) return input.dependencyKey;
  const startOperationId =
    dependencyStartOperationId(bodySessionId) ||
    dependencyStartOperationId(input.dependencyKey);
  if (!startOperationId) return null;
  return classDeviceCloudSessionId({
    institutionId: input.institutionId,
    classId: input.classId,
    actorProfileId: input.actorProfileId,
    operationId: startOperationId,
  });
}

async function attendanceAlreadyApplied(input: {
  srv: ReturnType<typeof getSupabaseServiceClient>;
  institutionId: string;
  session: {
    id: string;
    started_at: string | null;
    ended_at: string | null;
    status: string | null;
  };
  operationId: string;
  localBody: Record<string, any>;
}) {
  const { data: causality, error: causalityError } = await input.srv
    .from("relay_attendance_session_causality")
    .select("last_operation_id,last_captured_at_device")
    .eq("institution_id", input.institutionId)
    .eq("session_id", input.session.id)
    .maybeSingle();

  if (!causalityError && text(causality?.last_operation_id) === input.operationId) {
    return { acknowledged: true, reason: "attendance_operation_confirmed_in_cloud" };
  }

  const sessionClosed =
    Boolean(input.session.ended_at) || text(input.session.status) === "submitted";
  if (!sessionClosed) return { acknowledged: false, reason: "session_still_open" };

  const capturedAt =
    text(input.localBody.captured_at_device) ||
    text(input.localBody.actual_call_at) ||
    text(input.localBody.client_call_at) ||
    text(input.localBody.call_at);
  const localCapturedMs = parseDateMs(capturedAt);
  const cloudCapturedMs = parseDateMs(causality?.last_captured_at_device);
  if (causalityError || localCapturedMs == null || cloudCapturedMs == null) {
    return {
      acknowledged: false,
      reason: causalityError
        ? "attendance_receipt_lookup_unavailable"
        : "attendance_capture_not_confirmed",
    };
  }
  if (Math.abs(localCapturedMs - cloudCapturedMs) > 2_000) {
    return { acknowledged: false, reason: "attendance_capture_mismatch" };
  }

  const localMarks = normalizeLocalMarks(input.localBody.marks);
  if (localMarks == null) {
    return { acknowledged: false, reason: "attendance_local_payload_unavailable" };
  }
  const expected = localMarks
    .filter((mark) => mark.status === "absent" || mark.status === "late")
    .map((mark) => ({
      studentId: mark.studentId,
      status: mark.status,
      reason: mark.reason,
      minutesLate: expectedLateMinutes(mark, input.session.started_at),
    }));
  if (expected.some((mark) => mark.minutesLate == null)) {
    return { acknowledged: false, reason: "attendance_lateness_not_provable" };
  }

  const { data: cloudMarks, error: cloudMarksError } = await input.srv
    .from("attendance_marks")
    .select("student_id,status,minutes_late,reason")
    .eq("session_id", input.session.id);
  if (cloudMarksError) {
    return { acknowledged: false, reason: "attendance_marks_lookup_unavailable" };
  }
  const actual = (cloudMarks || [])
    .map((mark: any) => ({
      studentId: text(mark?.student_id),
      status: text(mark?.status),
      minutesLate: Math.max(0, Math.round(Number(mark?.minutes_late || 0))),
      reason: normalizedReason(mark?.reason),
    }))
    .filter((mark) => mark.studentId)
    .sort((a, b) => a.studentId.localeCompare(b.studentId));

  if (actual.length !== expected.length) {
    return { acknowledged: false, reason: "attendance_mark_count_mismatch" };
  }
  for (let index = 0; index < expected.length; index += 1) {
    const local = expected[index]!;
    const cloud = actual[index]!;
    if (
      local.studentId !== cloud.studentId ||
      local.status !== cloud.status ||
      local.minutesLate !== cloud.minutesLate ||
      local.reason !== cloud.reason
    ) {
      return { acknowledged: false, reason: "attendance_mark_payload_mismatch" };
    }
  }
  return { acknowledged: true, reason: "attendance_payload_proven_in_cloud" };
}

export async function POST(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();
    const { data: { user } } = await supa.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as ReconcileBody;
    const classId = text(body.class_id);
    const rawOperations = Array.isArray(body.operations) ? body.operations : [];
    if (!classId) return NextResponse.json({ error: "class_id_required" }, { status: 400 });
    if (rawOperations.length > 100) {
      return NextResponse.json({ error: "too_many_operations" }, { status: 400 });
    }

    const { data: cls, error: classError } = await srv
      .from("classes")
      .select("id,institution_id")
      .eq("id", classId)
      .maybeSingle();
    if (classError) return NextResponse.json({ error: "class_lookup_unavailable" }, { status: 503 });
    if (!cls) return NextResponse.json({ error: "class_not_found" }, { status: 404 });

    const allowed = await classDeviceMayAccessClass({
      service: srv,
      userId: user.id,
      userPhone: user.phone,
      classId,
    });
    if (!allowed) {
      return NextResponse.json({ error: "forbidden_not_class_device" }, { status: 403 });
    }

    const institutionId = text(cls.institution_id);
    const operations = rawOperations
      .map((raw) => raw as OperationInput)
      .map((raw) => ({
        operationId: text(raw.operation_id),
        operationType: text(raw.operation_type) as OperationType,
        dependencyKey: text(raw.session_dependency_key),
        localBody: asBody(raw.operation_body),
      }))
      .filter((item) =>
        validOperationId(item.operationId) && OPERATION_TYPES.has(item.operationType),
      );

    const results: Array<{
      operation_id: string;
      operation_type: OperationType;
      acknowledged: boolean;
      session_id: string | null;
      reason: string;
      subject_id?: string | null;
      started_at?: string | null;
      actual_call_at?: string | null;
    }> = [];

    for (const operation of operations) {
      const sessionId = await resolveSessionId({
        ...operation,
        institutionId,
        classId,
        actorProfileId: user.id,
      });
      if (!sessionId) {
        results.push({
          operation_id: operation.operationId,
          operation_type: operation.operationType,
          acknowledged: false,
          session_id: null,
          reason: "session_dependency_unresolved",
        });
        continue;
      }

      const { data: session, error: sessionError } = await srv
        .from("teacher_sessions")
        .select("id,institution_id,class_id,created_by,subject_id,started_at,actual_call_at,ended_at,status")
        .eq("id", sessionId)
        .eq("institution_id", institutionId)
        .eq("class_id", classId)
        .maybeSingle();
      if (sessionError) {
        results.push({
          operation_id: operation.operationId,
          operation_type: operation.operationType,
          acknowledged: false,
          session_id: sessionId,
          reason: "session_lookup_unavailable",
        });
        continue;
      }
      if (!session || text(session.created_by) !== text(user.id)) {
        results.push({
          operation_id: operation.operationId,
          operation_type: operation.operationType,
          acknowledged: false,
          session_id: sessionId,
          reason: "session_not_confirmed",
        });
        continue;
      }

      if (operation.operationType === "session-start") {
        const localSubjectId = text(operation.localBody.subject_id);
        const subjectMatches = !localSubjectId || localSubjectId === text(session.subject_id);
        results.push({
          operation_id: operation.operationId,
          operation_type: operation.operationType,
          acknowledged: subjectMatches,
          session_id: sessionId,
          reason: subjectMatches ? "session_start_proven_in_cloud" : "session_subject_mismatch",
          subject_id: text(session.subject_id) || null,
          started_at: text(session.started_at) || null,
          actual_call_at: text(session.actual_call_at) || null,
        });
        continue;
      }

      if (operation.operationType === "session-end") {
        const localEnd =
          text(operation.localBody.actual_end_at) ||
          text(operation.localBody.device_requested_at);
        const localEndMs = parseDateMs(localEnd);
        const cloudEndMs = parseDateMs(session.ended_at);
        const closeMatches =
          localEndMs != null &&
          cloudEndMs != null &&
          Math.abs(localEndMs - cloudEndMs) <= 30_000;
        results.push({
          operation_id: operation.operationId,
          operation_type: operation.operationType,
          acknowledged: closeMatches,
          session_id: sessionId,
          reason: closeMatches
            ? "session_close_time_proven_in_cloud"
            : cloudEndMs == null
              ? "session_still_open"
              : "session_close_time_mismatch",
        });
        continue;
      }

      const attendance = await attendanceAlreadyApplied({
        srv,
        institutionId,
        session: {
          id: text(session.id),
          started_at: text(session.started_at) || null,
          ended_at: text(session.ended_at) || null,
          status: text(session.status) || null,
        },
        operationId: operation.operationId,
        localBody: operation.localBody,
      });
      results.push({
        operation_id: operation.operationId,
        operation_type: operation.operationType,
        acknowledged: attendance.acknowledged,
        session_id: sessionId,
        reason: attendance.reason,
      });
    }

    return NextResponse.json({
      ok: true,
      class_id: classId,
      institution_id: institutionId,
      results,
      acknowledged_operation_ids: results
        .filter((item) => item.acknowledged)
        .map((item) => item.operation_id),
      server_time: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "sync_reconcile_v2_failed" },
      { status: 500 },
    );
  }
}
