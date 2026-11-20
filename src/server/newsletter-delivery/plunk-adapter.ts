import type { NewsletterProvider } from "./port";

export const PLUNK_NEWSLETTER_LIVE_NETWORK = false;

// The live wire contract needs sandbox verification for signing, idempotency and reconciliation.
export class PlunkNewsletterAdapter implements NewsletterProvider {
  async verifySender() { return false; }
  async deliver() { return { outcome: "failed" } as const; }
  async reconcile() { return { outcome: "unknown" } as const; }
  verifyCallback() { return null; }
}
