import { newsletterMissing } from "../newsletter-access";
import { FakeNewsletterProvider } from "./fake-provider";
import { PlunkNewsletterAdapter } from "./plunk-adapter";
import type { NewsletterCredential, NewsletterProvider } from "./port";

export const NEWSLETTER_INTEGRATION_ENABLED = false;
export const NEWSLETTER_SENDER_ENABLED = false;
export const NEWSLETTER_TRACKING_ENABLED = false;

export const defaultNewsletterProvider = (): NewsletterProvider => new PlunkNewsletterAdapter();

export type FakeNewsletterRuntime = {
  provider: FakeNewsletterProvider;
  credential: NewsletterCredential;
  callbackSecret: string;
  preferenceKey: Buffer;
  publicOrigin: string;
};

export function isFakeNewsletter(runtime: FakeNewsletterRuntime) {
  if (process.env.NODE_ENV !== "test" || !(runtime.provider instanceof FakeNewsletterProvider) ||
      runtime.preferenceKey.byteLength !== 32 || !runtime.credential.secret || !runtime.callbackSecret) return false;
  const origin = URL.parse(runtime.publicOrigin);
  return origin !== null && origin.protocol === "https:" && origin.hostname.endsWith(".test") && origin.origin === runtime.publicOrigin;
}

export function assertFakeNewsletter(runtime: FakeNewsletterRuntime) {
  if (!isFakeNewsletter(runtime)) throw newsletterMissing();
}
