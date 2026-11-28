import { z } from "zod";
import { centsInput, fundraisingCurrencies, idempotencyKeyInput } from "./fundraising";

const feeBasisPoints = Object.freeze({ donation: 0n, sale: 300n });
export type MinistryPaymentKind = keyof typeof feeBasisPoints;
export function ministryApplicationFee(kind: MinistryPaymentKind, amountMinor: bigint) {
  return amountMinor * feeBasisPoints[kind] / 10_000n;
}

export const paymentPolicy = Object.freeze({
  donorCoversFee: false,
  giftAid: false,
  paymentCountries: [] as readonly string[],
  feeRounding: "down",
  refundRequests: false,
  breachLogAccess: false,
});

export const paymentCurrency = z.enum(fundraisingCurrencies);
export const checkoutInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("donation"), requestKey: idempotencyKeyInput, cadence: z.enum(["once", "monthly"]).default("once"), amountMinor: centsInput }),
  z.strictObject({ kind: z.literal("sale"), requestKey: idempotencyKeyInput, itemId: z.uuid() }),
]);

export const paymentAccountAction = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("connect"), requestKey: idempotencyKeyInput, legalName: z.string().trim().min(1).max(200),
    currency: paymentCurrency, country: z.string().regex(/^[A-Z]{2}$/) }),
  z.strictObject({ action: z.enum(["sync", "disconnect"]) }),
  z.strictObject({ action: z.literal("price"), itemId: z.uuid(), amountMinor: centsInput, currency: paymentCurrency }),
]);
