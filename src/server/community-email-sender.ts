import { appendFile } from "node:fs/promises";
import { StagingEmailRefused, submitStagingEmail } from "./staging-email-transport";

// C15b: where community email goes. Provider-neutral interface, a local test mailbox, and a live sender that is hard-disabled.
export type CommunityMail = { to: string; subject: string; text: string; headers: Record<string, string>; idempotencyKey: string; deliveryId?: string; signal?: AbortSignal };
export type CommunityMailSender = (mail: CommunityMail) => Promise<void>;

// Automatic live community jobs stay disabled pending the feedback integration.
export const COMMUNITY_EMAIL_LIVE_DELIVERY = false;

export function createStagingCommunitySender(env: Record<string, string | undefined>, transport?: typeof fetch): CommunityMailSender {
  return async ({ idempotencyKey, deliveryId = idempotencyKey, ...mail }) => {
    try {
      await submitStagingEmail(env, { ...mail, deliveryId }, transport);
    } catch (error) {
      if (error instanceof StagingEmailRefused) throw new Error("COMMUNITY_EMAIL_DELIVERY_DISABLED");
      throw new Error("COMMUNITY_EMAIL_SEND_FAILED");
    }
  };
}

export const sendLiveCommunityEmail: CommunityMailSender = (mail) => createStagingCommunitySender(process.env)(mail);

/** Operator-invoked LOCAL mock mailbox: one JSON line per email. Never an application route and never a provider bypass. */
export function testMailboxSender(path: string): CommunityMailSender {
  return async (mail) => {
    await appendFile(path, `${JSON.stringify({ to: mail.to, subject: mail.subject, text: mail.text, headers: mail.headers, idempotencyKey: mail.idempotencyKey })}\n`, { mode: 0o600 });
  };
}
