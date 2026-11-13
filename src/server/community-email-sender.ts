import { appendFile } from "node:fs/promises";
import { Resend } from "resend";
import { requiredEnv } from "../lib/env";

// C15b: where community email goes. Provider-neutral interface, a local test mailbox, and a live sender that is hard-disabled.
export type CommunityMail = { to: string; subject: string; text: string; headers: Record<string, string>; idempotencyKey: string; signal?: AbortSignal };
export type CommunityMailSender = (mail: CommunityMail) => Promise<void>;

// Intentionally not an environment toggle. A separate activation change and review are required (as for Connect invitations).
export const COMMUNITY_EMAIL_LIVE_DELIVERY = false;
export const sendLiveCommunityEmail: CommunityMailSender = async (mail) => {
  if (!COMMUNITY_EMAIL_LIVE_DELIVERY) throw new Error("COMMUNITY_EMAIL_DELIVERY_DISABLED");
  const { error } = await new Resend(requiredEnv("RESEND_API_KEY")).emails.send(
    { from: requiredEnv("EMAIL_FROM"), to: mail.to, subject: mail.subject, text: mail.text, headers: mail.headers },
    { idempotencyKey: mail.idempotencyKey, signal: mail.signal });
  if (error) throw new Error("COMMUNITY_EMAIL_SEND_FAILED");
};

/** Operator-invoked LOCAL mock mailbox: one JSON line per email. Never an application route and never a provider bypass. */
export function testMailboxSender(path: string): CommunityMailSender {
  return async (mail) => {
    await appendFile(path, `${JSON.stringify({ to: mail.to, subject: mail.subject, text: mail.text, headers: mail.headers, idempotencyKey: mail.idempotencyKey })}\n`, { mode: 0o600 });
  };
}
