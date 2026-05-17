// src/app/api/payments/webhooks/orange_money/route.ts
// Réception sécurisée des notifications Orange Money.
// Règle stricte : une notification opérateur ne peut jamais confirmer un paiement sans secret/signature.
import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { confirmOnlinePaymentAndCreateReceipt } from "@/lib/finance/receipt-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyRecord = Record<string, any>;

type ParsedPayload = {
  payload: AnyRecord;
  rawBody: string;
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function firstClean(...values: unknown[]) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return "";
}

function lower(value: unknown) {
  return clean(value).toLowerCase();
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a || "", "utf8");
  const right = Buffer.from(b || "", "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function hmacHex(rawBody: string, secret: string) {
  return createHmac("sha256", secret).update(rawBody || "").digest("hex");
}

function normalizeSignature(value: unknown) {
  const text = clean(value);
  return text.replace(/^sha256=/i, "").replace(/^hmac-sha256=/i, "").trim();
}

async function readPayload(req: NextRequest): Promise<ParsedPayload> {
  const payload: AnyRecord = {};

  for (const [key, value] of req.nextUrl.searchParams.entries()) {
    payload[key] = value;
  }

  if (req.method !== "POST") {
    return { payload, rawBody: "" };
  }

  const contentType = lower(req.headers.get("content-type"));
  const rawBody = await req.text().catch(() => "");
  if (!rawBody) return { payload, rawBody };

  if (contentType.includes("application/json")) {
    try {
      return { payload: { ...payload, ...(JSON.parse(rawBody) || {}) }, rawBody };
    } catch {
      return { payload: { ...payload, raw_body: rawBody }, rawBody };
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(rawBody);
    for (const [key, value] of form.entries()) payload[key] = value;
    return { payload, rawBody };
  }

  return { payload: { ...payload, raw_body: rawBody }, rawBody };
}

function extractIntentId(payload: AnyRecord) {
  return firstClean(payload.intent_id, payload.intentId, payload.mon_cahier_intent_id, payload.mc_intent_id);
}

function extractClientReference(payload: AnyRecord) {
  return firstClean(
    payload.client_reference,
    payload.clientReference,
    payload.order_id,
    payload.orderId,
    payload.reference,
    payload.ref,
  );
}

function extractProviderReference(payload: AnyRecord) {
  return firstClean(
    payload.provider_reference,
    payload.providerReference,
    payload.pay_token,
    payload.payToken,
    payload.payment_token,
    payload.transaction_reference,
    payload.reference,
    payload.ref,
  );
}

function extractProviderTransactionId(payload: AnyRecord) {
  return firstClean(
    payload.provider_transaction_id,
    payload.transaction_id,
    payload.transactionId,
    payload.txn_id,
    payload.txnid,
    payload.id_transaction,
    payload.idTransaction,
  );
}

function statusKind(payload: AnyRecord): "success" | "failed" | "cancelled" | "unknown" {
  const value = lower(
    firstClean(
      payload.status,
      payload.payment_status,
      payload.transaction_status,
      payload.txn_status,
      payload.result,
      payload.state,
      payload.paymentStatus,
    ),
  );

  if (["success", "succeeded", "successful", "paid", "completed", "complete", "ok", "200"].includes(value)) {
    return "success";
  }
  if (["failed", "failure", "error", "ko", "declined", "rejected", "refused"].includes(value)) {
    return "failed";
  }
  if (["cancelled", "canceled", "cancel", "aborted"].includes(value)) {
    return "cancelled";
  }

  return "unknown";
}

async function resolveIntent(srv: ReturnType<typeof getSupabaseServiceClient>, payload: AnyRecord) {
  const intentId = extractIntentId(payload);
  const clientReference = extractClientReference(payload);
  const providerReference = extractProviderReference(payload);

  let query = srv
    .schema("finance")
    .from("online_payment_intents")
    .select(
      "id,school_id,account_id,provider,status,receipt_id,client_reference,provider_reference,raw_provider_payload",
    )
    .eq("provider", "orange_money")
    .limit(1);

  if (intentId) query = query.eq("id", intentId);
  else if (clientReference) query = query.eq("client_reference", clientReference);
  else if (providerReference) query = query.eq("provider_reference", providerReference);
  else return { intent: null, error: "Référence de paiement Orange introuvable." };

  const { data, error } = await query.maybeSingle();
  if (error) return { intent: null, error: error.message };
  if (!data) return { intent: null, error: "Intention de paiement Orange introuvable." };
  return { intent: data as AnyRecord, error: "" };
}

async function getAccountConfig(srv: ReturnType<typeof getSupabaseServiceClient>, accountId: string) {
  if (!accountId) return {} as AnyRecord;
  const { data, error } = await srv
    .schema("finance")
    .from("institution_payment_accounts")
    .select("id,environment,secret_config")
    .eq("id", accountId)
    .maybeSingle();

  if (error) {
    console.warn("[orange webhook account]", error.message);
    return {} as AnyRecord;
  }
  return (data || {}) as AnyRecord;
}

function getExpectedSecret(secretConfig: AnyRecord) {
  return firstClean(
    secretConfig.webhook_secret,
    secretConfig.orange_webhook_secret,
    secretConfig.webpay_webhook_secret,
    process.env.ORANGE_MONEY_WEBPAY_WEBHOOK_SECRET,
  );
}

function verifyWebhookSecret(req: NextRequest, payload: AnyRecord, rawBody: string, accountConfig: AnyRecord) {
  const secretConfig = ((accountConfig || {}).secret_config || {}) as AnyRecord;
  const expected = getExpectedSecret(secretConfig);

  if (!expected) {
    return {
      ok: false,
      error:
        "Webhook Orange non sécurisé : aucun secret n’est configuré pour ce compte marchand. Confirmation refusée.",
    };
  }

  const receivedToken = firstClean(
    req.headers.get("x-orange-webhook-secret"),
    req.headers.get("x-webhook-secret"),
    req.headers.get("x-mon-cahier-orange-secret"),
    payload.webhook_secret,
    payload.secret,
    req.nextUrl.searchParams.get("secret"),
  );

  if (receivedToken && safeEqual(receivedToken, expected)) {
    return { ok: true, error: "" };
  }

  const receivedSignature = normalizeSignature(
    firstClean(
      req.headers.get("x-orange-signature"),
      req.headers.get("x-webhook-signature"),
      req.headers.get("x-mon-cahier-orange-signature"),
      payload.signature,
      payload.hmac,
    ),
  );

  if (receivedSignature && rawBody) {
    const computed = hmacHex(rawBody, expected);
    if (safeEqual(receivedSignature, computed)) {
      return { ok: true, error: "" };
    }
  }

  return { ok: false, error: "Signature ou secret Orange invalide." };
}

async function markAsFailed(
  srv: ReturnType<typeof getSupabaseServiceClient>,
  intent: AnyRecord,
  payload: AnyRecord,
  status: "failed" | "cancelled",
) {
  const nowIso = new Date().toISOString();
  const mergedPayload = {
    ...((intent.raw_provider_payload || {}) as AnyRecord),
    orange_webhook: payload,
    orange_webhook_received_at: nowIso,
  };

  const { error } = await srv
    .schema("finance")
    .from("online_payment_intents")
    .update({
      status,
      provider_reference: extractProviderReference(payload) || intent.provider_reference || null,
      provider_transaction_id: extractProviderTransactionId(payload) || null,
      raw_provider_payload: mergedPayload,
      failed_at: nowIso,
      updated_at: nowIso,
      error_message:
        status === "cancelled"
          ? "Paiement annulé par l’opérateur."
          : "Paiement refusé ou échoué chez l’opérateur.",
    } as any)
    .eq("id", intent.id)
    .eq("provider", "orange_money")
    .is("receipt_id", null)
    .in("status", ["initiated", "pending"]);

  if (error) throw new Error(error.message);
}

async function handleOrangeWebhook(req: NextRequest) {
  const { payload, rawBody } = await readPayload(req);
  const srv = getSupabaseServiceClient();
  const { intent, error } = await resolveIntent(srv, payload);

  if (error || !intent) {
    return NextResponse.json({ ok: false, error: error || "Paiement introuvable." }, { status: 404 });
  }

  const accountConfig = await getAccountConfig(srv, clean(intent.account_id));
  const auth = verifyWebhookSecret(req, payload, rawBody, accountConfig);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: 403 });
  }

  const kind = statusKind(payload);

  if (kind === "success") {
    const result = await confirmOnlinePaymentAndCreateReceipt({
      intentId: clean(intent.id),
      providerReference: extractProviderReference(payload) || clean(intent.provider_reference) || null,
      providerTransactionId: extractProviderTransactionId(payload) || null,
      rawProviderPayload: {
        ...((intent.raw_provider_payload || {}) as AnyRecord),
        orange_webhook: payload,
        orange_webhook_received_at: new Date().toISOString(),
      },
      req,
    });

    return NextResponse.json({ ok: true, status: "succeeded", ...result });
  }

  if (kind === "failed" || kind === "cancelled") {
    await markAsFailed(srv, intent, payload, kind);
    return NextResponse.json({ ok: true, status: kind });
  }

  return NextResponse.json({
    ok: true,
    status: "ignored",
    message: "Notification Orange reçue, mais statut non conclusif. Aucun reçu n’a été créé.",
  });
}

export async function POST(req: NextRequest) {
  try {
    return await handleOrangeWebhook(req);
  } catch (e: any) {
    console.error("[payments.webhooks.orange_money]", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    return await handleOrangeWebhook(req);
  } catch (e: any) {
    console.error("[payments.webhooks.orange_money.get]", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
