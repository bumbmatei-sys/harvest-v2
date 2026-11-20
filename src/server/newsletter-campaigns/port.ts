export const newsletterEvents = ["accepted", "delivered", "bounced", "complained", "unsubscribed"] as const;
export type NewsletterEvent = {
  deliveryId: string;
  reference: string;
  type: typeof newsletterEvents[number];
  at: Date;
};
export type DomainStatus = { ownership: boolean; spf: boolean; dkim: boolean; bounce: boolean; dmarc: boolean };
export type DomainRecord = { purpose: "ownership" | "spf" | "dkim" | "bounce" | "dmarc"; type: "TXT" | "CNAME" | "MX";
  name: string; value: string; optional?: true };
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
