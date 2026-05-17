// src/app/api/parent/payments/initiate/route.ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseServiceClient } from "@/lib/supabaseAdmin";
import { getPaymentProvider } from "@/lib/payments/providers";
import type { OnlinePaymentProvider, PaymentAccountConfig } from "@/lib/payments/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rid() {
  return Math.random().toString(36).slice(2, 8);
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizePhone(value: unknown) {
  const raw = clean(value).replace(/\s+/g, "");
  if (!raw) return "";
  if (raw.startsWith("+")) return raw;
  if (raw.startsWith("225")) return `+${raw}`;
  if (/^0\d{9}$/.test(raw)) return `+225${raw.slice(1)}`;
  if (/^\d{10}$/.test(raw)) return `+225${raw}`;
  return raw;
}

function money(value: number | string | null | undefined) {
  return `${Number(value || 0).toLocaleString("fr-FR")} F`;
}

function isSupportedProvider(value: string): value is OnlinePaymentProvider {
  return ["orange_money", "wave", "mtn_momo", "mock"].includes(value);
}

async function parentCanAccessStudent(deviceId: string, studentId: string) {
  const srv = getSupabaseServiceClient();
  const { data, error } = await srv
    .from("parent_device_children")
    .select("student_id")
    .eq("device_id", deviceId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean(data?.student_id);
}

function pendingMessage(provider: OnlinePaymentProvider, rawPayload: Record<string, any> | null | undefined) {
  if (rawPayload?.mode === "internal_test_pending") {
    return "Paiement enregistré en attente. Aucun reçu officiel ne sera créé avant confirmation de l’opérateur.";
  }
  if (provider === "orange_money") {
    return "Paiement Orange Money initialisé. Validez l’opération selon les instructions de l’opérateur.";
  }
  return "Paiement initialisé. Validez maintenant sur votre téléphone.";
}

export async function POST(req: NextRequest) {
  const trace = rid();
  const srv = getSupabaseServiceClient();

  try {
    const jar = await cookies();
    const deviceId = jar.get("parent_device")?.value || "";
    if (!deviceId) {
      return NextResponse.json({ error: "Session parent introuvable." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const studentId = clean(body.student_id);
    const chargeId = clean(body.charge_id);
    const providerValue = clean(body.provider);
    const payerName = clean(body.payer_name);
    const payerPhone = normalizePhone(body.payer_phone);
    const amount = Number(body.amount || 0);

    if (!studentId) return NextResponse.json({ error: "Élève manquant." }, { status: 400 });
    if (!chargeId) return NextResponse.json({ error: "Frais à payer manquant." }, { status: 400 });
    if (!providerValue || !isSupportedProvider(providerValue)) {
      return NextResponse.json({ error: "Moyen de paiement invalide." }, { status: 400 });
    }
    if (!payerPhone) return NextResponse.json({ error: "Numéro Mobile Money obligatoire." }, { status: 400 });
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Montant invalide." }, { status: 400 });
    }

    const provider = providerValue;
    const canAccess = await parentCanAccessStudent(deviceId, studentId);
    if (!canAccess) {
      return NextResponse.json({ error: "Vous ne pouvez pas payer pour cet élève." }, { status: 403 });
    }

    const { data: charge, error: chargeErr } = await srv
      .schema("finance")
      .from("v_charge_balances")
      .select("id,school_id,student_id,class_id,label,balance_due,computed_status")
      .eq("id", chargeId)
      .eq("student_id", studentId)
      .maybeSingle();

    if (chargeErr) {
      console.error(`[parent.payments.initiate:${trace}] charge`, chargeErr);
      return NextResponse.json({ error: chargeErr.message }, { status: 400 });
    }
    if (!charge) return NextResponse.json({ error: "Frais introuvable." }, { status: 404 });

    const balanceDue = Number((charge as any).balance_due || 0);
    if (balanceDue <= 0) {
      return NextResponse.json({ error: "Ce frais est déjà soldé." }, { status: 400 });
    }
    if (amount > balanceDue) {
      return NextResponse.json(
        { error: `Le montant dépasse le reste dû (${money(balanceDue)}).` },
        { status: 400 },
      );
    }

    const schoolId = String((charge as any).school_id || "");
    const classId = String((charge as any).class_id || "") || null;

    const { data: account, error: accountErr } = await srv
      .schema("finance")
      .from("institution_payment_accounts")
      .select("id,school_id,provider,merchant_id,merchant_phone,environment,is_active,public_config,secret_config")
      .eq("school_id", schoolId)
      .eq("provider", provider)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (accountErr) {
      console.error(`[parent.payments.initiate:${trace}] account`, accountErr);
      return NextResponse.json({ error: accountErr.message }, { status: 400 });
    }
    if (!account) {
      return NextResponse.json(
        { error: "Paiement en ligne non configuré pour cet établissement." },
        { status: 400 },
      );
    }

    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();

    const { data: intent, error: intentErr } = await srv
      .schema("finance")
      .from("online_payment_intents")
      .insert({
        school_id: schoolId,
        student_id: studentId,
        class_id: classId,
        student_charge_id: chargeId,
        account_id: (account as any).id,
        amount,
        currency: "XOF",
        provider,
        status: "initiated",
        payer_name: payerName || null,
        payer_phone: payerPhone,
        expires_at: expiresAt,
        created_at: nowIso,
        updated_at: nowIso,
      } as any)
      .select("id,client_reference")
      .single();

    if (intentErr) {
      console.error(`[parent.payments.initiate:${trace}] intent`, intentErr);
      return NextResponse.json({ error: intentErr.message }, { status: 400 });
    }

    const origin = req.nextUrl.origin;
    const intentId = String((intent as any).id);
    const clientReference = String((intent as any).client_reference);
    const webhookProviderPath = provider === "orange_money" ? "orange_money" : provider;
    const callback = new URL(`${origin}/api/payments/webhooks/${webhookProviderPath}`);
    callback.searchParams.set("intent_id", intentId);
    callback.searchParams.set("client_reference", clientReference);

    const accountSecretConfig = ((account as any).secret_config || {}) as Record<string, any>;
    const accountWebhookSecret = String(
      accountSecretConfig.webhook_secret ||
        accountSecretConfig.orange_webhook_secret ||
        accountSecretConfig.webpay_webhook_secret ||
        "",
    ).trim();
    if (provider === "orange_money" && accountWebhookSecret) {
      callback.searchParams.set("secret", accountWebhookSecret);
    }

    const callbackUrl = callback.toString();
    const returnUrl = `${origin}/parents/payments?intent=${encodeURIComponent(intentId)}`;

    const providerAdapter = getPaymentProvider(provider);
    const result = await providerAdapter.initiate({
      intentId,
      clientReference,
      amount,
      currency: "XOF",
      payerName: payerName || null,
      payerPhone,
      description: String((charge as any).label || "Frais scolaire"),
      account: {
        id: String((account as any).id),
        schoolId,
        provider,
        environment: ((account as any).environment || "test") as "test" | "production",
        merchantId: (account as any).merchant_id || null,
        merchantPhone: (account as any).merchant_phone || null,
        publicConfig: ((account as any).public_config || {}) as Record<string, any>,
        secretConfig: ((account as any).secret_config || {}) as Record<string, any>,
      } satisfies PaymentAccountConfig,
      callbackUrl,
      returnUrl,
    });

    const nextStatus = result.status === "pending" ? "pending" : "failed";
    const { error: updateErr } = await srv
      .schema("finance")
      .from("online_payment_intents")
      .update({
        status: nextStatus,
        provider_reference: result.providerReference,
        checkout_url: result.checkoutUrl,
        raw_provider_payload: result.rawPayload || {},
        error_message: result.errorMessage || null,
        failed_at: nextStatus === "failed" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", (intent as any).id);

    if (updateErr) {
      console.error(`[parent.payments.initiate:${trace}] update`, updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 400 });
    }

    if (nextStatus === "failed") {
      return NextResponse.json(
        { error: result.errorMessage || "Impossible de démarrer le paiement." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      intent_id: String((intent as any).id),
      status: nextStatus,
      provider_reference: result.providerReference,
      checkout_url: result.checkoutUrl,
      message: pendingMessage(provider, result.rawPayload),
    });
  } catch (e: any) {
    console.error(`[parent.payments.initiate:${trace}] fatal`, e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
