import type { InitiatePaymentInput, InitiatePaymentResult, PaymentProviderAdapter } from "./types";

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export class OrangeMoneyProvider implements PaymentProviderAdapter {
  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const secret = input.account.secretConfig || {};
    const merchantId = clean(input.account.merchantId || secret.merchant_id || secret.merchant_id_or_code);
    const merchantPhone = clean(input.account.merchantPhone || secret.merchant_phone);
    const enabled = process.env.ORANGE_MONEY_WEBPAY_ENABLED === "1";

    if (!merchantId && !merchantPhone) {
      return {
        status: "failed",
        providerReference: null,
        checkoutUrl: null,
        errorMessage: "Compte Orange Money marchand non configuré pour cet établissement.",
        rawPayload: { reason: "missing_orange_merchant_account" },
      };
    }

    if (!enabled) {
      if (input.account.environment === "production") {
        return {
          status: "failed",
          providerReference: null,
          checkoutUrl: null,
          errorMessage:
            "Orange Money réel n’est pas encore activé côté Mon Cahier. Passez d’abord le compte en mode test ou finalisez les clés Orange.",
          rawPayload: {
            reason: "orange_real_provider_disabled",
            merchant_id: merchantId || null,
            merchant_phone: merchantPhone || null,
          },
        };
      }

      return {
        status: "pending",
        providerReference: `OM-TEST-${input.clientReference}`,
        checkoutUrl: null,
        rawPayload: {
          mode: "internal_test_pending",
          reason: "orange_webpay_not_connected_yet",
          merchant_id: merchantId || null,
          merchant_phone: merchantPhone || null,
          amount: input.amount,
          currency: input.currency,
          payer_phone: input.payerPhone || null,
          description: input.description,
        },
      };
    }

    return {
      status: "failed",
      providerReference: null,
      checkoutUrl: null,
      errorMessage:
        "Le branchement Orange Money réel doit être complété avec la documentation officielle Orange avant mise en production.",
      rawPayload: {
        reason: "orange_real_provider_not_implemented_yet",
        merchant_id: merchantId || null,
        merchant_phone: merchantPhone || null,
        amount: input.amount,
        currency: input.currency,
      },
    };
  }
}
