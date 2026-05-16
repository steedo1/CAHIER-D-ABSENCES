// src/app/api/payments/webhooks/mock/route.ts
// Webhook interne pour les tests. Ne pas utiliser pour un vrai paiement Mobile Money.
import { NextRequest, NextResponse } from "next/server";
import { confirmOnlinePaymentAndCreateReceipt } from "@/lib/finance/receipt-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (process.env.ONLINE_PAYMENTS_MOCK_ENABLED !== "1") {
    return NextResponse.json(
      { error: "Le webhook de test est désactivé." },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const intentId = String(body.intent_id || body.intentId || "").trim();

  if (!intentId) {
    return NextResponse.json({ error: "intent_id manquant." }, { status: 400 });
  }

  try {
    const result = await confirmOnlinePaymentAndCreateReceipt({
      intentId,
      providerReference: String(body.provider_reference || "") || null,
      providerTransactionId:
        String(body.provider_transaction_id || body.transaction_id || "") ||
        `MOCK-TX-${Date.now()}`,
      rawProviderPayload: body,
      req,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
