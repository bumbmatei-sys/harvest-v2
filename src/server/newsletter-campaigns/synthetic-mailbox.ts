import type { Database } from "../../db/client";
import { newsletterIdentities } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import { requireSyntheticProvider, syntheticProviderActive } from "./provider-mode";
import { id, unavailable, withNewsletter } from "./access";

/**
 * Synthetic mailbox for the test provider: no mail leaves the process. The newest confirmation code per ministry and address is kept
 * in memory so a tester can finish mailbox confirmation. Newsletter routes are unavailable in production, and so is this.
 */
const store = (globalThis as { __newsletterSyntheticMailbox?: Map<string, string> }).__newsletterSyntheticMailbox ??= new Map();
const key = (tenant: string, address: string) => tenant + "\n" + address;

export function syntheticMailboxSink(tenant: string) {
  return { confirmMailbox: async (mail: { to: string; text: string }) => {
    if (!syntheticProviderActive()) return;
    const code = /([A-Za-z0-9_-]{43})\s*$/.exec(mail.text)?.[1];
    if (code) store.set(key(tenant, mail.to), code);
  } };
}

export function syntheticMailboxCode(db: Database, actor: string, workspace: string, identityId: string) {
  requireSyntheticProvider();
  return withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    const [row] = await tx.select({ address: newsletterIdentities.address, pending: newsletterIdentities.confirmationDigest })
      .from(newsletterIdentities).where(and(eq(newsletterIdentities.tenantId, tenant), eq(newsletterIdentities.id, id(identityId))));
    if (!row) throw unavailable();
    return { code: row.pending ? store.get(key(tenant, row.address)) ?? null : null };
  });
}
