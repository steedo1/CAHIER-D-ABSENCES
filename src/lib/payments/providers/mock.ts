import type { InitiatePaymentInput, InitiatePaymentResult, PaymentProviderAdapter } from "./types";

export class MockPaymentProvider implements PaymentProviderAdapter {
  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const baseUrl =
      input.returnUrl?.split("/parents/payments")[0] ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      "";

    return {
      status: "pending",
      providerReference: `MOCK-${input.clientReference}`,
      checkoutUrl: baseUrl ? `${baseUrl}/parents/payments?intent=${encodeURIComponent(input.intentId)}` : null,
      rawPayload: {
        mode: "mock",
        amount: input.amount,
        currency: input.currency,
        payer_phone: input.payerPhone || null,
        description: input.description,
      },
    };
  }
}
