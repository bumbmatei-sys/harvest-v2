export const deliveryOutcomes = ["delivered", "opened", "clicked", "bounced", "complained", "unsubscribed"] as const;
export type DeliveryOutcome = typeof deliveryOutcomes[number];

export type NewsletterCredential = { secret: string };
export type NewsletterMessage = {
  tenantId: string;
  key: string;
  recipient: string;
  sender: { name: string; email: string; replyTo: string };
  subject: string;
  previewText: string;
  html: string;
  text: string;
  links: ReadonlyMap<number, string>;
  unsubscribe: string;
  trackOpens: false;
  trackClicks: false;
};
export type NewsletterReceipt = { outcome: "accepted"; providerId: string };
export type DeliveryResult = NewsletterReceipt | { outcome: "retry" | "failed" | "unknown" };
export type ReconciliationResult = NewsletterReceipt | { outcome: "absent" | "unknown" };
export type NewsletterEvent = {
  tenantId: string;
  id: string;
  deliveryId: string;
  providerId: string;
  outcome: DeliveryOutcome;
  linkId?: number;
  occurredAt: string;
};

export interface NewsletterProvider {
  verifySender(credential: NewsletterCredential, domain: string): Promise<boolean>;
  deliver(credential: NewsletterCredential, message: NewsletterMessage): Promise<DeliveryResult>;
  reconcile(credential: NewsletterCredential, tenantId: string, key: string): Promise<ReconciliationResult>;
  verifyCallback(raw: Uint8Array, signature: string | null, secret: string): NewsletterEvent | null;
}
