import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { deliveryOutcomes, type DeliveryResult, type NewsletterCredential, type NewsletterMessage, type NewsletterProvider, type NewsletterReceipt, type ReconciliationResult } from "./port";

const eventSchema = z.object({
  tenantId: z.uuid(), id: z.uuid(), deliveryId: z.uuid(), providerId: z.uuid(), outcome: z.enum(deliveryOutcomes),
  linkId: z.number().int().min(1).max(5000).optional(), occurredAt: z.iso.datetime({ offset: true }),
}).refine(event => (event.outcome === "clicked") === (event.linkId !== undefined));

export const signFakeNewsletterCallback = (raw: Uint8Array, secret: string) =>
  createHmac("sha256", secret).update(raw).digest("hex");

export class FakeNewsletterProvider implements NewsletterProvider {
  private readonly receipts = new Map<string, NewsletterReceipt>();
  readonly attempts: string[] = [];
  nextDelivery: "accepted" | "accepted_unknown" | "unknown" | "retry" | "failed" = "accepted";
  reconciliationUnavailable = false;

  constructor(private readonly secret: string) {}

  async verifySender(credential: NewsletterCredential, domain: string) {
    return credential.secret === this.secret && /^(?:[a-z0-9-]+\.)+test$/.test(domain);
  }

  async deliver(credential: NewsletterCredential, message: NewsletterMessage): Promise<DeliveryResult> {
    if (credential.secret !== this.secret || !message.recipient.endsWith(".test") ||
        !message.sender.email.endsWith(".test") || !message.sender.replyTo.endsWith(".test")) return { outcome: "failed" };
    const id = `${message.tenantId}:${message.key}`;
    this.attempts.push(message.key);
    const existing = this.receipts.get(id);
    if (existing) return existing;
    const outcome = this.nextDelivery;
    this.nextDelivery = "accepted";
    if (outcome !== "accepted" && outcome !== "accepted_unknown") return { outcome };
    const receipt: NewsletterReceipt = { outcome: "accepted", providerId: randomUUID() };
    this.receipts.set(id, receipt);
    return outcome === "accepted_unknown" ? { outcome: "unknown" } : receipt;
  }

  async reconcile(credential: NewsletterCredential, tenantId: string, key: string): Promise<ReconciliationResult> {
    if (credential.secret !== this.secret || this.reconciliationUnavailable) return { outcome: "unknown" };
    return this.receipts.get(`${tenantId}:${key}`) ?? { outcome: "absent" };
  }

  verifyCallback(raw: Uint8Array, signature: string | null, secret: string) {
    if (!signature || !/^[0-9a-f]{64}$/.test(signature) || raw.byteLength > 8192 || !secret) return null;
    if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(signFakeNewsletterCallback(raw, secret), "hex"))) return null;
    try {
      return eventSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw))).data ?? null;
    } catch {
      return null;
    }
  }
}
