import type { NewsletterProvider } from "./port";

export const LIVE_NEWSLETTER_ENABLED = false;

// Contract gaps keep all remote operations unavailable. This adapter has no transport.
export const plunkAdapter: NewsletterProvider = {
  async submit() { return { state: "failed" }; },
  async status() { return { state: "unknown" }; },
  verifyCallback() { return null; },
  async domain() { return null; },
  async quota() { return null; },
};
