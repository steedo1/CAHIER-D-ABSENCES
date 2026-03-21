// src/app/api/sms/delivery-receipt/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QueueRow = {
  id: string;
  status: string | null;
  created_at: string;
  meta: any | null;
};

function rid() {
  return Math.random().toString(36).slice(2, 8);
}

function s(value: unknown) {
  return String(value ?? "").trim();
}

function safeJsonParse<T = any>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function cloneJson<T = any>(value: T): T | null {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function buildMergedMeta(existingMeta: any, patch: Record<string, any>) {
  let base: Record<string, any> = {};
  if (existingMeta && typeof existingMeta === "object") {
    base = existingMeta;
  } else if (typeof existingMeta === "string") {
    const parsed = safeJsonParse<Record<string, any>>(existingMeta);
    if (parsed && typeof parsed === "object") {
      base = parsed;
    }
  }

  return {
    ...base,
    ...patch,
  };
}

function normalizeHeaders(headers: Headers) {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function short(value: string | null | undefined, keep = 18) {
  const v = s(value);
  if (!v) return "";
  if (v.length <= keep) return v;
  return `${v.slice(0, 8)}…${v.slice(-6)}`;
}

function normalizeResourceUrl(value: string | null | undefined) {
  const v = s(value);
  if (!v) return "";
  return v.replace(/\?.*$/, "").replace(/#.*$/, "");
}

function normalizePhone(value: string | null | undefined) {
  const raw = s(value);
  if (!raw) return "";
  if (raw.startsWith("tel:+")) return raw.slice(4);
  if (raw.startsWith("+")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("225") && digits.length >= 11) return `+${digits}`;
  if (digits.length === 10) return `+225${digits}`;
  return raw;
}

function collectAllStrings(input: unknown, out: string[] = []) {
  if (typeof input === "string") {
    out.push(input);
    return out;
  }

  if (Array.isArray(input)) {
    for (const item of input) collectAllStrings(item, out);
    return out;
  }

  if (input && typeof input === "object") {
    for (const value of Object.values(input as Record<string, unknown>)) {
      collectAllStrings(value, out);
    }
  }

  return out;
}

function findFirstByKey(input: unknown, wantedKeys: string[]): string {
  const wanted = new Set(wantedKeys.map((k) => k.toLowerCase()));

  function walk(node: unknown): string {
    if (!node || typeof node !== "object") return "";

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found) return found;
      }
      return "";
    }

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (wanted.has(key.toLowerCase())) {
        if (typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "boolean") {
          return String(value);
        }
      }

      const nested = walk(value);
      if (nested) return nested;
    }

    return "";
  }

  return walk(input);
}

function extractReceiptInfo(
  req: NextRequest,
  rawBody: string,
  parsedBody: any
) {
  const query = Object.fromEntries(req.nextUrl.searchParams.entries());

  const allStrings = collectAllStrings(parsedBody || rawBody || "");

  const resourceURL =
    normalizeResourceUrl(
      s(query.resourceURL) ||
        findFirstByKey(parsedBody, ["resourceURL", "resourceUrl"]) ||
        allStrings.find((x) => x.includes("/smsmessaging/v1/outbound/")) ||
        ""
    );

  const deliveryStatus =
    s(query.deliveryStatus) ||
    s(query.status) ||
    findFirstByKey(parsedBody, [
      "deliveryStatus",
      "status",
      "deliveryInfoStatus",
      "deliveryStatusDescription",
    ]) ||
    "";

  const recipientAddress =
    normalizePhone(
      s(query.address) ||
        s(query.destinationAddress) ||
        findFirstByKey(parsedBody, [
          "address",
          "destinationAddress",
          "phoneNumber",
          "msisdn",
        ])
    ) || "";

  const callbackData =
    s(query.callbackData) ||
    findFirstByKey(parsedBody, ["callbackData"]) ||
    "";

  return {
    resourceURL,
    deliveryStatus,
    recipientAddress,
    callbackData,
    query,
  };
}

function extractResourceUrlsFromQueueMeta(meta: any): string[] {
  const urls: string[] = [];

  const push = (v: unknown) => {
    const n = normalizeResourceUrl(s(v));
    if (n) urls.push(n);
  };

  if (!meta || typeof meta !== "object") {
    return urls;
  }

  const smsDispatch = (meta as any).sms_dispatch;
  if (smsDispatch && typeof smsDispatch === "object") {
    push(smsDispatch.resourceURL);

    const successTargets = Array.isArray(smsDispatch.success_targets)
      ? smsDispatch.success_targets
      : [];

    for (const t of successTargets) {
      push(t?.orange?.resourceURL);
      push(t?.resourceURL);
    }
  }

  const smsDeliveryReceipt = (meta as any).sms_delivery_receipt;
  if (smsDeliveryReceipt && typeof smsDeliveryReceipt === "object") {
    push(smsDeliveryReceipt.resourceURL);
  }

  return Array.from(new Set(urls));
}

