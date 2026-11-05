import { message } from "../i18n/messages";
// ADR 0005: contract only. No provider client, secret access, or network requests.
export interface PaymentsAdapter {
  createCheckout(input: { tenantId: string; priceId: string; returnUrl: string }): Promise<{ url: string }>;
}
export const payments: PaymentsAdapter = {
  async createCheckout() { throw new Error(message("Errors.paymentsAreNotAvailableYet")); },
};
