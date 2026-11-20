export const newsletterEvents = ["accepted", "delivered", "bounced", "complained", "unsubscribed"] as const;
export const callbackWindowMs = 24 * 60 * 60_000;
export const callbackClockSkewMs = 5 * 60_000;
export function callbackTimestampValid(timestamp: number, now: Date) {
  const age = now.getTime() - timestamp;
  return age >= -callbackClockSkewMs && age <= callbackWindowMs;
}

export type NewsletterEvent = {
  messageId: string;
  signedAt: Date;
  deliveryId: string;
  reference: string;
  type: typeof newsletterEvents[number];
  at: Date;
};
export type DomainStatus = { ownership: boolean; spf: boolean; dkim: boolean; bounce: boolean; dmarc: boolean };
export type DomainRecord = { purpose: "ownership" | "spf" | "dkim" | "bounce" | "dmarc"; type: "TXT" | "CNAME" | "MX";
  name: string; value: string };
export type NewsletterSubmission = {
  deliveryId: string;
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  preheader: string | null;
  html: string;
  text: string;
  headers: Record<string, string>;
};

export type SubmissionStatus = { state: "accepted"; reference: string } | { state: "failed" | "unknown" };
export interface NewsletterProvider {
  submit(message: NewsletterSubmission): Promise<SubmissionStatus>;
  verifyCallback(body: Uint8Array, headers: Headers, now: Date): NewsletterEvent | null;
  domain(domain: string, records: readonly DomainRecord[]): Promise<DomainStatus | null>;
}
