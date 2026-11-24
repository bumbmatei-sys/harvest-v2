import { message } from "../i18n/messages";
import { syntheticCrmFormsKey } from "./crm-form-mode";

// The confirmation message for a hosted sign-up. No sender is wired: in synthetic test mode the message goes to an in-memory fake sink that the
// tests read back, and anywhere else nothing is delivered at all. The link carries the address and a single-use token; the token's digest is all
// the database keeps.
export type ConfirmationMessage = { to: string; subject: string; text: string; path: string; at: string };
const SINK = Symbol.for("harvest.newsletterConfirmationSink");
const MAX = 200;
const sink = () => ((globalThis as Record<symbol, ConfirmationMessage[] | undefined>)[SINK] ??= []);

export function confirmationPath(to: string, token: string) {
  return `/newsletter/confirm?${new URLSearchParams({ email: to, token }).toString()}`;
}

export function deliverNewsletterConfirmation({ to, token, ministryName, formTitle }: { to: string; token: string; ministryName: string | null; formTitle: string }) {
  if (!syntheticCrmFormsKey()) return false;
  const path = confirmationPath(to, token);
  const ministry = ministryName?.trim() || message("NewsletterForms.confirmationEmail.fallbackMinistry");
  const messages = sink();
  messages.push({ to, path, at: new Date().toISOString(), subject: message("NewsletterForms.confirmationEmail.subject", { ministry }),
    text: message("NewsletterForms.confirmationEmail.body", { ministry, form: formTitle, link: path }) });
  if (messages.length > MAX) messages.splice(0, messages.length - MAX);
  return true;
}

/** Test-only read of what the fake sink received; null outside synthetic mode. */
export function readConfirmationSink(to: string): ConfirmationMessage[] | null {
  if (!syntheticCrmFormsKey()) return null;
  return sink().filter((entry) => entry.to === to);
}
