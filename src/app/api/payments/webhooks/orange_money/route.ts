// src/app/api/payments/webhooks/orange_money/route.ts
// Réception technique des notifications Orange Money.
// Cette route ne valide jamais manuellement un paiement : elle reçoit une confirmation opérateur,
// retrouve l'intention de paiement, puis délègue la génération du reçu officiel au service finance.
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { confirmOnlinePaymentAndCreateReceipt } from "@/lib/finance/receipt-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AnyRecord = Record<string, any>;

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

async function readPayload(req: NextRequest): Promise<AnyRecord> {
  const payload: AnyRecord = {};

  for (const [key, value] of req.nextUrl.searchParams.entries()) {
    payload[key] = value;
  }

  if (req.method !== "POST") return payload;

  const contentType = lower(req.headers.get("content-type"));
  const raw = await req.text().catch(() => "");
  if (!raw) return payload;

  if (contentType.includes("application/json")) {
    try {
      return { ...payload, ...(JSON.parse(raw) || {}) };
    } catch {
      payload.raw_body = raw;
      return payload;
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(raw);
    for (const [key, value] of form.entries()) payload[key] = value;
    return payload;
  }

  payload.raw_body = raw;
  return payload;
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

async function getAccountSecret(srv: ReturnType<typeof getSupabaseServiceClient>, accountId: string) {
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
  return ((data as AnyRecord)?.secret_config || {}) as AnyRecord;
}

function verifyWebhookSecret(req: NextRequest, payload: AnyRecord, secretConfig: AnyRecord) {
  const expected = firstClean(
    secretConfig.webhook_secret,
    secretConfig.orange_webhook_secret,
    process.env.ORANGE_MONEY_WEBPAY_WEBHOOK_SECRET,
  );

  if (!expected) return true;

  const received = firstClean(
    req.headers.get("x-orange-webhook-secret"),
    req.headers.get("x-webhook-secret"),
    req.headers.get("x-mon-cahier-orange-secret"),
    payload.webhook_secret,
    payload.secret,
    req.nextUrl.searchParams.get("secret"),
  );

  return received === expected;
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
  const payload = await readPayload(req);
  const srv = getSupabaseServiceClient();
  const { intent, error } = await resolveIntent(srv, payload);

  if (error || !intent) {
    return NextResponse.json({ ok: false, error: error || "Paiement introuvable." }, { status: 404 });
  }

  const secretConfig = await getAccountSecret(srv, clean(intent.account_id));
  if (!verifyWebhookSecret(req, payload, secretConfig)) {
    return NextResponse.json({ ok: false, error: "Signature ou secret Orange invalide." }, { status: 403 });
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
