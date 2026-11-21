import { createHash, randomUUID } from "node:crypto";
import type { SendContent } from "./port";

const ttl = 5 * 60_000;
type Binding = { tenantId: string; actorId: string; connectionId: string; content: SendContent };
const fingerprint = (binding: Binding) => createHash("sha256").update(JSON.stringify([
  binding.tenantId, binding.actorId, binding.connectionId, binding.content.messageRef ?? null,
  binding.content.to, binding.content.subject, binding.content.body,
])).digest("hex");

/** Review receipts stay in process and carry only a digest. Restarting invalidates pending reviews. */
export class OfficeMailReview {
  private readonly tokens = new Map<string, { fingerprint: string; expiresAt: number }>();
  constructor(private readonly now: () => Date) {}

  issue(binding: Binding) {
    const now = this.now().getTime();
    for (const [token, value] of this.tokens) if (value.expiresAt <= now) this.tokens.delete(token);
    if (this.tokens.size >= 1000) return null;
    const reviewToken = randomUUID(), expiresAt = now + ttl;
    this.tokens.set(reviewToken, { fingerprint: fingerprint(binding), expiresAt });
    return { reviewToken, expiresAt: new Date(expiresAt).toISOString() };
  }

  consume(token: string, binding: Binding) {
    const saved = this.tokens.get(token);
    if (!saved) return false;
    if (saved.expiresAt <= this.now().getTime()) {
      this.tokens.delete(token);
      return false;
    }
    if (saved.fingerprint !== fingerprint(binding)) return false;
    this.tokens.delete(token);
    return true;
  }
}
