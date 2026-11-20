import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { newsletterEvents, type DomainRecord, type NewsletterProvider } from "./port";

const callback = z.object({ deliveryId: z.uuid(), reference: z.string().min(1).max(255),
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
        Math.abs(now.getTime() - Number(timestamp)) > 300_000 ||
        !signature || !/^[0-9a-f]{64}$/.test(signature)) return null;
    const expected = createHmac("sha256", this.key).update(timestamp).update(".").update(body).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return null;
    try {
      const parsed = callback.safeParse(JSON.parse(Buffer.from(body).toString("utf8")));
      if (!parsed.success) return null;
      const at = new Date(parsed.data.at);
      return at.getTime() <= now.getTime() + 300_000 ? { ...parsed.data, at } : null;
    } catch { return null; }
  }

  async domain(domain: string, records: readonly DomainRecord[]) {
    return domain.endsWith(".example.test") && domain !== "newsletter.example.test" &&
      ["ownership", "spf", "dkim", "bounce"].every(purpose => records.some(record => record.purpose === purpose))
      ? { ownership: true, spf: true, dkim: true, bounce: true, dmarc: false } : null;
  }

  // A caller can inject a test inbox to read the synthetic message.
  readonly confirmMailbox: (message: { to: string; subject: string; text: string }) => Promise<void> = async () => {};
}
