export type OnlinePaymentProvider = "orange_money" | "wave" | "mtn_momo" | "mock";

export type PaymentAccountConfig = {
  id: string;
  schoolId: string;
  provider: OnlinePaymentProvider;
  environment: "test" | "production";
  merchantId?: string | null;
  merchantPhone?: string | null;
  publicConfig?: Record<string, any> | null;
  secretConfig?: Record<string, any> | null;
};

export type InitiatePaymentInput = {
  intentId: string;
  clientReference: string;
  amount: number;
  currency: string;
  payerName?: string | null;
  payerPhone?: string | null;
  description: string;
  account: PaymentAccountConfig;
  callbackUrl?: string | null;
  returnUrl?: string | null;
};

export type InitiatePaymentResult = {
  providerReference: string | null;
  checkoutUrl: string | null;
  rawPayload: Record<string, any>;
  status: "pending" | "failed";
  errorMessage?: string | null;
};

export type PaymentProviderAdapter = {
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
};
