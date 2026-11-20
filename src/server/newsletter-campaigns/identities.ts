import { and, asc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { newsletterConnections, newsletterIdentities } from "../../db/schema";
import { audit, conflict, id, pageInput, unavailable, version, withNewsletter } from "./access";
import { FakeNewsletterProvider } from "./fake-provider";

const createInput = z.object({ address: z.string().trim().toLowerCase().max(254).pipe(z.email()) }).strict();
const editInput = z.object({ version, enabled: z.boolean() }).strict();

export async function identity(tx: Transaction, tenant: string, identityId: string) {
  const [row] = await tx.select({ identity: newsletterIdentities, domain: newsletterConnections }).from(newsletterIdentities)
    .innerJoin(newsletterConnections, and(eq(newsletterConnections.tenantId, tenant),
      eq(newsletterConnections.id, newsletterIdentities.connectionId)))
    .where(and(eq(newsletterIdentities.tenantId, tenant), eq(newsletterIdentities.id, id(identityId)))).for("share", { of: newsletterIdentities });
  if (!row) throw unavailable();
  return row;
}

export function assertVerified(row: Awaited<ReturnType<typeof identity>>, sender: boolean) {
  const { identity, domain } = row;
  if (!identity.enabled || !identity.ownershipVerified || !domain.enabled ||
      (sender && (!domain.spf || !domain.dkim || !domain.dmarc))) throw conflict("IDENTITY_UNVERIFIED");
}

export function listIdentities(db: Database, actor: string, workspace: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    const page = pageInput.parse(raw);
    const rows = await tx.select({ identity: newsletterIdentities, domain: newsletterConnections }).from(newsletterIdentities)
      .innerJoin(newsletterConnections, and(eq(newsletterConnections.tenantId, tenant),
        eq(newsletterConnections.id, newsletterIdentities.connectionId)))
      .where(and(eq(newsletterIdentities.tenantId, tenant), page.after ? gt(newsletterIdentities.id, page.after) : undefined))
      .orderBy(asc(newsletterIdentities.id)).limit(page.limit + 1);
    return { items: rows.slice(0, page.limit), nextCursor: rows.length > page.limit ? rows[page.limit - 1].identity.id : null,
      providerAvailability: "unavailable" };
  });
}

export function createIdentity(db: Database, actor: string, workspace: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    const { address } = createInput.parse(raw);
    const domain = address.slice(address.lastIndexOf("@") + 1);
    const status = await new FakeNewsletterProvider().domain(address);
    await tx.insert(newsletterConnections).values({ tenantId: tenant, domain, enabled: Boolean(status),
      spf: status?.spf, dkim: status?.dkim, dmarc: status?.dmarc }).onConflictDoNothing();
    const [connection] = await tx.select().from(newsletterConnections).where(and(eq(newsletterConnections.tenantId, tenant),
      eq(newsletterConnections.domain, domain)));
    const [row] = await tx.insert(newsletterIdentities).values({ tenantId: tenant, address,
      connectionId: connection.id, ownershipVerified: Boolean(status?.ownership) }).onConflictDoNothing().returning();
    if (!row) throw conflict("IDENTITY_EXISTS");
    await audit(tx, tenant, actor, "newsletter.identity.create", row.id, row.version);
    return { identity: row, domain: connection };
  });
}

export function updateIdentity(db: Database, actor: string, workspace: string, identityId: string, raw: unknown) {
  return withNewsletter(db, actor, workspace, "newsletter:delivery", async (tx, tenant) => {
    const input = editInput.parse(raw);
    const [row] = await tx.update(newsletterIdentities).set({ enabled: input.enabled, version: input.version + 1 })
      .where(and(eq(newsletterIdentities.tenantId, tenant), eq(newsletterIdentities.id, id(identityId)),
        eq(newsletterIdentities.version, input.version))).returning();
    if (!row) {
      await identity(tx, tenant, identityId);
      throw conflict("STALE_VERSION");
    }
    await audit(tx, tenant, actor, "newsletter.identity.update", row.id, row.version);
    return row;
  });
}
