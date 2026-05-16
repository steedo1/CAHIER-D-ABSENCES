import { MockPaymentProvider } from "./mock";
import { OrangeMoneyProvider } from "./orange";
import type { OnlinePaymentProvider, PaymentProviderAdapter } from "./types";

export function getPaymentProvider(provider: OnlinePaymentProvider): PaymentProviderAdapter {
  if (provider === "mock") return new MockPaymentProvider();
  if (provider === "orange_money") return new OrangeMoneyProvider();

  return {
    async initiate() {
      return {
        status: "failed" as const,
        providerReference: null,
        checkoutUrl: null,
        errorMessage: "Ce moyen de paiement n’est pas encore activé.",
        rawPayload: { reason: "provider_not_implemented", provider },
      };
    },
  };
}
