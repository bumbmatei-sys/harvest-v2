export const newsletterEvents = ["accepted", "delivered", "bounced", "complained", "unsubscribed"] as const;
export type NewsletterEvent = { reference: string; type: typeof newsletterEvents[number]; at: Date };
export type DomainStatus = { ownership: boolean; spf: boolean; dkim: boolean; dmarc: boolean };
export type NewsletterSubmission = {
  idempotencyKey: string;
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
  status(idempotencyKey: string): Promise<SubmissionStatus>;
  verifyCallback(body: Uint8Array, headers: Headers, now: Date): NewsletterEvent | null;
  domain(address: string): Promise<DomainStatus | null>;
  quota(): Promise<{ remaining: number; resetsAt: Date } | null>;
}
