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
};

type ReconcileBody = {
  class_id?: unknown;
  operations?: unknown;
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

      if (operation.operationType === "session-end") {
        const closed = Boolean(session.ended_at) || String(session.status || "") === "submitted";
        results.push({
          operation_id: operation.operationId,
          operation_type: operation.operationType,
          acknowledged: closed,
          session_id: sessionId,
          reason: closed ? "session_already_closed_in_cloud" : "session_still_open",
        });
        continue;
      }

      const { data: causality, error: causalityError } = await srv
        .from("relay_attendance_session_causality")
        .select("last_operation_id")
        .eq("institution_id", institutionId)
        .eq("session_id", sessionId)
        .maybeSingle();

      const applied =
        !causalityError &&
        String(causality?.last_operation_id || "") === operation.operationId;
      results.push({
        operation_id: operation.operationId,
        operation_type: operation.operationType,
        acknowledged: applied,
        session_id: sessionId,
        reason: applied
          ? "attendance_operation_confirmed_in_cloud"
          : causalityError
            ? "attendance_receipt_lookup_unavailable"
            : "attendance_operation_not_confirmed",
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
