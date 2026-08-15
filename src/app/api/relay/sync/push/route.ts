import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { triggerPushDispatch } from "@/lib/push-dispatch";
import { triggerSmsDispatch } from "@/lib/sms-dispatch";
import {
  parseRelaySyncBatch,
  processRelaySyncOperation,
  RELAY_SYNC_PROTOCOL_VERSION,
  type RelaySyncAcknowledgement,
} from "@/lib/relay-cloud-sync";
import { processRelayStudentGradeSyncOperationV4 } from "@/lib/relay-student-grade-sync-v4";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_500_000;

function bearerToken(request: NextRequest) {
  const authorization = String(request.headers.get("authorization") || "");
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  return token.length >= 32 && token.length <= 512 ? token : null;
}

function tokenDeviceId(token: string) {
  const index = token.indexOf(".");
  const deviceId = index > 0 ? token.slice(0, index) : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deviceId)
    ? deviceId
    : "";
}

function secureEqualHex(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "request_body_too_large" }, { status: 413 });
  }

  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const deviceId = tokenDeviceId(token);
  if (!deviceId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const declaredDeviceId = String(request.headers.get("x-moncahier-relay-device") || "").trim();
  if (declaredDeviceId && declaredDeviceId !== deviceId) {
    return NextResponse.json({ error: "relay_device_mismatch" }, { status: 401 });
  }

  const service = getSupabaseServiceClient();
  const { data: device, error: deviceError } = await service
    .from("relay_sync_devices")
    .select("id,institution_id,token_hash,is_active,revoked_at")
    .eq("id", deviceId)
    .maybeSingle();
  if (deviceError) {
    return NextResponse.json({ error: "relay_device_lookup_failed" }, { status: 503 });
  }
  const suppliedHash = createHash("sha256").update(token).digest("hex");
  if (
    !device ||
    !(device as any).is_active ||
    (device as any).revoked_at ||
    !secureEqualHex(String((device as any).token_hash || ""), suppliedHash)
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data: policy, error: policyError } = await service
    .from("institution_attendance_policies")
    .select("enabled,allow_local_relay")
    .eq("institution_id", String((device as any).institution_id || ""))
    .maybeSingle();
  const policyTableMissing = (policyError as any)?.code === "42P01";
  if (policyError && !policyTableMissing) {
    return NextResponse.json({ error: "attendance_policy_lookup_failed" }, { status: 503 });
  }
  if (policy?.enabled === true && policy.allow_local_relay === false) {
    return NextResponse.json({ error: "relay_presence_disabled" }, { status: 403 });
  }

  let batch;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "request_body_too_large" }, { status: 413 });
    }
    batch = parseRelaySyncBatch(JSON.parse(rawBody));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "invalid_request" },
      { status: 400 },
    );
  }
  if (batch.device_id !== deviceId) {
    return NextResponse.json({ error: "relay_device_mismatch" }, { status: 403 });
  }
  if (batch.institution_id !== String((device as any).institution_id || "")) {
    return NextResponse.json({ error: "relay_institution_mismatch" }, { status: 403 });
  }

  const acknowledgements: RelaySyncAcknowledgement[] = [];
  let attendanceChanged = false;
  for (const operation of batch.operations) {
    const acknowledgement = operation.entity_type === "student_grade"
      ? await processRelayStudentGradeSyncOperationV4(service, {
        institutionId: batch.institution_id,
        deviceId,
        operation,
      })
      : await processRelaySyncOperation(service, {
        institutionId: batch.institution_id,
        deviceId,
        operation,
      });
    acknowledgements.push(acknowledgement);
    if (
      operation.entity_type === "attendance_call" &&
      acknowledgement.status === "acknowledged" &&
      acknowledgement.applied_now &&
      acknowledgement.attendance_changed
    ) {
      attendanceChanged = true;
    }
  }
  const serverTime = new Date().toISOString();
  await service
    .from("relay_sync_devices")
    .update({ last_seen_at: serverTime, updated_at: serverTime })
    .eq("id", deviceId);
  if (attendanceChanged) {
    await Promise.allSettled([
      triggerPushDispatch({ req: request, reason: "relay_attendance_sync" }),
      triggerSmsDispatch({ req: request, reason: "relay_attendance_sync" }),
    ]);
  }

  return NextResponse.json({
    protocol_version: RELAY_SYNC_PROTOCOL_VERSION,
    institution_id: batch.institution_id,
    device_id: deviceId,
    server_time: serverTime,
    acknowledgements,
  }, { headers: { "Cache-Control": "no-store" } });
}
