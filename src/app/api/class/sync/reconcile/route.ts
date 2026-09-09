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
  created_at?: unknown;
  last_status?: unknown;
  last_error?: unknown;
  operation_body?: unknown;
};

type ReconcileBody = {
  class_id?: unknown;
  operations?: unknown;
};

type LocalAttendanceMark = {
  studentId: string;
  status: "present" | "absent" | "late";
  reason: string | null;
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

function dependencyStartOperationId(value: string) {
  const normalized = text(value);
  if (!normalized.startsWith("client:")) return null;
  const operationId = normalized.slice("client:".length).trim();
  return validOperationId(operationId) ? operationId : null;
}

function parseDateMs(value: unknown) {
  const normalized = text(value);
  if (!normalized) return null;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function operationBody(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function normalizeLocalAttendanceMarks(value: unknown): LocalAttendanceMark[] | null {
  if (!Array.isArray(value)) return null;
  const byStudent = new Map<string, LocalAttendanceMark>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const studentId = text((raw as any).student_id);
    const status = text((raw as any).status);
    if (!studentId || !["present", "absent", "late"].includes(status)) {
      return null;
    }
    byStudent.set(studentId, {
      studentId,
      status: status as LocalAttendanceMark["status"],
      reason:
        (raw as any).reason == null
          ? null
          : text((raw as any).reason) || null,
    });
  }
  return Array.from(byStudent.values()).sort((left, right) =>
    left.studentId.localeCompare(right.studentId),
  );
}

async function attendancePayloadAlreadyPresent(input: {
  srv: ReturnType<typeof getSupabaseServiceClient>;
  institutionId: string;
  sessionId: string;
  localBody: Record<string, any>;
  sessionClosed: boolean;
}) {
  if (!input.sessionClosed) {
    return { matched: false, reason: "session_still_open" };
  }

  const capturedAt =
    text(input.localBody.captured_at_device) ||
    text(input.localBody.actual_call_at) ||
    text(input.localBody.client_call_at) ||
    text(input.localBody.call_at);
  const capturedAtMs = parseDateMs(capturedAt);
  const localMarks = normalizeLocalAttendanceMarks(input.localBody.marks);
  if (capturedAtMs == null || localMarks == null) {
    return { matched: false, reason: "attendance_local_payload_unavailable" };
  }

  const { data: causality, error: causalityError } = await input.srv
    .from("relay_attendance_session_causality")
    .select("last_captured_at_device,last_operation_id")
    .eq("institution_id", input.institutionId)
    .eq("session_id", input.sessionId)
    .maybeSingle();

  if (causalityError || !causality?.last_captured_at_device) {
    return {
      matched: false,
      reason: causalityError
        ? "attendance_receipt_lookup_unavailable"
        : "attendance_capture_not_confirmed",
    };
  }

  const cloudCapturedMs = parseDateMs(causality.last_captured_at_device);
  if (cloudCapturedMs == null || Math.abs(cloudCapturedMs - capturedAtMs) > 1_500) {
    return { matched: false, reason: "attendance_capture_mismatch" };
  }

  const { data: cloudMarks, error: cloudMarksError } = await input.srv
    .from("attendance_marks")
    .select("student_id,status,reason")
    .eq("session_id", input.sessionId);

  if (cloudMarksError) {
    return { matched: false, reason: "attendance_marks_lookup_unavailable" };
  }

  // Les présences ne sont pas conservées dans attendance_marks : la table ne
  // contient que les absences/retards. On exige donc une égalité de l'ensemble
  // final des statuts non-présents, pas une simple inclusion.
  const expected = localMarks
    .filter((mark) => mark.status === "absent" || mark.status === "late")
    .sort((left, right) => left.studentId.localeCompare(right.studentId));
  const actual = (cloudMarks || [])
    .map((mark: any) => ({
      studentId: text(mark?.student_id),
      status: text(mark?.status),
      reason: mark?.reason == null ? null : text(mark.reason) || null,
    }))
    .filter((mark) => mark.studentId)
    .sort((left, right) => left.studentId.localeCompare(right.studentId));

  if (actual.length !== expected.length) {
    return { matched: false, reason: "attendance_mark_count_mismatch" };
  }

  for (let index = 0; index < expected.length; index += 1) {
    const local = expected[index]!;
    const cloud = actual[index]!;
    if (local.studentId !== cloud.studentId || local.status !== cloud.status) {
      return { matched: false, reason: "attendance_mark_status_mismatch" };
    }
    if (local.reason != null && local.reason !== cloud.reason) {
      return { matched: false, reason: "attendance_mark_reason_mismatch" };
    }
  }

  return { matched: true, reason: "attendance_payload_already_present_in_cloud" };
}

export async function POST(req: NextRequest) {
  try {
    const supa = await getSupabaseServerClient();
    const srv = getSupabaseServiceClient();
    const {
      data: { user },
    } = await supa.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as ReconcileBody;
    const classId = text(body.class_id);
    const rawOperations = Array.isArray(body.operations) ? body.operations : [];

    if (!classId) {
      return NextResponse.json({ error: "class_id_required" }, { status: 400 });
    }
    if (rawOperations.length > 60) {
      return NextResponse.json({ error: "too_many_operations" }, { status: 400 });
    }

    const { data: cls, error: classError } = await srv
      .from("classes")
      .select("id,institution_id")
      .eq("id", classId)
      .maybeSingle();

    if (classError) {
      return NextResponse.json({ error: "class_lookup_unavailable" }, { status: 503 });
    }
    if (!cls) {
      return NextResponse.json({ error: "class_not_found" }, { status: 404 });
    }

    const allowed = await classDeviceMayAccessClass({
      service: srv,
      userId: user.id,
      userPhone: user.phone,
      classId,
    });
    if (!allowed) {
      return NextResponse.json({ error: "forbidden_not_class_device" }, { status: 403 });
    }

    const institutionId = String(cls.institution_id);
    const operations = rawOperations
      .map((raw) => raw as OperationInput)
      .map((raw) => ({
        operationId: text(raw.operation_id),
        operationType: text(raw.operation_type) as OperationType,
        dependencyKey: text(raw.session_dependency_key),
        localBody: operationBody(raw.operation_body),
      }))
      .filter(
        (item) =>
          validOperationId(item.operationId) &&
          OPERATION_TYPES.has(item.operationType),
      );

    const results: Array<{
      operation_id: string;
      operation_type: OperationType;
      acknowledged: boolean;
      session_id: string | null;
      reason: string;
    }> = [];

    for (const operation of operations) {
      let sessionId: string | null = null;

      if (operation.operationType === "session-start") {
        sessionId = classDeviceCloudSessionId({
          institutionId,
          classId,
          actorProfileId: user.id,
          operationId: operation.operationId,
        });
      } else if (isUuid(operation.dependencyKey)) {
        sessionId = operation.dependencyKey;
      } else {
        const startOperationId = dependencyStartOperationId(operation.dependencyKey);
        if (startOperationId) {
          sessionId = classDeviceCloudSessionId({
            institutionId,
            classId,
            actorProfileId: user.id,
            operationId: startOperationId,
          });
        }
      }

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
        .select("id,institution_id,class_id,created_by,ended_at,status")
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

      if (!session || String(session.created_by || "") !== String(user.id)) {
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
        results.push({
          operation_id: operation.operationId,
          operation_type: operation.operationType,
          acknowledged: true,
          session_id: sessionId,
          reason: "session_exists_in_cloud",
        });
        continue;
      }

      const sessionClosed =
        Boolean(session.ended_at) || String(session.status || "") === "submitted";

      if (operation.operationType === "session-end") {
        results.push({
          operation_id: operation.operationId,
          operation_type: operation.operationType,
          acknowledged: sessionClosed,
          session_id: sessionId,
          reason: sessionClosed
            ? "session_already_closed_in_cloud"
            : "session_still_open",
        });
        continue;
      }

      const { data: causality, error: causalityError } = await srv
        .from("relay_attendance_session_causality")
        .select("last_operation_id")
        .eq("institution_id", institutionId)
        .eq("session_id", sessionId)
        .maybeSingle();

      const exactOperationApplied =
        !causalityError &&
        String(causality?.last_operation_id || "") === operation.operationId;

      if (exactOperationApplied) {
        results.push({
          operation_id: operation.operationId,
          operation_type: operation.operationType,
          acknowledged: true,
          session_id: sessionId,
          reason: "attendance_operation_confirmed_in_cloud",
        });
        continue;
      }

      const semantic = await attendancePayloadAlreadyPresent({
        srv,
        institutionId,
        sessionId,
        localBody: operation.localBody,
        sessionClosed,
      });

      results.push({
        operation_id: operation.operationId,
        operation_type: operation.operationType,
        acknowledged: semantic.matched,
        session_id: sessionId,
        reason: semantic.matched
          ? semantic.reason
          : causalityError
            ? "attendance_receipt_lookup_unavailable"
            : semantic.reason || "attendance_operation_not_confirmed",
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
      { error: error?.message || "sync_reconcile_failed" },
      { status: 500 },
    );
  }
}