async function findMatchingQueueRowByResourceURL(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  resourceURL: string
): Promise<QueueRow | null> {
  const normalized = normalizeResourceUrl(resourceURL);
  if (!normalized) return null;

  const { data, error } = await srv
    .from("notifications_queue")
    .select("id,status,created_at,meta")
    .contains("channels", ["sms"])
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.warn("[sms/delivery-receipt] queue_lookup_error", {
      error: error.message,
    });
    return null;
  }

  for (const row of (data || []) as QueueRow[]) {
    const candidates = extractResourceUrlsFromQueueMeta(row.meta);
    if (candidates.includes(normalized)) {
      return row;
    }
  }

  return null;
}

function buildReceiptPatch(params: {
  runId: string;
  headers: Record<string, string>;
  rawBody: string;
  parsedBody: any;
  resourceURL: string;
  deliveryStatus: string;
  recipientAddress: string;
  callbackData: string;
  matchedQueueId: string | null;
}) {
  const nowIso = new Date().toISOString();

  return {
    sms_delivery_receipt: {
      received_at: nowIso,
      run_id: params.runId,
      matched_queue_id: params.matchedQueueId,
      resourceURL: params.resourceURL || null,
      delivery_status: params.deliveryStatus || null,
      recipient_address: params.recipientAddress || null,
      callback_data: params.callbackData || null,
      headers: cloneJson(params.headers),
      payload: cloneJson(params.parsedBody) ?? params.rawBody.slice(0, 4000),
      raw_preview: params.rawBody.slice(0, 2000),
    },
  };
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "sms-delivery-receipt",
    message: "Orange delivery receipt endpoint is alive.",
  });
}

export async function POST(req: NextRequest) {
  const id = rid();
  const t0 = Date.now();

  const headers = normalizeHeaders(req.headers);
  const rawBody = await req.text();
  const contentType = s(req.headers.get("content-type")).toLowerCase();
  const parsedBody =
    contentType.includes("application/json") && rawBody
      ? safeJsonParse(rawBody)
      : safeJsonParse(rawBody) || null;

  const {
    resourceURL,
    deliveryStatus,
    recipientAddress,
    callbackData,
    query,
  } = extractReceiptInfo(req, rawBody, parsedBody);

  console.info("[sms/delivery-receipt] start", {
    id,
    contentType: contentType || "unknown",
    userAgent: s(req.headers.get("user-agent")),
    resourceURL: short(resourceURL, 40),
    deliveryStatus,
    recipientAddress,
    callbackData: short(callbackData, 24),
  });

  const srv = getSupabaseServiceClient();

  let matchedQueue: QueueRow | null = null;

  if (resourceURL) {
    matchedQueue = await findMatchingQueueRowByResourceURL(srv, resourceURL);
  }

  if (matchedQueue) {
    const nextMeta = buildMergedMeta(
      matchedQueue.meta,
      buildReceiptPatch({
        runId: id,
        headers,
        rawBody,
        parsedBody,
        resourceURL,
        deliveryStatus,
        recipientAddress,
        callbackData,
        matchedQueueId: matchedQueue.id,
      })
    );

    const { error: updErr } = await srv
      .from("notifications_queue")
      .update({
        meta: nextMeta,
      } as any)
      .eq("id", matchedQueue.id);

    if (updErr) {
      console.error("[sms/delivery-receipt] queue_update_error", {
        id,
        queueId: matchedQueue.id,
        error: updErr.message,
      });
    } else {
      console.info("[sms/delivery-receipt] queue_update_ok", {
        id,
        queueId: matchedQueue.id,
        deliveryStatus,
        resourceURL: short(resourceURL, 40),
      });
    }
  } else {
    console.warn("[sms/delivery-receipt] queue_not_matched", {
      id,
      resourceURL: short(resourceURL, 40),
      deliveryStatus,
      recipientAddress,
      query,
    });
  }

  const ms = Date.now() - t0;

  console.info("[sms/delivery-receipt] done", {
    id,
    matchedQueueId: matchedQueue?.id || null,
    resourceURL: short(resourceURL, 40),
    deliveryStatus,
    recipientAddress,
    ms,
  });

  // Toujours 200 pour ne pas faire rejeter le callback Orange
  return NextResponse.json({
    ok: true,
    id,
    matchedQueueId: matchedQueue?.id || null,
    resourceURL: resourceURL || null,
    deliveryStatus: deliveryStatus || null,
    recipientAddress: recipientAddress || null,
    ms,
  });
}