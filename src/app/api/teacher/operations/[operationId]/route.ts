import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import {
  loadTeacherCloudOperationReceipt,
  teacherCloudReceiptIsStale,
  validTeacherCloudOperationId,
} from "@/lib/teacher-cloud-operation-receipts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function receiptUnavailable(error: unknown) {
  const value = error as { code?: string; message?: string };
  return value?.code === "42P01" || value?.code === "PGRST205" ||
    /teacher_cloud_operation_receipts|schema cache|does not exist/i.test(
      String(value?.message || ""),
    );
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ operationId: string }> },
) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { operationId: rawOperationId } = await context.params;
  const operationId = validTeacherCloudOperationId(rawOperationId);
  if (!operationId) {
    return NextResponse.json({ ok: false, error: "invalid_operation_id" }, { status: 400 });
  }

  try {
    const receipt = await loadTeacherCloudOperationReceipt(
      getSupabaseServiceClient(),
      operationId,
    );
    if (!receipt || receipt.actor_user_id !== user.id) {
      return NextResponse.json(
        { ok: true, operation_id: operationId, state: "not_received" },
        { status: 404 },
      );
    }

    const state = teacherCloudReceiptIsStale(receipt)
      ? "retryable"
      : receipt.state;
    return NextResponse.json({
      ok: true,
      operation_id: operationId,
      operation_type: receipt.operation_type,
      session_id: receipt.session_id,
      state,
      error: state === "retryable" && receipt.state === "processing"
        ? "processing_receipt_stale"
        : receipt.error_code,
      response: receipt.response_json || {},
      received_at: receipt.received_at,
      processed_at: receipt.processed_at,
      updated_at: receipt.updated_at,
    });
  } catch (error) {
    if (receiptUnavailable(error)) {
      return NextResponse.json(
        { ok: false, error: "teacher_cloud_operation_receipts_unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "operation_reconciliation_failed" },
      { status: 503 },
    );
  }
}
