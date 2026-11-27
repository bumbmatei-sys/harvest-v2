import { appendFile } from "node:fs/promises";

// C15b: where community email goes. Provider-neutral interface, a local test mailbox, and a live sender that is hard-disabled.
export type CommunityMail = { deliveryId: string; to: string; subject: string; text: string; headers: Record<string, string>; idempotencyKey: string; signal?: AbortSignal };
export type CommunityMailSender = (mail: CommunityMail) => Promise<void>;

// Intentionally not an environment toggle. A separate activation change and review are required (as for Connect invitations).
export const COMMUNITY_EMAIL_LIVE_DELIVERY = false;
export const sendLiveCommunityEmail: CommunityMailSender = async () => {
  throw new Error("COMMUNITY_EMAIL_DELIVERY_DISABLED");
};

/** Operator-invoked LOCAL mock mailbox: one JSON line per email. Never an application route and never a provider bypass. */
export function testMailboxSender(path: string): CommunityMailSender {
  return async (mail) => {
    await appendFile(path, `${JSON.stringify({ deliveryId: mail.deliveryId, to: mail.to, subject: mail.subject, text: mail.text, headers: mail.headers, idempotencyKey: mail.idempotencyKey })}\n`, { mode: 0o600 });
  };
}
