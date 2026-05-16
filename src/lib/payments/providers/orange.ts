import type { InitiatePaymentInput, InitiatePaymentResult, PaymentProviderAdapter } from "./types";

export class OrangeMoneyProvider implements PaymentProviderAdapter {
  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const secret = input.account.secretConfig || {};
    const merchantId = input.account.merchantId || secret.merchant_id || "";

    if (!merchantId) {
      return {
        status: "failed",
        providerReference: null,
        checkoutUrl: null,
        errorMessage: "Compte Orange Money marchand non configuré pour cet établissement.",
        rawPayload: { reason: "missing_orange_merchant_id" },
      };
    }

    return {
      status: "failed",
      providerReference: null,
      checkoutUrl: null,
      errorMessage:
        "Orange Money est prêt côté Mon Cahier, mais l’activation API réelle doit être finalisée avec les clés Orange.",
      rawPayload: {
        reason: "orange_provider_not_connected_yet",
        merchant_id: merchantId,
        amount: input.amount,
        currency: input.currency,
      },
    };
  }
}
