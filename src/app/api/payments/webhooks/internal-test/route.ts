// src/app/api/payments/webhooks/internal-test/route.ts
// Route technique de test : simule la confirmation d’un opérateur Mobile Money.
// Elle n'est pas utilisée par les écoles ni affichée dans l'interface admin.
import { NextRequest, NextResponse } from "next/server";
import { confirmOnlinePaymentAndCreateReceipt } from "@/lib/finance/receipt-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(req: NextRequest) {
  if (process.env.ONLINE_PAYMENTS_INTERNAL_TEST_CONFIRM_ENABLED !== "1") {
    return NextResponse.json(
      { error: "Confirmation interne de test désactivée." },
      { status: 403 },
    );
  }

  const expectedSecret = clean(process.env.ONLINE_PAYMENTS_INTERNAL_TEST_SECRET);
  if (expectedSecret) {
    const receivedSecret =
      clean(req.headers.get("x-mon-cahier-payment-test-secret")) ||
      clean(req.nextUrl.searchParams.get("secret"));

    if (receivedSecret !== expectedSecret) {
      return NextResponse.json({ error: "Secret de test invalide." }, { status: 403 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const intentId = clean(body.intent_id || body.intentId);
  if (!intentId) {
    return NextResponse.json({ error: "intent_id manquant." }, { status: 400 });
  }

  try {
    const result = await confirmOnlinePaymentAndCreateReceipt({
      intentId,
      providerReference: clean(body.provider_reference) || `TEST-REF-${intentId.slice(0, 8)}`,
      providerTransactionId:
        clean(body.provider_transaction_id || body.transaction_id) || `TEST-TX-${Date.now()}`,
      rawProviderPayload: {
        mode: "internal_test_confirmed",
        received_at: new Date().toISOString(),
        ...body,
      },
      req,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
