import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { callbackClockSkewMs, callbackTimestampValid, newsletterEvents, type DomainRecord, type NewsletterProvider } from "./port";

const callback = z.object({ messageId: z.uuid(), deliveryId: z.uuid(), reference: z.string().min(1).max(255),
  type: z.enum(newsletterEvents), at: z.iso.datetime() });

export class FakeNewsletterProvider implements NewsletterProvider {
  readonly #accepted = new Map<string, string>();
  constructor(private readonly key?: Buffer, private readonly loseReceipt = false) {}

  async submit({ deliveryId }: Parameters<NewsletterProvider["submit"]>[0]) {
    const reference = this.#accepted.get(deliveryId) ?? "fake-" + randomUUID();
    this.#accepted.set(deliveryId, reference);
    if (this.loseReceipt) return { state: "unknown" } as const;
    return { state: "accepted", reference } as const;
  }

  // Test-only observation of what the synthetic provider would echo back.
  receiptForTest(deliveryId: string) {
    return this.#accepted.get(deliveryId);
  }

  verifyCallback(body: Uint8Array, headers: Headers, now: Date) {
    const timestamp = headers.get("x-newsletter-timestamp");
    const signature = headers.get("x-newsletter-signature");
    if (!this.key || !timestamp || !/^\d{13}$/.test(timestamp) ||
        !callbackTimestampValid(Number(timestamp), now) ||
        !signature || !/^[0-9a-f]{64}$/.test(signature)) return null;
    const expected = createHmac("sha256", this.key).update(timestamp).update(".").update(body).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return null;
    try {
      const parsed = callback.safeParse(JSON.parse(Buffer.from(body).toString("utf8")));
      if (!parsed.success) return null;
      const at = new Date(parsed.data.at);
      return at.getTime() <= now.getTime() + callbackClockSkewMs ? { ...parsed.data, at, signedAt: new Date(Number(timestamp)) } : null;
    } catch { return null; }
  }

  async domain(domain: string, records: readonly DomainRecord[]) {
    return (domain === "example.invalid" || (domain.endsWith(".example.test") && domain !== "newsletter.example.test")) &&
      ["ownership", "spf", "dkim", "bounce"].every(purpose => records.some(record => record.purpose === purpose))
      ? { ownership: true, spf: true, dkim: true, bounce: true, dmarc: records.some(record => record.purpose === "dmarc" && record.type === "TXT" &&
        record.name === "_dmarc." + domain && /^v=DMARC1;\s*p=(none|quarantine|reject)(?:\s*;|$)/i.test(record.value)) } : null;
  }

  // A caller can inject a test inbox to read the synthetic message.
  readonly confirmMailbox: (message: { to: string; subject: string; text: string }) => Promise<void> = async () => {};
}
