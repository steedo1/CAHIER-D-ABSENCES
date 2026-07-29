import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { buildRelayBootstrapSnapshot } from "@/lib/relay-bootstrap-snapshot";
import { RELAY_SYNC_PROTOCOL_VERSION } from "@/lib/relay-cloud-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

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

function knownRevision(request: NextRequest) {
  const raw = new URL(request.url).searchParams.get("known_revision");
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("known_revision_invalid");
  }
  return value;
}

export async function GET(request: NextRequest) {
  let known: number | null;
  try {
    known = knownRevision(request);
  } catch (error) {
    return noStore({ error: error instanceof Error ? error.message : "invalid_request" }, 400);
  }

  const token = bearerToken(request);
  if (!token) return noStore({ error: "unauthorized" }, 401);
  const deviceId = tokenDeviceId(token);
  if (!deviceId) return noStore({ error: "unauthorized" }, 401);
  const declaredDeviceId = String(request.headers.get("x-moncahier-relay-device") || "").trim();
  if (declaredDeviceId && declaredDeviceId !== deviceId) {
    return noStore({ error: "relay_device_mismatch" }, 401);
  }

  const service = getSupabaseServiceClient();
  const { data: device, error: deviceError } = await service
    .from("relay_sync_devices")
    .select("id,institution_id,token_hash,is_active,revoked_at")
    .eq("id", deviceId)
    .maybeSingle();
  if (deviceError) return noStore({ error: "relay_device_lookup_failed" }, 503);

  const suppliedHash = createHash("sha256").update(token).digest("hex");
  if (
    !device ||
    !(device as any).is_active ||
    (device as any).revoked_at ||
    !secureEqualHex(String((device as any).token_hash || ""), suppliedHash)
  ) {
    return noStore({ error: "unauthorized" }, 401);
  }

  const institutionId = String((device as any).institution_id || "").trim();
  if (!institutionId) return noStore({ error: "relay_institution_missing" }, 403);

  const { data: policy, error: policyError } = await service
    .from("institution_attendance_policies")
    .select("enabled,allow_local_relay")
    .eq("institution_id", institutionId)
    .maybeSingle();
  const policyTableMissing = (policyError as any)?.code === "42P01";
  if (policyError && !policyTableMissing) {
    return noStore({ error: "attendance_policy_lookup_failed" }, 503);
  }
  if (policy?.enabled === true && policy.allow_local_relay === false) {
    return noStore({ error: "relay_presence_disabled" }, 403);
  }

  const { data: revisionRow, error: revisionError } = await service
    .from("attendance_schedule_revisions")
    .select("revision,updated_at")
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (revisionError) return noStore({ error: "schedule_revision_unavailable" }, 503);

  const revision = Number((revisionRow as any)?.revision ?? 0);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    return noStore({ error: "schedule_revision_invalid" }, 503);
  }
  if (known !== null && known > revision) {
    return noStore({
      error: "relay_revision_ahead",
      institution_id: institutionId,
      device_id: deviceId,
      known_revision: known,
      cloud_revision: revision,
    }, 409);
  }

  const serverTime = new Date().toISOString();
  const touchDevice = async () => {
    await service
      .from("relay_sync_devices")
      .update({ last_seen_at: serverTime, updated_at: serverTime })
      .eq("id", deviceId);
  };

  if (known !== null && known === revision) {
    await touchDevice();
    return noStore({
      protocol_version: RELAY_SYNC_PROTOCOL_VERSION,
      status: "not_modified",
      institution_id: institutionId,
      device_id: deviceId,
      server_time: serverTime,
      cloud_revision: revision,
      revision_updated_at: String((revisionRow as any)?.updated_at || serverTime),
    });
  }

  try {
    const snapshot = await buildRelayBootstrapSnapshot(service, institutionId);
    if (
      snapshot.snapshot_completeness !== "complete" ||
      !Number.isSafeInteger(Number(snapshot.snapshot_revision))
    ) {
      return noStore({
        error: "bootstrap_snapshot_not_complete",
        institution_id: institutionId,
        device_id: deviceId,
        cloud_revision: Number(snapshot.snapshot_revision ?? revision),
        diagnostics: snapshot.diagnostics,
      }, 409);
    }
    await touchDevice();
    return noStore({
      protocol_version: RELAY_SYNC_PROTOCOL_VERSION,
      status: "snapshot",
      institution_id: institutionId,
      device_id: deviceId,
      server_time: serverTime,
      cloud_revision: Number(snapshot.snapshot_revision),
      snapshot,
    });
  } catch (error) {
    return noStore({
      error: error instanceof Error ? error.message : "relay_pull_failed",
    }, 503);
  }
}
