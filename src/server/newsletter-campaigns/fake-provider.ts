import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { newsletterEvents, type NewsletterProvider } from "./port";

const callback = z.object({ reference: z.uuid(), type: z.enum(newsletterEvents), at: z.iso.datetime() });

export class FakeNewsletterProvider implements NewsletterProvider {
  readonly #accepted = new Set<string>();
  constructor(private readonly key?: Buffer, private readonly loseFirstReceipt = false) {}

  async submit({ idempotencyKey }: Parameters<NewsletterProvider["submit"]>[0]) {
    const previouslyAccepted = this.#accepted.has(idempotencyKey);
    this.#accepted.add(idempotencyKey);
    if (this.loseFirstReceipt && !previouslyAccepted) return { state: "unknown" } as const;
    return { state: "accepted", reference: idempotencyKey } as const;
  }

  async status(key: string) {
    return this.#accepted.has(key) ? { state: "accepted", reference: key } as const : { state: "unknown" } as const;
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

  async domain(address: string) {
    return address.endsWith(".example.test") || address.endsWith("@example.test")
      ? { ownership: true, spf: true, dkim: true, dmarc: true } : null;
  }

  async quota() { return null; }
}
