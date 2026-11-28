import { createHash } from "node:crypto";
import type { MinistryPaymentKind } from "../../lib/ministry-payments";

export type PaymentProviderIdentity = "fake" | "stripe_connect";
export type AccountStatus = { chargesEnabled: boolean; payoutsEnabled: boolean; requirementsDue: string[] };
type DirectCharge = {
  accountId: string;
  intentId: string;
  idempotencyKey: string;
  kind: MinistryPaymentKind;
  cadence: "once" | "monthly";
  amountMinor: bigint;
  applicationFeeMinor: bigint;
  currency: string;
};

export interface MinistryPaymentProvider {
  readonly identity: PaymentProviderIdentity;
  onboarding(input: { tenantId: string; idempotencyKey: string; country: string; currency: string }):
    Promise<{ accountId: string; url: string }>;
  accountStatus(accountId: string): Promise<AccountStatus>;
  disconnect(accountId: string): Promise<void>;
  createDirectCharge(input: DirectCharge): Promise<{ checkoutUrl: string }>;
  subscriptionPortal(accountId: string, intentId: string, idempotencyKey: string): Promise<{ portalUrl: string }>;
}

function fakeLink(path: string, key: string) {
  const token = createHash("sha256").update(key).digest("hex");
  return `https://payments.example.invalid/${path}/${token}`;
}

export const fakeConnectedAccountId = (tenantId: string) => `acct_fake_${tenantId.replaceAll("-", "")}`;

export const fakePaymentProvider: MinistryPaymentProvider = {
  identity: "fake",
  async onboarding({ tenantId, idempotencyKey }) {
    const accountId = fakeConnectedAccountId(tenantId);
    return { accountId, url: fakeLink("onboarding", `${accountId}:${idempotencyKey}`) };
  },
  async accountStatus() {
    return { chargesEnabled: true, payoutsEnabled: true, requirementsDue: [] };
  },
  async disconnect() {},
  async createDirectCharge({ accountId, idempotencyKey, cadence }) {
    return { checkoutUrl: fakeLink(cadence === "monthly" ? "subscription" : "checkout", `${accountId}:${idempotencyKey}`) };
  },
  async subscriptionPortal(accountId, intentId, idempotencyKey) {
    return { portalUrl: fakeLink("manage", `${accountId}:${intentId}:${idempotencyKey}`) };
  },
};

export const CONNECT_LIVE_ENABLED: boolean = false;
export const CONNECT_WEBHOOK_SECRET = "STRIPE_CONNECT_WEBHOOK_SECRET";

async function connectDisabled(): Promise<never> {
  throw new Error("MINISTRY_PAYMENTS_DISABLED");
}

/** Standard accounts, direct charges. Live transport stays unavailable pending the platform and launch gates. */
export const stripeConnectAdapter: MinistryPaymentProvider = {
  identity: "stripe_connect",
  onboarding: connectDisabled,
  accountStatus: connectDisabled,
  disconnect: connectDisabled,
  createDirectCharge: connectDisabled,
  subscriptionPortal: connectDisabled,
};

export function syntheticMinistryPayments() {
  return process.env.NODE_ENV !== "production" && process.env.HARVEST_SYNTHETIC_MINISTRY_PAYMENTS === "1";
}
